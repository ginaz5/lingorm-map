import assert from 'node:assert/strict';
import test from 'node:test';
import { setEnvironmentContext } from '@netlify/blobs';
import handler from '../netlify/functions/exchange-rates-1965-branch.mjs';
import { readBranchRates, branchCacheKey } from '../netlify/functions/_shared/exchange-rates-1965-branch-cache.mjs';
const BRANCH_GATE_KEY = 'exchange-rates-1965/on-demand-gate';
import { buildSnapshot, createControl, EXCHANGE_KEYS } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { BRANCH_API_SCHEMA_VERSION, ORANGE_BRANCHES, parseBranchQueryPayload } from '../src/data/exchange-rates-1965-branch.js';
import { quoteExpiryMs } from '../src/data/exchange-rate-timing.js';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-19T01:00:00.000Z');
const [slug, otherSlug] = Object.keys(ORANGE_BRANCHES);
const enabledControl = (nowMs = START - 1000, controlVersion = uuid(1)) => createControl({
  enabled: true, nowMs, controlVersion, updatedBy: 'manual',
});
const disabledControl = () => createControl({ enabled: false, nowMs: START, controlVersion: uuid(2),
  updatedBy: 'manual', disabledReason: 'manual' });

function quote(nowMs = START, target = slug) {
  return {
    schemaVersion: BRANCH_API_SCHEMA_VERSION, slug: target, controlVersion: uuid(1),
    attemptedAt: new Date(nowMs).toISOString(), completedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(quoteExpiryMs(nowMs)).toISOString(),
    branch: { slug: target, ...ORANGE_BRANCHES[target], status: 'ok', rates: {
      USD_1965: { denom: 'USD_1965', rateScaledE6: 32_770_000, displayDecimals: 2, unavailableReason: null },
      TWD_1965: { denom: 'TWD_1965', rateScaledE6: 995_000, displayDecimals: 3, unavailableReason: null },
    } },
  };
}

function snapshot(saved = quote()) {
  return buildSnapshot({ runId: uuid(10), controlVersion: saved.controlVersion,
    attemptedAtMs: Date.parse(saved.attemptedAt), completedAtMs: Date.parse(saved.completedAt),
    sourceBranchIds: [saved.branch.officialId], branches: [{ ...saved.branch, sourceUpdatedAtMs: null }],
    unknownBranchCount: 0, missingBranchCount: 0 });
}

function harness(t) {
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl());
  // These deliberately invalid source-control records must never be read.
  store.seed(EXCHANGE_KEYS.breaker, { private: 'breaker' });
  store.seed(BRANCH_GATE_KEY, { private: 'gate' });
  let now = START;
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected_source_request'); });
  return { store, advance: ms => { now += ms; }, nowImpl: () => now,
    async read(options = {}) {
      const before = structuredClone([...store.entries]);
      const response = await readBranchRates({ store, slug, enabledDefault: 'false', nowImpl: () => now, ...options });
      const body = await response.json();
      assert.equal(upstream.mock.callCount(), 0);
      assert.equal(store.calls.some(call => call.operation !== 'get'), false);
      assert.equal(store.calls.some(call => [EXCHANGE_KEYS.breaker, BRANCH_GATE_KEY].includes(call.key)), false);
      if (!options.allowControlChange) assert.deepEqual([...store.entries], before);
      return { response, body };
    },
  };
}

test('public refresh returns only the saved public quote without source requests or storage writes', async t => {
  const h = harness(t);
  const saved = { ...quote(), privateToken: 'PRIVATE_TOKEN', branch: { ...quote().branch, privateHeader: 'PRIVATE_HEADER' } };
  h.store.seed(branchCacheKey(slug), saved);
  const { response, body } = await h.read();
  assert.equal(response.status, 200);
  assert.deepEqual(body.quote, quote());
  assert.ok(parseBranchQueryPayload(body, slug));
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_|privateToken|privateHeader/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('netlify-cdn-cache-control'), 'no-store');
  assert.equal(h.store.calls.filter(call => call.key === EXCHANGE_KEYS.control).length, 2);
});

test('public refresh reads the legacy snapshot without seeding a branch or extending expiry', async t => {
  const h = harness(t);
  const saved = snapshot();
  h.store.seed(EXCHANGE_KEYS.snapshot, saved);
  const { response, body } = await h.read();
  assert.equal(response.status, 200);
  assert.equal(body.quote.expiresAt, saved.expiresAt);
  assert.equal(h.store.entries.has(branchCacheKey(slug)), false);
  assert.equal(body.quote.branch.rates.USD_1965.rateScaledE6, 32_770_000);
  assert.equal(body.quote.branch.rates.TWD_1965.rateScaledE6, 995_000);
});

for (const mode of ['missing', 'expired', 'partial', 'wrong_version', 'wrong_branch', 'future', 'predates_enable', 'invalid_snapshot']) {
  test(`public refresh with ${mode} data reports unavailable and never requests or publishes rates`, async t => {
    const h = harness(t);
    let saved = quote();
    if (mode === 'expired') h.advance(quoteExpiryMs(START) - START);
    if (mode === 'partial') saved.branch.rates.TWD_1965.rateScaledE6 = null;
    if (mode === 'wrong_version') saved.controlVersion = uuid(9);
    if (mode === 'wrong_branch') saved = quote(START, otherSlug);
    if (mode === 'future') saved = quote(START + 1000);
    if (mode === 'predates_enable') h.store.seed(EXCHANGE_KEYS.control, enabledControl(START + 1000));
    if (!['missing', 'invalid_snapshot'].includes(mode)) h.store.seed(branchCacheKey(slug), saved);
    if (mode === 'invalid_snapshot') h.store.seed(EXCHANGE_KEYS.snapshot, { branches: 'invalid' });
    const { response, body } = await h.read();
    assert.equal(response.status, 503);
    assert.equal(body.reason, 'unavailable');
    assert.equal(body.quote, null);
    assert.equal(body.retryAfterSeconds, 60);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.ok(parseBranchQueryPayload(body, slug));
    assert.equal(h.store.calls.filter(call => call.key === EXCHANGE_KEYS.control).length, 2);
  });
}

for (const enabledDefault of ['true', 'false']) {
  test(`a missing control with env ${enabledDefault} never initializes control or source work`, async t => {
    const h = harness(t);
    h.store.entries.delete(EXCHANGE_KEYS.control);
    const { body, response } = await h.read({ enabledDefault });
    assert.equal(response.status, 503);
    assert.equal(body.reason, enabledDefault === 'true' ? 'unavailable' : 'disabled');
    assert.equal(body.enabled, enabledDefault === 'true');
    assert.equal(body.controlVersion, null);
    assert.equal(h.store.entries.has(EXCHANGE_KEYS.control), false);
  });
}

test('disabled service hides existing quotes without inspecting source state', async t => {
  const h = harness(t);
  h.store.seed(EXCHANGE_KEYS.control, disabledControl());
  h.store.seed(branchCacheKey(slug), quote());
  const { response, body } = await h.read();
  assert.equal(response.status, 503);
  assert.equal(body.reason, 'disabled');
  assert.equal(body.enabled, false);
  assert.equal(body.quote, null);
  assert.equal(h.store.calls.length, 1);
});

for (const change of ['disable', 're_enable', 'remove']) {
  test(`a control ${change} during the cache read suppresses the saved quote without writes`, async t => {
    const h = harness(t);
    h.store.seed(branchCacheKey(slug), quote());
    const get = h.store.getWithMetadata.bind(h.store);
    h.store.getWithMetadata = async (...args) => {
      const entry = await get(...args);
      if (args[0] === branchCacheKey(slug)) {
        if (change === 'remove') h.store.entries.delete(EXCHANGE_KEYS.control);
        else h.store.seed(EXCHANGE_KEYS.control, change === 'disable' ? disabledControl() : enabledControl(START, uuid(2)));
      }
      return entry;
    };
    const { response, body } = await h.read({ allowControlChange: true });
    assert.equal(response.status, 503);
    assert.equal(body.quote, null);
    assert.equal(body.reason, ['disable', 'remove'].includes(change) ? 'disabled' : 'stale_control');
  });
}

test('expiry during a storage read never returns the expired quote', async t => {
  const h = harness(t);
  const saved = quote();
  h.store.seed(branchCacheKey(slug), saved);
  const get = h.store.getWithMetadata.bind(h.store);
  h.store.getWithMetadata = async (...args) => {
    const entry = await get(...args);
    if (args[0] === branchCacheKey(slug)) h.advance(Date.parse(saved.expiresAt) - START);
    return entry;
  };
  const { response, body } = await h.read();
  assert.equal(response.status, 503);
  assert.equal(body.reason, 'unavailable');
});

for (const mode of ['invalid_control', 'invalid_default', 'storage_error', 'invalid_slug']) {
  test(`${mode} fails closed without source requests or writes`, async t => {
    const h = harness(t);
    if (mode === 'invalid_control') h.store.seed(EXCHANGE_KEYS.control, { enabled: true });
    if (mode === 'invalid_default') h.store.entries.delete(EXCHANGE_KEYS.control);
    if (mode === 'storage_error') h.store.getWithMetadata = async () => { throw new Error('PRIVATE_STORAGE_ERROR'); };
    const { response, body } = await h.read({ enabledDefault: mode === 'invalid_default' ? 'invalid' : 'false',
      slug: mode === 'invalid_slug' ? '__proto__' : slug });
    assert.equal(response.status, mode === 'invalid_slug' ? 400 : 503);
    assert.equal(body.reason, mode === 'invalid_slug' ? 'invalid_request' : 'storage_unavailable');
    assert.equal(body.quote, null);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_/);
  });
}

for (const context of ['production', 'deploy-preview', undefined]) {
  test(`public endpoint performs only isolated Blobs GETs for ${context ?? 'missing context'}`, async t => {
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
    const now = Date.now();
    const saved = quote(now);
    const control = enabledControl(now - 1000);
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (input, options) => {
      const url = new URL(input);
      calls.push({ url, options });
      const key = decodeURIComponent(url.pathname);
      if (key.endsWith(EXCHANGE_KEYS.control)) return Response.json(control, { headers: { etag: 'control' } });
      if (key.endsWith(branchCacheKey(slug))) return Response.json(saved, { headers: { etag: 'quote' } });
      return new Response(null, { status: 404 });
    });
    const response = await handler(new Request('https://map.example/api/exchange-rates-1965-branch', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://map.example' }, body: JSON.stringify({ slug }),
    }), context ? { deploy: { context } } : undefined);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).quote, saved);
    assert.equal(calls.length, 3);
    const storeName = context === 'production' ? 'site:exchange-rates-1965' : 'deploy:fixturedeploy:exchange-rates-1965';
    for (const { url, options } of calls) {
      assert.equal(url.hostname, 'strong.blobs.test');
      assert.equal((options?.method ?? 'GET').toUpperCase(), 'GET');
      assert.ok(decodeURIComponent(url.pathname).includes(storeName));
    }
  });
}
