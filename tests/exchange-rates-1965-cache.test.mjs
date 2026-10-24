import assert from 'node:assert/strict';
import test from 'node:test';
import FIXTURE from './fixtures/superrich1965/exchange-rate-00.json' with { type: 'json' };
import { ORANGE_BRANCHES, isValidBranchQuote, parseBranchCachePayload } from '../src/data/exchange-rates-1965-branch.js';
import { quoteExpiryMs, nextUtcHalfHour } from '../src/data/exchange-rate-timing.js';
import { buildSnapshot as greenSnapshot } from '../netlify/functions/_shared/exchange-rates-contract.mjs';
import { branchCacheKey, queryBranchRates } from '../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { EXCHANGE_KEYS, createControl } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { serveBranchCache } from '../netlify/functions/exchange-rates-1965-cache.mjs';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-17T01:00:00.000Z');
const [slug, otherSlug] = Object.keys(ORANGE_BRANCHES);
function harness() {
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, nowMs: START - 1000, controlVersion: uuid(1), updatedBy: 'manual' }));
  let now = START, sequence = 10;
  const source = [];
  const input = { store, nowImpl: () => now, randomUUIDImpl: () => uuid(sequence++), fetchImpl: async (url, options) => {
    source.push({ url, options, at: now });
    now += 500;
    return Response.json(FIXTURE);
  } };
  return { store, input, source, advance: ms => { now += ms; } };
}

test('collector refresh at the next half-hour retains still-valid old quotes when a new fetch fails', async () => {
  const h = harness();
  await queryBranchRates({ ...h.input, slug });
  const old = structuredClone(h.store.entries.get(branchCacheKey(slug)).data);
  h.advance(30 * 60_000);
  const response = await queryBranchRates({ ...h.input, slug, refreshDue: true,
    fetchImpl: async () => new Response('', { status: 500 }) });
  assert.equal(response.status, 503);
  assert.deepEqual(h.store.entries.get(branchCacheKey(slug)).data, old);
  const body = await (await serveBranchCache(h.input)).json();
  assert.deepEqual(body.quotes, [old]);
});

test('collector refresh renews due quotes even while their grace-period cache is valid', async () => {
  const h = harness();
  await queryBranchRates({ ...h.input, slug });
  const old = h.store.entries.get(branchCacheKey(slug)).data;
  h.advance(30 * 60_000);
  // Ordinary collector reads still reuse the valid quote.
  assert.equal((await queryBranchRates({ ...h.input, slug })).status, 200);
  assert.equal(h.source.length, 1);
  assert.equal((await queryBranchRates({ ...h.input, slug, refreshDue: true })).status, 200);
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

test('cache parser rejects duplicate branches, swapped versions and disabled quotes', async () => {
  const h = harness();
  await queryBranchRates({ ...h.input, slug });
  const body = await (await serveBranchCache(h.input)).json();
  assert.equal(parseBranchCachePayload({ ...body, quotes: [body.quotes[0], body.quotes[0]] }), null);
  assert.equal(parseBranchCachePayload({ ...body, controlVersion: uuid(3) }), null);
  assert.equal(parseBranchCachePayload({ ...body, enabled: false }), null);
});
