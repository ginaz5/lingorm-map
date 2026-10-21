import assert from 'node:assert/strict';
import test from 'node:test';
import FIXTURE from './fixtures/superrich1965/exchange-rate-00.json' with { type: 'json' };
import { ORANGE_BRANCHES, isValidBranchQuote, parseBranchCachePayload } from '../src/data/exchange-rates-1965-branch.js';
import { quoteExpiryMs, nextUtcHalfHour } from '../src/data/exchange-rate-timing.js';
import { buildSnapshot as greenSnapshot } from '../netlify/functions/_shared/exchange-rates-contract.mjs';
import { runSlowBatch, BATCH_JOB_KEY, BATCH_BUDGET_MS } from '../netlify/functions/_shared/exchange-rates-1965-background.mjs';
import { branchCacheKey, queryBranchRates } from '../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { EXCHANGE_KEYS, createControl } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { serveBranchCache } from '../netlify/functions/exchange-rates-1965-cache.mjs';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-17T01:00:00.000Z');
const [slug, otherSlug, thirdSlug] = Object.keys(ORANGE_BRANCHES);
function harness() {
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, nowMs: START - 1000, controlVersion: uuid(1), updatedBy: 'manual' }));
  let now = START, sequence = 10;
  const source = [], delays = [];
  const input = { store, nowImpl: () => now, randomUUIDImpl: () => uuid(sequence++), fetchImpl: async (url, options) => {
    source.push({ url, options, at: now });
    now += 500;
    return Response.json(FIXTURE);
  }, sleepImpl: async ms => { delays.push(ms); now += ms; } };
  const seedJob = () => store.seed(BATCH_JOB_KEY, { token: uuid(sequence++), controlVersion: uuid(1),
    scheduledAtMs: now, deadlineAtMs: now + BATCH_BUDGET_MS, status: 'pending', leaseId: null });
  const run = (options = {}) => runSlowBatch({ ...input, token: store.entries.get(BATCH_JOB_KEY)?.data.token, ...options });
  return { store, input, source, delays, seedJob, run, advance: ms => { now += ms; } };
}

test('one claimed batch fetches 38 branches sequentially with random 2–5 second gaps', async () => {
  const h = harness();
  h.seedJob();
  assert.equal(h.source.length, 0);
  const random = [0, .5, 1]; let index = 0;
  const result = await h.run({ randomImpl: () => random[index++ % random.length] });
  assert.equal(result.status, 'complete');
  assert.equal(result.loaded, 38);
  assert.equal(h.source.length, 38);
  assert.equal(h.delays.length, 37);
  assert.deepEqual(h.delays.slice(0, 3), [2000, 3500, 5000]);
  for (let i = 1; i < h.source.length; i++) assert.ok(h.source[i].at - h.source[i - 1].at >= 2500);
  for (const target of Object.keys(ORANGE_BRANCHES)) assert.ok(isValidBranchQuote(h.store.entries.get(branchCacheKey(target)).data));
  assert.equal(h.store.entries.has(EXCHANGE_KEYS.snapshot), false);
  const publicCache = await (await serveBranchCache(h.input)).json();
  assert.equal(publicCache.quotes.length, 38);
  assert.ok(parseBranchCachePayload(publicCache));
  assert.equal(JSON.stringify(publicCache).includes(h.store.entries.get(BATCH_JOB_KEY).data.token), false);
});

test('duplicate worker and invalid tokens never request rates twice', async () => {
  const h = harness();
  h.seedJob();
  assert.equal((await h.run({ token: uuid(999) })).status, 'unauthorized');
  await h.run({ slugs: [slug] });
  assert.equal((await h.run()).status, 'unauthorized');
  assert.equal(h.source.length, 1);
});

test('warm branch caches are reused without source requests or artificial waits', async () => {
  const h = harness();
  await queryBranchRates({ ...h.input, slug }); h.advance(2000);
  await queryBranchRates({ ...h.input, slug: otherSlug });
  h.source.length = 0;
  h.seedJob();
  assert.equal((await h.run({ slugs: [slug, otherSlug] })).loaded, 0);
  assert.equal(h.source.length, 0);
  assert.equal(h.delays.length, 0);
});

for (const blockedStatus of [403, 429, 500]) {
  test(`${blockedStatus} stops a slow job and preserves successful cached branches`, async () => {
    const h = harness();
    const original = h.input.fetchImpl;
    let count = 0;
    h.input.fetchImpl = async (...args) => {
      if (++count === 2) return new Response('', { status: blockedStatus });
      return original(...args);
    };
    h.seedJob();
    const result = await h.run({ slugs: [slug, otherSlug, thirdSlug], randomImpl: () => 0 });
    assert.equal(result.status, 'stopped');
    assert.equal(result.stoppedSlug, otherSlug);
    assert.equal(result.loaded, 1);
    assert.equal(count, 2);
    assert.ok(h.store.entries.get(branchCacheKey(slug)));
    assert.equal(h.store.entries.has(branchCacheKey(otherSlug)), false);
    assert.equal(h.store.entries.has(branchCacheKey(thirdSlug)), false);
    assert.equal((await (await serveBranchCache(h.input)).json()).quotes.length, 1);
  });
}

test('first-branch challenge logs background source diagnostics and identifies the stopped branch', async t => {
  const messages = [];
  t.mock.method(console, 'info', text => messages.push(JSON.parse(text)));
  const h = harness();
  h.seedJob();
  const token = h.store.entries.get(BATCH_JOB_KEY).data.token;
  let calls = 0;
  const result = await h.run({ fetchImpl: async () => {
    calls++;
    return new Response('PRIVATE_CHALLENGE_BODY', { status: 403, headers: {
      'cf-mitigated': 'challenge', 'cf-ray': 'test-ray-CMH', 'content-type': 'text/html',
    } });
  } });
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'cooldown');
  assert.equal(result.stoppedSlug, slug);
  assert.equal(result.loaded, 0);
  assert.equal(calls, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].trigger, 'background');
  assert.equal(messages[0].blockedStatus, 403);
  assert.equal(messages[0].sourceRequestCount, 1);
  assert.equal(messages[0].diagnostics[0].cfMitigated, 'challenge');
  assert.equal(messages[0].diagnostics[0].rayId, 'test-ray-CMH');
  const text = JSON.stringify({ result, messages });
  assert.equal(text.includes(token), false);
  assert.equal(text.includes('PRIVATE_CHALLENGE_BODY'), false);
  const cache = await (await serveBranchCache(h.input)).json();
  assert.deepEqual(cache.quotes, []);
  assert.equal(Object.hasOwn(cache, 'diagnostics'), false);
});

test('refresh at the next half-hour retains still-valid old quotes when a new fetch fails', async () => {
  const h = harness();
  await queryBranchRates({ ...h.input, slug });
  const old = structuredClone(h.store.entries.get(branchCacheKey(slug)).data);
  h.advance(30 * 60_000);
  h.seedJob();
  const result = await h.run({ slugs: [slug], fetchImpl: async () => new Response('', { status: 500 }) });
  assert.equal(result.status, 'stopped');
  assert.deepEqual(h.store.entries.get(branchCacheKey(slug)).data, old);
  const body = await (await serveBranchCache(h.input)).json();
  assert.deepEqual(body.quotes, [old]);
});

test('batch refresh renews due quotes even while their grace-period cache is valid', async () => {
  const h = harness();
  await queryBranchRates({ ...h.input, slug });
  const old = h.store.entries.get(branchCacheKey(slug)).data;
  h.advance(30 * 60_000);
  // Ordinary manual reads still reuse the valid quote.
  assert.equal((await queryBranchRates({ ...h.input, slug })).status, 200);
  assert.equal(h.source.length, 1);
  h.seedJob();
  assert.equal((await h.run({ slugs: [slug] })).loaded, 1);
  assert.equal(h.source.length, 2);
  assert.notEqual(h.store.entries.get(branchCacheKey(slug)).data.attemptedAt, old.attemptedAt);
});

test('green snapshots and orange quotes share the exact boundary-based expiry, not a fixed duration', async () => {
  const h = harness();
  h.advance(29 * 60_000);
  const response = await queryBranchRates({ ...h.input, slug });
  const { quote } = await response.json();
  const attemptedAtMs = Date.parse(quote.attemptedAt);
  const green = greenSnapshot({ runId: uuid(99), controlVersion: uuid(1), attemptedAtMs,
    completedAtMs: attemptedAtMs, sourceBranchIds: [], branches: [], unknownBranchCount: 0, missingBranchCount: 0 });
  assert.equal(quote.expiresAt, green.expiresAt);
  assert.equal(Date.parse(quote.expiresAt), quoteExpiryMs(attemptedAtMs));
  assert.equal(Date.parse(quote.expiresAt) - attemptedAtMs, 36 * 60_000);
  assert.equal(nextUtcHalfHour(attemptedAtMs), START + 30 * 60_000);
  assert.equal(isValidBranchQuote({ ...quote, expiresAt: new Date(quoteExpiryMs(attemptedAtMs) + 1).toISOString() }), false);
});

test('disabled control, changed generation and a job deadline stop without any upstream request', async () => {
  for (const mode of ['disabled', 'generation', 'deadline']) {
    const h = harness();
    h.seedJob();
    if (mode === 'deadline') h.advance(12 * 60_000 - 6000);
    else h.store.seed(EXCHANGE_KEYS.control, createControl({ enabled: mode === 'generation', nowMs: START,
      controlVersion: uuid(2), updatedBy: 'manual', disabledReason: mode === 'disabled' ? 'manual' : null }));
    assert.equal((await h.run()).status, 'stopped');
    assert.equal(h.source.length, 0);
  }
});

test('read-only cache endpoint excludes corrupt, expired and wrong-generation entries without writes or upstream access', async () => {
  const h = harness();
  await queryBranchRates({ ...h.input, slug });
  const quote = h.store.entries.get(branchCacheKey(slug)).data;
  h.store.seed(branchCacheKey(otherSlug), { ...quote, slug: otherSlug });
  h.store.calls.length = 0;
  const response = await serveBranchCache(h.input);
  assert.equal((await response.json()).quotes.length, 1);
  assert.equal(h.store.calls.some(call => call.operation === 'set'), false);
  assert.equal(h.source.length, 1);
  h.advance(66 * 60_000);
  assert.equal((await (await serveBranchCache(h.input)).json()).quotes.length, 0);
});

test('cache reads recheck controls and never serve quotes after a concurrent disable', async () => {
  const h = harness();
  await queryBranchRates({ ...h.input, slug });
  const read = h.store.getWithMetadata.bind(h.store);
  h.store.getWithMetadata = async (...args) => {
    if (args[0] === branchCacheKey(slug)) h.store.seed(EXCHANGE_KEYS.control,
      createControl({ enabled: false, nowMs: START, controlVersion: uuid(2), updatedBy: 'manual', disabledReason: 'manual' }));
    return read(...args);
  };
  const body = await (await serveBranchCache(h.input)).json();
  assert.equal(body.enabled, false);
  assert.deepEqual(body.quotes, []);
});

test('competing worker acquisition and an older worker cannot overwrite a newer job', async () => {
  const h = harness();
  h.seedJob();
  let raced = false;
  h.store.beforeSet = ({ key, data, store }) => {
    if (key === BATCH_JOB_KEY && data.status === 'running' && !raced) {
      raced = true;
      store.seed(key, { ...data, leaseId: uuid(998) });
    }
  };
  assert.equal((await h.run({ slugs: [slug] })).status, 'skipped');
  assert.equal(h.source.length, 0);
  assert.equal(h.store.entries.get(BATCH_JOB_KEY).data.leaseId, uuid(998));
});

test('cache parser rejects duplicate branches, swapped versions and disabled quotes', async () => {
  const h = harness();
  await queryBranchRates({ ...h.input, slug });
  const body = await (await serveBranchCache(h.input)).json();
  assert.equal(parseBranchCachePayload({ ...body, quotes: [body.quotes[0], body.quotes[0]] }), null);
  assert.equal(parseBranchCachePayload({ ...body, controlVersion: uuid(3) }), null);
  assert.equal(parseBranchCachePayload({ ...body, enabled: false }), null);
});
