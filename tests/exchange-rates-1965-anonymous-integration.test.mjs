import assert from 'node:assert/strict';
import test from 'node:test';
import FIXTURE from './fixtures/superrich1965/exchange-rate-00.json' with { type: 'json' };
import { createAnonymousApiSource, ANONYMOUS_SOURCE_PROFILE } from '../netlify/functions/_shared/exchange-rates-1965-anonymous.mjs';
import { queryBranchRates, branchCacheKey, BRANCH_GATE_KEY, BRANCH_LEASE_MS } from '../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { runSlowBatch, BATCH_JOB_KEY, BATCH_BUDGET_MS } from '../netlify/functions/_shared/exchange-rates-1965-background.mjs';
import { EXCHANGE_KEYS, createBreaker, createControl } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { serveBranchCache } from '../netlify/functions/exchange-rates-1965-cache.mjs';
import { ORANGE_BRANCHES, isValidBranchQuote } from '../src/data/exchange-rates-1965-branch.js';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-19T01:00:00.000Z');
const TOKEN_URL = 'https://api.superrich1965.com/front/exchange-rate/oauth2/callback';
const RATE_URL = 'https://www.superrich1965.com/api/exchange-rate-service/v1/external-app-exchange-rate/get';
const slug = 'superrich1965-58';
const otherSlug = Object.keys(ORANGE_BRANCHES).find(value => value !== slug);

function token(expiryMs, sequence) {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ exp: Math.floor(expiryMs / 1000), marker: `PRIVATE_TOKEN_${sequence}` })}.mock-signature`;
}

function harness() {
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, nowMs: START - 1000,
    controlVersion: uuid(1), updatedBy: 'manual' }));
  let now = START, sequence = 10;
  const calls = [], tokens = [], delays = [];
  const h = { store, calls, tokens, delays,
    nowImpl: () => now,
    advance: ms => { now += ms; },
    randomUUIDImpl: () => uuid(sequence++),
    tokenExpiry: () => now + 60 * 60_000,
    tokenResponse: () => {
      const accessToken = token(h.tokenExpiry(), tokens.length);
      tokens.push(accessToken);
      return Response.json({ accessToken });
    },
    rateResponse: () => Response.json(FIXTURE),
  };
  const source = { sourceProfile: ANONYMOUS_SOURCE_PROFILE, ...createAnonymousApiSource({ nowImpl: h.nowImpl,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options, at: now });
      if (String(url) === TOKEN_URL) return h.tokenResponse();
      assert.equal(String(url), RATE_URL);
      return h.rateResponse();
    } }) };
  h.source = source;
  h.input = { store, ...source, nowImpl: h.nowImpl, randomUUIDImpl: h.randomUUIDImpl };
  h.query = async (target = slug) => {
    const response = await queryBranchRates({ ...h.input, slug: target });
    return { response, body: await response.json() };
  };
  h.seedJob = () => store.seed(BATCH_JOB_KEY, { token: h.randomUUIDImpl(), controlVersion: uuid(1),
    scheduledAtMs: now, deadlineAtMs: now + BATCH_BUDGET_MS, status: 'pending', leaseId: null });
  h.run = options => runSlowBatch({ ...h.input, token: store.entries.get(BATCH_JOB_KEY).data.token,
    randomImpl: () => 0, slugs: [slug, otherSlug],
    sleepImpl: async ms => { delays.push(ms); now += ms; }, ...options });
  return h;
}

function captureLogs(t) {
  const messages = [];
  t.mock.method(console, 'info', message => messages.push(JSON.parse(message)));
  return messages;
}

function assertPrivate(h, values) {
  const text = JSON.stringify(values);
  for (const value of h.tokens) assert.equal(text.includes(value), false);
  assert.doesNotMatch(text, /PRIVATE_|accessToken|Authorization|Bearer|set-cookie/);
}

test('anonymous cold query counts token GET and rate POST, publishes complete rates, and leaks no credentials', async t => {
  const logs = captureLogs(t);
  const h = harness();
  t.after(h.source.close);
  assert.equal(h.calls.length, 0);
  const first = await h.query();
  assert.equal(first.response.status, 200);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].options.method, 'GET');
  assert.equal(h.calls[1].options.method, 'POST');
  assert.equal(new Headers(h.calls[1].options.headers).get('authorization'), `Bearer ${h.tokens[0]}`);
  assert.deepEqual(JSON.parse(h.calls[1].options.body).filters, [
    { field: 'company_code', value: 'A04' }, { field: 'branch_no', value: '36' },
  ]);
  assert.ok(isValidBranchQuote(first.body.quote));
  assert.equal(first.body.quote.branch.rates.USD_1965.rateScaledE6, 32_770_000);
  assert.equal(first.body.quote.branch.rates.TWD_1965.rateScaledE6, 995_000);
  assert.equal(logs[0].sourceProfile, 'anonymous-api');
  assert.equal(logs[0].sourceRequestCount, 2);
  assert.equal(logs[0].sourceOutcome, 'complete');
  assert.deepEqual(logs[0].diagnostics.map(entry => [entry.stage, entry.status]), [['token', 200], ['rate', 200]]);
  const warm = await h.query();
  assert.deepEqual(warm.body.quote, first.body.quote);
  assert.equal(h.calls.length, 2);
  assert.equal(logs.at(-1).sourceRequestCount, 0);
  assert.deepEqual(logs.at(-1).diagnostics, []);
  const publicCache = await (await serveBranchCache(h.input)).json();
  assertPrivate(h, { logs, first: first.body, warm: warm.body, publicCache, entries: [...h.store.entries] });
  assert.equal(Object.hasOwn(first.body, 'diagnostics'), false);
});

test('anonymous transport stays lazy for disabled control, active breaker, busy lease, CAS loss, or control changes during lease acquisition', async t => {
  const logs = captureLogs(t);
  for (const mode of ['disabled', 'breaker', 'busy', 'cas_loss', 'control_change']) {
    const h = harness();
    t.after(h.source.close);
    if (mode === 'disabled') h.store.seed(EXCHANGE_KEYS.control, createControl({ enabled: false,
      nowMs: START, controlVersion: uuid(2), updatedBy: 'manual', disabledReason: 'manual' }));
    if (mode === 'breaker') h.store.seed(EXCHANGE_KEYS.breaker, createBreaker(uuid(1), new Date(START + 60_000).toISOString()));
    if (mode === 'busy') h.store.seed(BRANCH_GATE_KEY, { leaseId: uuid(8), leaseUntilMs: START + BRANCH_LEASE_MS, nextRequestAtMs: START });
    let changed = false;
    h.store.beforeSet = ({ key, store }) => {
      if (key !== BRANCH_GATE_KEY || changed) return;
      changed = true;
      if (mode === 'cas_loss') store.seed(key, { leaseId: uuid(9), leaseUntilMs: START + BRANCH_LEASE_MS, nextRequestAtMs: START });
      if (mode === 'control_change') store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true,
        nowMs: START, controlVersion: uuid(2), updatedBy: 'manual' }));
    };
    const result = await h.query();
    const expected = mode === 'breaker' ? 429 : ['busy', 'cas_loss'].includes(mode) ? 202 : 503;
    assert.equal(result.response.status, expected, mode);
    assert.equal(h.calls.length, 0, mode);
    assert.equal(logs.at(-1).sourceRequestCount, 0, mode);
    assert.deepEqual(logs.at(-1).diagnostics, [], mode);
  }
});

for (const status of [403, 200]) {
  test(`anonymous callback challenge (${status}) enters existing breaker after one GET and suppresses subsequent clicks`, async t => {
    const logs = captureLogs(t);
    const h = harness();
    t.after(h.source.close);
    h.tokenResponse = () => new Response('PRIVATE_CHALLENGE_BODY', { status,
      headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html', 'set-cookie': 'PRIVATE_COOKIE' } });
    const first = await h.query();
    assert.equal(first.response.status, 429);
    assert.equal(first.body.reason, 'cooldown');
    assert.equal(first.body.quote, null);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, TOKEN_URL);
    assert.equal(logs[0].sourceRequestCount, 1);
    assert.equal(logs[0].blockedStatus, status);
    assert.equal(logs[0].sourceOutcome, 'blocked');
    assert.deepEqual(logs[0].diagnostics.map(entry => entry.stage), ['token']);
    assert.equal(h.store.entries.get(EXCHANGE_KEYS.breaker).data.blockLevel, 1);
    const second = await h.query(otherSlug);
    assert.equal(second.response.status, 429);
    assert.equal(h.calls.length, 1);
    assert.equal(logs.at(-1).sourceRequestCount, 0);
    assert.equal(logs.at(-1).cooldownSource, 'breaker');
    assertPrivate(h, { first: first.body, second: second.body, logs, entries: [...h.store.entries] });
  });
}

test('anonymous rate challenge counts both requests and preserves an expired quote without extending expiry or refreshing again', async t => {
  const logs = captureLogs(t);
  const h = harness();
  t.after(h.source.close);
  await h.query();
  const old = structuredClone(h.store.entries.get(branchCacheKey(slug)).data);
  h.advance(70 * 60_000);
  h.calls.length = 0;
  logs.length = 0;
  h.rateResponse = () => new Response('PRIVATE_RATE_BODY', { status: 403,
    headers: { 'cf-mitigated': 'challenge', authorization: 'PRIVATE_HEADER' } });
  const result = await h.query();
  assert.equal(result.response.status, 429);
  assert.equal(result.body.quote, null);
  assert.equal(h.calls.length, 2);
  assert.equal(logs[0].sourceRequestCount, 2);
  assert.equal(logs[0].blockedStatus, 403);
  assert.deepEqual(logs[0].diagnostics.map(entry => [entry.stage, entry.status]), [['token', 200], ['rate', 403]]);
  assert.deepEqual(h.store.entries.get(branchCacheKey(slug)).data, old);
  const cache = await (await serveBranchCache(h.input)).json();
  assert.deepEqual(cache.quotes, []);
  assert.equal((await h.query()).response.status, 429);
  assert.equal(h.calls.length, 2);
  assertPrivate(h, { logs, result: result.body, cache, entries: [...h.store.entries] });
});

for (const mode of ['invalid_token', 'rate_401']) {
  test(`anonymous ${mode} fails closed with accurate request count and no retry`, async t => {
    const logs = captureLogs(t);
    const h = harness();
    t.after(h.source.close);
    if (mode === 'invalid_token') h.tokenResponse = () => Response.json({ accessToken: 'PRIVATE_MALFORMED_TOKEN with invalid whitespace' });
    else h.rateResponse = () => new Response('PRIVATE_UNAUTHORIZED_BODY', { status: 401 });
    const result = await h.query();
    const expected = mode === 'invalid_token' ? 1 : 2;
    assert.equal(result.response.status, 503);
    assert.equal(result.body.quote, null);
    assert.equal(h.calls.length, expected);
    assert.equal(logs[0].sourceRequestCount, expected);
    assert.equal(logs[0].sourceOutcome, 'failed');
    assert.equal(h.store.entries.has(branchCacheKey(slug)), false);
    assert.equal((await h.query(otherSlug)).response.status, 429);
    assert.equal(h.calls.length, expected);
    assertPrivate(h, { result: result.body, logs, entries: [...h.store.entries] });
  });
}

for (const expiredBetweenBranches of [false, true]) {
  test(`anonymous background batch ${expiredBetweenBranches ? 'renews an expired token' : 'reuses one token'} while retaining branch pacing and breaker history`, async t => {
    const logs = captureLogs(t);
    const h = harness();
    t.after(h.source.close);
    h.store.seed(EXCHANGE_KEYS.breaker, { ...createBreaker(uuid(1)), blockLevel: 1 });
    if (expiredBetweenBranches) h.tokenExpiry = () => h.nowImpl() + 61_000;
    h.seedJob();
    assert.equal(h.calls.length, 0);
    const result = await h.run(expiredBetweenBranches ? { sleepImpl: async ms => {
      h.delays.push(ms);
      // A delayed worker can resume after expiry even though its planned gap is short.
      h.advance(62_000);
    } } : {});
    assert.equal(result.status, 'complete');
    assert.equal(result.loaded, 2);
    assert.equal(h.calls.filter(call => call.url === TOKEN_URL).length, expiredBetweenBranches ? 2 : 1);
    const rates = h.calls.filter(call => call.url === RATE_URL);
    assert.equal(rates.length, 2);
    assert.deepEqual(h.delays, [2_000]);
    assert.ok(rates[1].at - rates[0].at >= 2_000);
    assert.equal(logs[0].sourceRequestCount, 2);
    assert.equal(logs[1].sourceRequestCount, expiredBetweenBranches ? 2 : 1);
    assert.equal(h.store.entries.get(EXCHANGE_KEYS.breaker).data.blockLevel, 1);
    assert.ok(isValidBranchQuote(h.store.entries.get(branchCacheKey(slug)).data));
    assert.ok(isValidBranchQuote(h.store.entries.get(branchCacheKey(otherSlug)).data));
    assertPrivate(h, { logs, result, entries: [...h.store.entries] });
  });
}
