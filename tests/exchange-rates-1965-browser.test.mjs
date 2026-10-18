import assert from 'node:assert/strict';
import test from 'node:test';
import FIXTURE from './fixtures/superrich1965/exchange-rate-00.json' with { type: 'json' };
import { createBrowserSource, createSourceSession, resolveSourceTransport, BROWSER_PAGE_URL, BROWSER_SOURCE_PROFILE } from '../netlify/functions/_shared/exchange-rates-1965-browser.mjs';
import { queryBranchRates, BRANCH_GATE_KEY } from '../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { EXCHANGE_KEYS, createBreaker, createControl } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { ORANGE_BRANCHES } from '../src/data/exchange-rates-1965-branch.js';
import { SOURCE_BASE_URL } from '../netlify/functions/_shared/exchange-rates-1965-source.mjs';
import { dispatchSlowBatch, runSlowBatch, BATCH_JOB_KEY } from '../netlify/functions/_shared/exchange-rates-1965-background.mjs';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-18T01:00:00.000Z');
const [slug, otherSlug] = Object.keys(ORANGE_BRANCHES);
const rateURL = `${SOURCE_BASE_URL}/get`;
const requestBody = target => JSON.stringify({ filters: [
  { field: 'company_code', value: ORANGE_BRANCHES[target].companyCode },
  { field: 'branch_no', value: ORANGE_BRANCHES[target].branchNo },
] });
function harness({ navigationStatus = 200, navigationHeaders = {}, resultStatus = 200, resultHeaders = {} } = {}) {
  const calls = { launch: 0, navigation: 0, evaluate: 0, close: 0, permitted: 0, suppressed: 0 };
  let routing;
  const route = async ({ url = rateURL, method = 'POST', body = requestBody(slug), type = 'fetch' } = {}) => {
    let action;
    await routing({ request: () => ({ url: () => url, method: () => method, postData: () => body, resourceType: () => type }),
      abort: async () => { action = 'abort'; },
      continue: async () => { action = 'continue'; calls.permitted++; },
      fulfill: async value => { action = 'fulfill'; calls.suppressed++; assert.equal(value.status, 204); },
    });
    return action;
  };
  const page = {
    route: async (_, handler) => { routing = handler; },
    goto: async url => {
      calls.navigation++;
      assert.equal(url, BROWSER_PAGE_URL);
      // The website's automatic default-branch call must not reach upstream.
      assert.equal(await route(), 'fulfill');
      return { allHeaders: async () => navigationHeaders, status: () => navigationStatus, ok: () => navigationStatus === 200 };
    },
    url: () => BROWSER_PAGE_URL,
    evaluate: async (_fn, request) => {
      calls.evaluate++;
      assert.equal(await route({ url: request.url, body: request.body }), 'continue');
      // Repeated page requests cannot consume a second rate request.
      assert.equal(await route({ url: request.url, body: request.body }), 'fulfill');
      return { status: resultStatus, body: JSON.stringify(FIXTURE), headers: resultHeaders };
    },
  };
  const browser = { newContext: async options => {
    assert.deepEqual(options, { serviceWorkers: 'block' });
    return { newPage: async () => page };
  }, close: async () => { calls.close++; } };
  const launchImpl = async () => { calls.launch++; return browser; };
  const source = createSourceSession({ transport: 'browser', launchImpl });
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, nowMs: START - 1_000, controlVersion: uuid(1), updatedBy: 'manual' }));
  let now = START, sequence = 2;
  const query = target => queryBranchRates({ store, slug: target, ...source, nowImpl: () => now, randomUUIDImpl: () => uuid(sequence++) });
  return { source, store, calls, page, route, query, advance: ms => { now += ms; } };
}

test('transport selection is explicit; HTTP compatibility and invalid modes never launch Chromium', () => {
  for (const value of [undefined, null, '', 'http']) assert.equal(resolveSourceTransport(value), 'http');
  assert.equal(resolveSourceTransport('browser'), 'browser');
  assert.throws(() => resolveSourceTransport('stealth'), /invalid_source_transport/);
  const fetchImpl = async () => Response.json(FIXTURE);
  const session = createSourceSession({ transport: 'http', fetchImpl });
  assert.equal(session.fetchImpl, fetchImpl);
  assert.equal(session.sourceProfile, undefined);
});

test('browser mode initializes lazily, reuses its session and only permits the leased branch requests', async () => {
  const h = harness();
  assert.equal(h.calls.launch, 0);
  assert.equal((await h.query(slug)).status, 200);
  assert.equal(h.calls.launch, 1);
  assert.equal(h.calls.permitted, 1);
  h.advance(2_000);
  assert.equal((await h.query(otherSlug)).status, 200);
  assert.equal(h.calls.navigation, 1);
  assert.equal(h.calls.evaluate, 2);
  assert.equal(h.calls.permitted, 2);
  assert.equal(await h.route({ url: 'https://tracker.example/test.js', type: 'script' }), 'abort');
  assert.equal(await h.route({ url: 'https://challenges.cloudflare.com/test.js', type: 'script' }), 'continue');
  assert.equal(await h.route({ url: 'https://www.superrich1965.com/logo.png', type: 'image' }), 'abort');
  await h.source.close();
  await h.source.close();
  assert.equal(h.calls.close, 1);
});

test('valid cache, disabled control, active breaker and busy lease never initialize a browser', async () => {
  for (const mode of ['cache', 'disabled', 'breaker', 'busy']) {
    const h = harness();
    if (mode === 'cache') await queryBranchRates({ store: h.store, slug, nowImpl: () => START, fetchImpl: async () => Response.json(FIXTURE) });
    if (mode === 'disabled') h.store.seed(EXCHANGE_KEYS.control, createControl({ enabled: false, nowMs: START,
      controlVersion: uuid(1), updatedBy: 'manual', disabledReason: 'manual' }));
    if (mode === 'breaker') h.store.seed(EXCHANGE_KEYS.breaker, createBreaker(uuid(1), new Date(START + 60_000).toISOString()));
    if (mode === 'busy') h.store.seed(BRANCH_GATE_KEY, { leaseId: uuid(8), leaseUntilMs: START + 10_000, nextRequestAtMs: START });
    assert.equal((await h.query(slug)).status, mode === 'cache' ? 200 : mode === 'disabled' ? 503 : mode === 'breaker' ? 429 : 202);
    assert.equal(h.calls.launch, 0, mode);
    await h.source.close();
  }
});

test('browser collection holds a lease covering its larger source deadline', async () => {
  const h = harness();
  const evaluate = h.page.evaluate;
  h.page.evaluate = async (...args) => {
    assert.equal(h.store.entries.get(BRANCH_GATE_KEY).data.leaseUntilMs, START + BROWSER_SOURCE_PROFILE.deadlineMs + 9_000);
    return evaluate(...args);
  };
  assert.equal((await h.query(slug)).status, 200);
  assert.equal(h.store.entries.get(BRANCH_GATE_KEY).data.leaseId, null);
  await h.source.close();
});

test('background jobs use the browser transport and reuse one browser while preserving inter-branch gaps', async () => {
  const h = harness();
  let now = START, sequence = 10;
  await dispatchSlowBatch({ store: h.store, deployURL: 'https://deploy.example', nowImpl: () => now,
    randomUUIDImpl: () => uuid(sequence++), fetchImpl: async () => new Response(null, { status: 202 }) });
  const result = await runSlowBatch({ store: h.store, token: h.store.entries.get(BATCH_JOB_KEY).data.token,
    ...h.source, nowImpl: () => now, sleepImpl: async ms => { now += ms; }, randomImpl: () => 0,
    randomUUIDImpl: () => uuid(sequence++), slugs: [slug, otherSlug] });
  assert.equal(result.status, 'complete');
  assert.equal(result.loaded, 2);
  assert.equal(h.calls.launch, 1);
  assert.equal(h.calls.permitted, 2);
  assert.equal(now - START, 2_000);
  await h.source.close();
});

for (const phase of ['navigation', 'rate']) {
  test(`a ${phase} challenge reaches the existing breaker without retries or a second branch request`, async t => {
    const messages = [];
    t.mock.method(console, 'info', message => {
      const entry = JSON.parse(message);
      if (entry.event === 'exchange_rates_1965_branch') messages.push(entry);
    });
    const headers = { 'cf-mitigated': 'challenge', 'cf-ray': 'browser-ray', 'content-type': 'text/html', 'set-cookie': 'PRIVATE_COOKIE' };
    const h = harness(phase === 'navigation' ? { navigationStatus: 403, navigationHeaders: headers } : { resultStatus: 403, resultHeaders: headers });
    assert.equal((await h.query(slug)).status, 429);
    assert.equal((await h.query(otherSlug)).status, 429);
    assert.equal(h.calls.launch, 1);
    assert.equal(h.calls.evaluate, phase === 'navigation' ? 0 : 1);
    assert.equal(h.store.entries.get(EXCHANGE_KEYS.breaker).data.blockLevel, 1);
    assert.equal(messages[0].sourceProfile, 'browser');
    assert.equal(messages[0].blockedStatus, 403);
    assert.equal(messages[0].diagnostics[0].cfMitigated, 'challenge');
    assert.equal(messages[1].sourceRequestCount, 0);
    assert.equal(JSON.stringify(messages).includes('PRIVATE_COOKIE'), false);
    await h.source.close();
  });
}

test('invalid URL or branch cannot initialize the browser', async () => {
  const h = harness();
  await assert.rejects(h.source.fetchImpl('https://other.example', { method: 'POST', body: requestBody(slug) }), /invalid_browser_request/);
  await assert.rejects(h.source.fetchImpl(rateURL, { method: 'POST', body: JSON.stringify({ filters: [] }) }), /invalid_browser_branch/);
  assert.equal(h.calls.launch, 0);
  await h.source.close();
});

test('browser launch failures log a fixed stage and never leak error text or attempt another source request', async t => {
  const logs = [];
  t.mock.method(console, 'info', message => logs.push(JSON.parse(message)));
  let launches = 0;
  const source = createBrowserSource({ launchImpl: async () => { launches++; throw new Error('PRIVATE_LAUNCH_TOKEN'); } });
  await assert.rejects(source.fetchImpl(rateURL, { method: 'POST', body: requestBody(slug) }));
  assert.equal(launches, 1);
  assert.equal(logs[0].stage, 'launch');
  assert.equal(logs[0].result, 'failed');
  assert.equal(logs[0].rateRequestCount, 0);
  assert.equal(JSON.stringify(logs).includes('PRIVATE_LAUNCH_TOKEN'), false);
  await source.close();
});

test('abort during browser startup closes a late launch before navigation', async () => {
  let finish;
  const launching = new Promise(resolve => { finish = resolve; });
  let closes = 0, contexts = 0;
  const source = createBrowserSource({ launchImpl: () => launching });
  const controller = new AbortController();
  const result = source.fetchImpl(rateURL, { method: 'POST', body: requestBody(slug), signal: controller.signal });
  controller.abort();
  await assert.rejects(result, /browser_aborted/);
  finish({ close: async () => { closes++; }, newContext: async () => { contexts++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closes, 1);
  assert.equal(contexts, 0);
});

test('browser fetch uses a same-origin session without copying credentials or spoofing headers', async t => {
  const h = harness();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, rateURL);
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.mode, 'same-origin');
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Content-Type']);
    assert.deepEqual(JSON.parse(options.body), JSON.parse(requestBody(slug)));
    return Response.json(FIXTURE);
  });
  h.page.evaluate = (fn, request) => fn(request);
  assert.equal((await h.query(slug)).status, 200);
  await h.source.close();
});
