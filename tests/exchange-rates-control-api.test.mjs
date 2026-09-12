import assert from 'node:assert/strict';
import test from 'node:test';

import { EXCHANGE_KEYS, buildSnapshot, createBreaker, createControl } from '../netlify/functions/_shared/exchange-rates-contract.mjs';
import { changeControl, ensureFetchControl, readEffectiveControl } from '../netlify/functions/_shared/exchange-rates-control.mjs';
import { serveExchangeRates } from '../netlify/functions/exchange-rates.mjs';
import exchangeRatesHandler from '../netlify/functions/exchange-rates.mjs';
import { parseArgs, runControlCommand } from '../scripts/exchange-rates-control.mjs';
import { parseBranchExchange } from '../src/data/exchange-rates.js';
import { FakeBlobStore, enabledControl, sourceQuote, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-09-09T00:00:00Z');

function validSnapshot(controlVersion = uuid(1), attemptedAtMs = START + 1_000) {
  const quote = parseBranchExchange(sourceQuote('H01'), { officialId: 10, expectedBranchCode: 'H01' });
  return buildSnapshot({
    runId: uuid(9), controlVersion, attemptedAtMs, completedAtMs: attemptedAtMs + 1_000,
    sourceBranchIds: [10], unknownBranchCount: 0, missingBranchCount: 0,
    branches: [{ slug: 'superrich-thailand-10', officialId: 10, branchCode: 'H01', status: quote.status, rates: quote.rates }],
  });
}

test('missing control falls back without writing; enabled fetch initialization writes once then re-reads', async () => {
  const disabledStore = new FakeBlobStore();
  assert.deepEqual(await readEffectiveControl(disabledStore, undefined), { entry: null, control: null, enabled: false });
  assert.equal(disabledStore.calls.filter(call => call.operation === 'set').length, 0);

  const store = new FakeBlobStore();
  const effective = await ensureFetchControl(store, { enabledDefault: 'true', nowMs: START, randomUUIDImpl: () => uuid(1) });
  assert.equal(effective.control.controlVersion, uuid(1));
  assert.deepEqual(store.calls.map(call => call.operation), ['get', 'set', 'get']);
  assert.deepEqual(store.calls[1].options, { onlyIfNew: true });
});

test('enabled fallback initialization adopts a competing stored control version', async () => {
  const store = new FakeBlobStore();
  store.beforeSet = ({ key }) => {
    if (key === EXCHANGE_KEYS.control) store.seed(key, enabledControl(uuid(2), START));
  };
  const effective = await ensureFetchControl(store, {
    enabledDefault: 'true', nowMs: START, randomUUIDImpl: () => uuid(1),
  });
  assert.equal(effective.control.controlVersion, uuid(2));
  assert.deepEqual(store.calls.map(call => call.operation), ['get', 'set', 'get']);
});

test('manual control changes version and preserves a future block while resetting counters', async () => {
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), START));
  const blockedUntil = new Date(START + 60_000).toISOString();
  store.seed(EXCHANGE_KEYS.breaker, { ...createBreaker(uuid(1), blockedUntil), blockLevel: 2, consecutiveFailedRuns: 2 });
  const disabled = await changeControl(store, {
    enabled: false, reason: 'maintenance', nowMs: START + 1_000, randomUUIDImpl: () => uuid(2),
  });
  assert.equal(disabled.controlVersion, uuid(2));
  assert.equal(disabled.disabledReason, 'maintenance');
  const breaker = store.entries.get(EXCHANGE_KEYS.breaker).data;
  assert.deepEqual(breaker, createBreaker(uuid(2), blockedUntil));
});

test('manual control validates breaker state before changing the control', async () => {
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), START));
  store.seed(EXCHANGE_KEYS.breaker, { invalid: true });
  await assert.rejects(
    changeControl(store, { enabled: false, reason: 'manual', nowMs: START, randomUUIDImpl: () => uuid(2) }),
    /invalid_breaker/
  );
  assert.equal(store.entries.get(EXCHANGE_KEYS.control).data.controlVersion, uuid(1));
});

test('admin CLI validates commands and reports status without exposing blob metadata', async () => {
  assert.deepEqual(parseArgs(['disable', '--reason', 'source_review']), { command: 'disable', reason: 'source_review' });
  assert.throws(() => parseArgs(['disable', '--reason', '<bad>']), /reason/);
  assert.throws(() => parseArgs(['delete']), /Usage/);
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), START));
  store.seed(EXCHANGE_KEYS.breaker, createBreaker(uuid(1)));
  store.seed(EXCHANGE_KEYS.snapshot, validSnapshot(uuid(1)));
  const status = await runControlCommand(['status'], { store });
  assert.equal(status.control.enabled, true);
  assert.equal(status.snapshot.runId, uuid(9));
  assert.ok(!JSON.stringify(status).includes('etag'));
});

test('public API always uses fixed outer fields, no-store headers, and hides unusable snapshots', async () => {
  const absent = await serveExchangeRates({ store: new FakeBlobStore(), enabledDefault: undefined, nowMs: START });
  assert.deepEqual(await absent.json(), {
    schemaVersion: 1, checkedAt: new Date(START).toISOString(), enabled: false, controlVersion: null, snapshot: null,
  });
  assert.equal(absent.headers.get('cache-control'), 'no-store');
  assert.equal(absent.headers.get('netlify-cdn-cache-control'), 'no-store');

  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), START));
  store.seed(EXCHANGE_KEYS.snapshot, validSnapshot(uuid(1)));
  const fresh = await serveExchangeRates({ store, nowMs: START + 2_000 });
  assert.equal((await fresh.json()).snapshot.runId, uuid(9));

  const expired = await serveExchangeRates({ store, nowMs: Date.parse('2026-09-09T00:31:30Z') });
  assert.equal((await expired.json()).snapshot, null);

  store.seed(EXCHANGE_KEYS.snapshot, { bad: true });
  const invalid = await serveExchangeRates({ store, nowMs: START });
  assert.equal(invalid.status, 503);
  assert.deepEqual(await invalid.json(), {
    schemaVersion: 1, checkedAt: new Date(START).toISOString(), enabled: null,
    controlVersion: null, snapshot: null, error: 'invalid_snapshot',
  });
});

test('API second control read prevents a disable or re-enable race from exposing old numbers', async () => {
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), START));
  store.seed(EXCHANGE_KEYS.snapshot, validSnapshot(uuid(1)));
  let controlReads = 0;
  const original = store.getWithMetadata.bind(store);
  store.getWithMetadata = async (key, options) => {
    if (key === EXCHANGE_KEYS.control && ++controlReads === 2) {
      store.seed(key, enabledControl(uuid(2), START + 500));
    }
    return original(key, options);
  };
  const response = await serveExchangeRates({ store, nowMs: START + 2_000 });
  const body = await response.json();
  assert.equal(body.controlVersion, uuid(2));
  assert.equal(body.snapshot, null);
});

test('non-GET API errors retain the public outer contract and no-store headers', async () => {
  const response = await exchangeRatesHandler(new Request('https://example.test/api/exchange-rates', { method: 'POST' }));
  const body = await response.json();
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(body), ['schemaVersion', 'checkedAt', 'enabled', 'controlVersion', 'snapshot', 'error']);
  assert.equal(body.error, 'method_not_allowed');
});
