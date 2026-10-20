import assert from 'node:assert/strict';
import test from 'node:test';
import FIXTURE from './fixtures/superrich1965/exchange-rate-00.json' with { type: 'json' };
import handler from '../netlify/functions/exchange-rates-1965-branch.mjs';
import { queryBranchRates, branchCacheKey, BRANCH_GATE_KEY, BRANCH_LEASE_MS, BRANCH_MIN_GAP_MS } from '../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { BRANCH_QUOTE_TTL_MS, ORANGE_BRANCHES, isValidBranchQuote, parseBranchQueryPayload } from '../src/data/exchange-rates-1965-branch.js';
import { EXCHANGE_KEYS, createBreaker, createControl, buildSnapshot } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-17T01:00:00.000Z');
const [slug, otherSlug] = Object.keys(ORANGE_BRANCHES);
function harness() {
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, nowMs: START - 1000, controlVersion: uuid(1), updatedBy: 'manual' }));
  let now = START;
  let calls = [];
  let sequence = 10;
  const input = { store, slug, nowImpl: () => now, randomUUIDImpl: () => uuid(sequence++), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return Response.json(FIXTURE);
  } };
  return { store, input, calls, advance: ms => { now += ms; } };
}

async function fetchBody(input) {
  const response = await queryBranchRates(input);
  return { response, body: await response.json() };
}

for (const status of [403, 429, 200]) {
  test(`private diagnostics distinguish upstream ${status} from our cooldown response without exposing source data`, async t => {
    const messages = [];
    t.mock.method(console, 'info', text => messages.push(JSON.parse(text)));
    const h = harness();
    h.input.fetchImpl = async () => {
      h.calls.push({});
      return new Response('PRIVATE_CHALLENGE_BODY', { status, headers: {
        ...(status === 429 ? {} : { 'cf-mitigated': 'challenge' }),
        'content-type': 'text/html', 'retry-after': '30000', 'cf-ray': 'r'.repeat(150),
        'set-cookie': 'PRIVATE_COOKIE', authorization: 'PRIVATE_TOKEN',
      } });
    };
    const first = await fetchBody(h.input);
    const log = messages[0];
    assert.equal(first.response.status, 429);
    assert.equal(log.event, 'exchange_rates_1965_branch');
    assert.equal(log.trigger, 'manual');
    assert.equal(log.slug, slug);
    assert.equal(log.httpStatus, 429);
    assert.equal(log.blockedStatus, status);
    assert.equal(log.sourceOutcome, 'blocked');
    assert.equal(log.sourceRequestCount, 1);
    assert.equal(log.cooldownSource, 'source_blocked');
    assert.equal(log.retryAt, h.store.entries.get(EXCHANGE_KEYS.breaker).data.blockedUntil);
    assert.equal(log.diagnostics[0].status, status);
    assert.equal(log.diagnostics[0].cfMitigated, status === 429 ? null : 'challenge');
    assert.equal(log.diagnostics[0].contentType, 'text/html');
    assert.equal(log.diagnostics[0].retryAfter, '30000');
    assert.equal(log.diagnostics[0].rayId.length, 100);
    assert.equal(JSON.stringify(messages).includes('PRIVATE_'), false);
    for (const key of ['diagnostics', 'blockedStatus', 'cooldownSource', 'sourceRequestCount']) {
      assert.equal(Object.hasOwn(first.body, key), false);
    }
    const second = await fetchBody({ ...h.input, slug: otherSlug });
    assert.equal(second.body.reason, 'cooldown');
    assert.equal(h.calls.length, 1);
    assert.equal(messages[1].cooldownSource, 'breaker');
    assert.equal(messages[1].sourceRequestCount, 0);
    assert.equal(messages[1].blockedStatus, null);
    assert.deepEqual(messages[1].diagnostics, []);
    assert.equal(messages[1].retryAt, log.retryAt);
  });
}

test('private diagnostics distinguish warm cache and gate cooldown from source requests', async t => {
  const messages = [];
  t.mock.method(console, 'info', text => messages.push(JSON.parse(text)));
  const h = harness();
  await fetchBody(h.input);
  await fetchBody(h.input);
  await fetchBody({ ...h.input, slug: otherSlug });
  assert.equal(messages.length, 3);
  assert.equal(messages[0].sourceOutcome, 'complete');
  assert.equal(messages[0].sourceRequestCount, 1);
  assert.equal(messages[1].httpStatus, 200);
  assert.equal(messages[1].sourceRequestCount, 0);
  assert.deepEqual(messages[1].diagnostics, []);
  assert.equal(messages[2].cooldownSource, 'gate');
  assert.equal(messages[2].sourceRequestCount, 0);
  assert.equal(h.calls.length, 1);
});

test('network failures record only fixed diagnostic reasons, never exception text', async t => {
  const messages = [];
  t.mock.method(console, 'info', text => messages.push(JSON.parse(text)));
  const h = harness();
  h.input.fetchImpl = async () => { throw new Error('PRIVATE_EXCEPTION_TOKEN'); };
  assert.equal((await fetchBody(h.input)).response.status, 503);
  assert.equal(messages[0].sourceOutcome, 'failed');
  assert.equal(messages[0].sourceRequestCount, 1);
  assert.equal(messages[0].diagnostics[0].status, null);
  assert.equal(messages[0].diagnostics[0].reason, 'http_error');
  assert.equal(JSON.stringify(messages).includes('PRIVATE_EXCEPTION_TOKEN'), false);
});

test('a logging failure does not change cached quotes or leave the lease held', async t => {
  t.mock.method(console, 'info', () => { throw new Error('logger unavailable'); });
  const h = harness();
  assert.equal((await fetchBody(h.input)).response.status, 200);
  assert.ok(isValidBranchQuote(h.store.entries.get(branchCacheKey(slug)).data));
  assert.equal(h.store.entries.get(BRANCH_GATE_KEY).data.leaseId, null);
  assert.equal((await fetchBody(h.input)).response.status, 200);
  assert.equal(h.calls.length, 1);
});

test('one click fetches exactly one mapped branch, caches complete USD/TWD and reuses across visitors', async () => {
  const h = harness();
  const first = await fetchBody(h.input);
  assert.equal(first.response.status, 200);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(h.calls[0].options.body).filters, [
    { field: 'company_code', value: 'A04' }, { field: 'branch_no', value: ORANGE_BRANCHES[slug].branchNo },
  ]);
  assert.equal(first.body.quote.slug, slug);
  assert.equal(isValidBranchQuote(first.body.quote), true);
  assert.equal(Date.parse(first.body.quote.expiresAt), START + BRANCH_QUOTE_TTL_MS);
  assert.equal(first.body.quote.branch.rates.USD_1965.rateScaledE6, 32_770_000);
  assert.equal(first.body.quote.branch.rates.TWD_1965.rateScaledE6, 995_000);
  assert.equal(first.response.headers.get('cache-control'), 'no-store');
  assert.equal(first.response.headers.get('netlify-cdn-cache-control'), 'no-store');
  assert.ok(parseBranchQueryPayload(first.body, slug));
  const second = await fetchBody(h.input);
  assert.deepEqual(second.body.quote, first.body.quote);
  assert.equal(h.calls.length, 1);
  assert.equal(h.store.entries.has(EXCHANGE_KEYS.snapshot), false);
  h.advance(BRANCH_QUOTE_TTL_MS);
  const third = await fetchBody(h.input);
  assert.equal(third.response.status, 200);
  assert.equal(h.calls.length, 2);
  assert.notEqual(third.body.quote.attemptedAt, first.body.quote.attemptedAt);
});

test('reuses a recent legacy snapshot without upstream requests and never changes it', async () => {
  const h = harness();
  const initial = (await fetchBody(h.input)).body.quote;
  h.store.entries.delete(branchCacheKey(slug));
  const full = buildSnapshot({ runId: uuid(20), controlVersion: uuid(1), attemptedAtMs: START, completedAtMs: START,
    sourceBranchIds: [initial.branch.officialId], branches: [{ ...initial.branch, sourceUpdatedAtMs: null }], unknownBranchCount: 0, missingBranchCount: 0 });
  h.store.seed(EXCHANGE_KEYS.snapshot, full);
  assert.equal((await fetchBody(h.input)).response.status, 200);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.store.entries.get(EXCHANGE_KEYS.snapshot).data, full);
});

test('persistent lease suppresses duplicate cold queries and other branches while a fetch is pending', async () => {
  const h = harness();
  let finish;
  let started;
  const requested = new Promise(resolve => { started = resolve; });
  h.input.fetchImpl = async (...args) => {
    h.calls.push(args);
    started();
    return new Promise(resolve => { finish = resolve; });
  };
  const first = fetchBody(h.input);
  await requested;
  for (const target of [slug, otherSlug]) {
    const result = await fetchBody({ ...h.input, slug: target });
    assert.equal(result.response.status, 202);
    assert.equal(result.body.reason, 'busy');
    assert.ok(result.body.retryAfterSeconds > 0);
  }
  assert.equal(h.calls.length, 1);
  finish(Response.json(FIXTURE));
  assert.equal((await first).response.status, 200);
  assert.equal((await fetchBody({ ...h.input, slug: otherSlug })).response.status, 429);
  h.advance(BRANCH_MIN_GAP_MS);
  h.input.fetchImpl = async () => { h.calls.push({}); return Response.json(FIXTURE); };
  assert.equal((await fetchBody({ ...h.input, slug: otherSlug })).response.status, 200);
  assert.equal(h.calls.length, 2);
});

test('competing lease CAS and expired lease recovery never duplicate a request', async () => {
  const h = harness();
  let raced = false;
  h.store.beforeSet = ({ key, store }) => {
    if (key === BRANCH_GATE_KEY && !raced) {
      raced = true;
      store.seed(key, { leaseId: uuid(50), leaseUntilMs: START + BRANCH_LEASE_MS, nextRequestAtMs: START });
    }
  };
  assert.equal((await fetchBody(h.input)).response.status, 202);
  assert.equal(h.calls.length, 0);
  h.advance(BRANCH_LEASE_MS + 1);
  assert.equal((await fetchBody(h.input)).response.status, 200);
  assert.equal(h.calls.length, 1);
});

for (const [label, makeResponse] of [
  ['403', () => new Response('challenge secret', { status: 403, headers: { 'cf-mitigated': 'challenge' } })],
  ['429', () => new Response('slow down', { status: 429, headers: { 'retry-after': '30000' } })],
  ['challenge header', () => new Response('challenge secret', { status: 200, headers: { 'cf-mitigated': 'challenge' } })],
]) {
  test(`${label} stops after one request and shares breaker cooldown across branches and users`, async () => {
    const h = harness();
    h.input.fetchImpl = async () => { h.calls.push({}); return makeResponse(); };
    const first = await fetchBody(h.input);
    assert.equal(first.response.status, 429);
    assert.equal(h.calls.length, 1);
    assert.equal(first.body.quote, null);
    assert.doesNotMatch(JSON.stringify(first.body), /challenge secret|cf-mitigated|rayId|diagnostics/);
    assert.ok(first.body.retryAfterSeconds >= 6 * 60 * 60);
    h.advance(60_000);
    assert.equal((await fetchBody({ ...h.input, slug: otherSlug })).response.status, 429);
    assert.equal(h.calls.length, 1);
    assert.equal(h.store.entries.get(EXCHANGE_KEYS.breaker).data.blockLevel, 1);
  });
}

for (const [label, fail] of [
  ['500', async () => new Response('upstream error', { status: 500 })],
  ['network error', async () => { throw new Error('network'); }],
  ['invalid JSON', async () => new Response('<html>invalid</html>')],
  ['partial rates', async () => { const value = structuredClone(FIXTURE); value.data.datas = value.data.datas.filter(row => row.currency_code !== 'TWD'); return Response.json(value); }],
]) {
  test(`${label} never retries or caches an incomplete quote and applies shared failure cooldown`, async () => {
    const h = harness();
    h.input.fetchImpl = async () => { h.calls.push({}); return fail(); };
    const first = await fetchBody(h.input);
    assert.equal(first.response.status, 503);
    assert.equal(h.calls.length, 1);
    assert.equal(h.store.entries.has(branchCacheKey(slug)), false);
    assert.equal(first.body.quote, null);
    assert.equal((await fetchBody({ ...h.input, slug: otherSlug })).response.status, 429);
    assert.equal(h.calls.length, 1);
  });
}

test('disabled, missing/invalid control, active breaker and unknown slugs make zero source requests', async () => {
  for (const mode of ['disabled', 'missing', 'invalid', 'blocked', 'unknown']) {
    const h = harness();
    if (mode === 'disabled') h.store.seed(EXCHANGE_KEYS.control, createControl({ enabled: false, nowMs: START, controlVersion: uuid(2), updatedBy: 'manual', disabledReason: 'manual' }));
    if (mode === 'missing') h.store.entries.delete(EXCHANGE_KEYS.control);
    if (mode === 'invalid') h.store.seed(EXCHANGE_KEYS.control, { enabled: true });
    if (mode === 'blocked') h.store.seed(EXCHANGE_KEYS.breaker, { ...createBreaker(uuid(1)), blockedUntil: new Date(START + 60_000).toISOString() });
    const result = await fetchBody({ ...h.input, enabledDefault: 'false', slug: mode === 'unknown' ? '__proto__' : slug });
    assert.equal(result.body.quote, null);
    assert.equal(h.calls.length, 0);
  }
});

test('third challenged attempt auto-disables without overwriting a newer control', async () => {
  const h = harness();
  h.store.seed(EXCHANGE_KEYS.breaker, { ...createBreaker(uuid(1)), blockLevel: 2 });
  h.input.fetchImpl = async () => new Response('', { status: 403 });
  const result = await fetchBody(h.input);
  assert.equal(result.body.enabled, false);
  assert.equal(h.store.entries.get(EXCHANGE_KEYS.control).data.updatedBy, 'breaker');
  assert.equal(h.store.entries.get(EXCHANGE_KEYS.control).data.enabled, false);
});

for (const enabled of [false, true]) {
  test(`control ${enabled ? 're-enable' : 'disable'} during source fetch discards the quote`, async () => {
    const h = harness();
    h.input.fetchImpl = async () => {
      h.store.seed(EXCHANGE_KEYS.control, createControl({ enabled, nowMs: START, controlVersion: uuid(2), updatedBy: 'manual', disabledReason: enabled ? null : 'manual' }));
      return Response.json(FIXTURE);
    };
    const result = await fetchBody(h.input);
    assert.equal(result.body.quote, null);
    assert.equal(h.store.entries.has(branchCacheKey(slug)), false);
    assert.equal(h.store.entries.get(EXCHANGE_KEYS.control).data.controlVersion, uuid(2));
  });
}

test('cache uses control generation, respects expiry, and remains usable during a source cooldown', async () => {
  const h = harness();
  await fetchBody(h.input);
  h.store.seed(EXCHANGE_KEYS.breaker, { ...createBreaker(uuid(1)), blockedUntil: new Date(START + 60_000).toISOString() });
  assert.equal((await fetchBody(h.input)).response.status, 200);
  assert.equal(h.calls.length, 1);
  h.store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, nowMs: START, controlVersion: uuid(2), updatedBy: 'manual' }));
  h.store.seed(EXCHANGE_KEYS.breaker, createBreaker(uuid(2), new Date(START + 60_000).toISOString()));
  const result = await fetchBody(h.input);
  assert.equal(result.body.quote, null);
  assert.equal(result.response.status, 429);
  assert.equal(h.calls.length, 1);
});

test('API rejects non-POST, cross-site, extra IDs/URLs, malformed and oversized input before accessing storage', async () => {
  for (const [method, body, headers] of [
    ['GET', undefined, {}], ['POST', JSON.stringify({ slug }), { origin: 'https://evil.example' }],
    ['POST', '{', {}], ['POST', 'x'.repeat(513), {}], ['POST', JSON.stringify({ slug: 'unknown' }), {}],
    ['POST', JSON.stringify({ slug, url: 'https://evil.example' }), {}], ['POST', 'null', {}],
  ]) {
    const response = await handler(new Request('https://map.example/api/exchange-rates-1965-branch', {
      method, body, headers: { 'content-type': 'application/json', ...headers },
    }));
    assert.equal(response.status, method === 'GET' ? 405 : 400);
    assert.equal((await response.json()).quote, null);
  }
});

test('storage errors and lost cache CAS fail closed and never report a fresh quote', async () => {
  const h = harness();
  h.store.beforeSet = ({ key }) => { if (key === branchCacheKey(slug)) throw new Error('storage'); };
  assert.equal((await fetchBody(h.input)).body.quote, null);
  assert.equal(h.calls.length, 1);
  assert.equal((await fetchBody({ ...h.input, slug: otherSlug })).response.status, 429);
  h.store.getWithMetadata = async () => { throw new Error('unavailable'); };
  assert.equal((await fetchBody(h.input)).response.status, 503);
  assert.equal(h.calls.length, 1);
});

test('cache write conflicts do not return an uncommitted quote or erase the other writer', async () => {
  const h = harness();
  let winner;
  h.store.beforeSet = ({ key, data, store }) => {
    if (key === branchCacheKey(slug) && !winner) {
      winner = { ...data, completedAt: data.completedAt };
      store.seed(key, winner);
    }
  };
  const result = await fetchBody(h.input);
  assert.equal(result.response.status, 202);
  assert.equal(result.body.quote, null);
  assert.deepEqual(h.store.entries.get(branchCacheKey(slug)).data, winner);
  assert.equal(h.calls.length, 1);
});

test('a disable during lease acquisition prevents the source request', async () => {
  const h = harness();
  h.store.beforeSet = ({ key, store }) => {
    if (key === BRANCH_GATE_KEY) store.seed(EXCHANGE_KEYS.control, createControl({ enabled: false,
      nowMs: START, controlVersion: uuid(2), updatedBy: 'manual', disabledReason: 'manual' }));
  };
  assert.equal((await fetchBody(h.input)).body.quote, null);
  assert.equal(h.calls.length, 0);
});

for (const context of ['production', 'deploy-preview', undefined]) {
  test(`manual endpoint uses the isolated runtime blob store: ${context ?? 'missing context'}`, async t => {
    const { setEnvironmentContext } = await import('@netlify/blobs');
    const oldContext = globalThis.netlifyBlobsContext;
    const oldEnv = process.env.NETLIFY_BLOBS_CONTEXT;
    t.after(() => {
      globalThis.netlifyBlobsContext = oldContext;
      if (oldEnv === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT;
      else process.env.NETLIFY_BLOBS_CONTEXT = oldEnv;
    });
    globalThis.netlifyBlobsContext = undefined;
    setEnvironmentContext({ siteID: 'fixture-site', token: 'fixture-token', deployID: 'fixturedeploy', primaryRegion: 'us-east-1',
      edgeURL: 'https://cached.blobs.test', uncachedEdgeURL: 'https://strong.blobs.test' });
    const urls = [];
    const control = createControl({ enabled: false, nowMs: START, controlVersion: uuid(2), updatedBy: 'manual', disabledReason: 'manual' });
    t.mock.method(globalThis, 'fetch', async url => {
      urls.push(new URL(url));
      return Response.json(control, { headers: { etag: 'disabled-control' } });
    });
    const response = await handler(new Request('https://map.example/api/exchange-rates-1965-branch', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://map.example' }, body: JSON.stringify({ slug }),
    }), context ? { deploy: { context } } : undefined);
    assert.equal((await response.json()).reason, 'disabled');
    assert.equal(urls.length, 1);
    const storeName = context === 'production' ? 'site:exchange-rates-1965' : 'deploy:fixturedeploy:exchange-rates-1965';
    assert.equal(urls[0].host, 'strong.blobs.test');
    assert.ok(urls[0].pathname.includes(storeName));
  });
}

test('Netlify Dev without ETags can refresh an expired quote and still suppress concurrent cold requests', async t => {
  const before = process.env.NETLIFY_DEV;
  process.env.NETLIFY_DEV = 'true';
  t.after(() => { if (before === undefined) delete process.env.NETLIFY_DEV; else process.env.NETLIFY_DEV = before; });
  const h = harness();
  const get = h.store.getWithMetadata.bind(h.store), set = h.store.setJSON.bind(h.store);
  h.store.getWithMetadata = async (...args) => {
    const entry = await get(...args); if (entry) delete entry.etag; return entry;
  };
  h.store.setJSON = async (...args) => { const result = await set(...args); delete result.etag; return result; };
  assert.equal((await fetchBody(h.input)).response.status, 200);
  h.advance(BRANCH_QUOTE_TTL_MS + 1);
  const results = await Promise.all([fetchBody(h.input), fetchBody(h.input)]);
  assert.deepEqual(results.map(result => result.response.status).sort(), [200, 202]);
  assert.equal(h.calls.length, 2);
});

test('missing deployed ETag cannot bypass conditional writes, while stale local writers are rejected', async t => {
  const { conditionalSetJSON } = await import('../netlify/functions/_shared/exchange-rates-1965-storage.mjs');
  const before = process.env.NETLIFY_DEV;
  t.after(() => { if (before === undefined) delete process.env.NETLIFY_DEV; else process.env.NETLIFY_DEV = before; });
  const store = new FakeBlobStore();
  const key = 'local-fallback-test';
  store.seed(key, { value: 1 });
  const previous = { data: { value: 1 }, metadata: {} };
  delete process.env.NETLIFY_DEV;
  assert.equal((await conditionalSetJSON(store, key, { value: 2 }, previous)).modified, false);
  assert.deepEqual(store.entries.get(key).data, { value: 1 });
  process.env.NETLIFY_DEV = 'true';
  const get = store.getWithMetadata.bind(store);
  store.getWithMetadata = async (...args) => { const entry = await get(...args); if (entry) delete entry.etag; return entry; };
  store.seed(key, { value: 3 });
  assert.equal((await conditionalSetJSON(store, key, { value: 2 }, previous)).modified, false);
  assert.deepEqual(store.entries.get(key).data, { value: 3 });
});
