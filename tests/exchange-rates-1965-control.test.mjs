import assert from 'node:assert/strict';
import test from 'node:test';
import { runControlCommand } from '../scripts/exchange-rates-1965-control.mjs';
import { autoDisable } from '../netlify/functions/_shared/exchange-rates-1965-control.mjs';
import { createBreaker, EXCHANGE_KEYS } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { enabledControl, FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';

test('orange control status reads only current control and breaker, preserving retired blobs', async () => {
  const store = new FakeBlobStore();
  const control = enabledControl(uuid(1), Date.parse('2026-10-24T01:00:00Z'));
  const breaker = createBreaker(uuid(1));
  store.seed(EXCHANGE_KEYS.control, control);
  store.seed(EXCHANGE_KEYS.breaker, breaker);
  store.seed('exchange-rates-1965/snapshot', { retired: true });
  store.seed('exchange-rates-1965/last-attempt', { retired: true });
  const before = structuredClone([...store.entries]);

  assert.deepEqual(await runControlCommand(['status'], { store }), { control, breaker });
  assert.deepEqual(store.calls.map(call => [call.operation, call.key]), [
    ['get', EXCHANGE_KEYS.control], ['get', EXCHANGE_KEYS.breaker],
  ]);
  assert.deepEqual([...store.entries], before);
});

test('breaker auto-disable cannot overwrite a concurrent manual enable or its newer breaker', async () => {
  const store = new FakeBlobStore();
  const nowMs = Date.parse('2026-10-24T01:00:00Z');
  const control = enabledControl(uuid(1), nowMs);
  const breaker = createBreaker(uuid(1), new Date(nowMs + 60_000).toISOString());
  store.seed(EXCHANGE_KEYS.control, control);
  store.seed(EXCHANGE_KEYS.breaker, breaker);
  const controlEntry = await store.getWithMetadata(EXCHANGE_KEYS.control);
  const breakerEntry = await store.getWithMetadata(EXCHANGE_KEYS.breaker);
  const newerControl = enabledControl(uuid(3), nowMs + 1000);
  const newerBreaker = createBreaker(uuid(3), breaker.blockedUntil);
  let raced = false;
  store.beforeSet = ({ key }) => {
    if (key === EXCHANGE_KEYS.breaker && !raced) {
      raced = true;
      store.seed(EXCHANGE_KEYS.control, newerControl);
      store.seed(EXCHANGE_KEYS.breaker, newerBreaker);
    }
  };

  assert.equal(await autoDisable(store, controlEntry, control, breakerEntry, nowMs, () => uuid(2)), true);
  assert.equal(raced, true);
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.control).data, newerControl);
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.breaker).data, newerBreaker);
});
