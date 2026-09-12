import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSnapshot, createBreaker, createControl, environmentEnabled, EXCHANGE_KEYS,
  isValidBreaker, isValidControl, isValidSnapshot, nextUtcHalfHour,
} from '../netlify/functions/_shared/exchange-rates-contract.mjs';
import { BREAKER_BACKOFF_MS, nextBreakerState, parseRetryAfter } from '../netlify/functions/_shared/exchange-rates-breaker.mjs';
import { createAdminStore, createRuntimeStore, conditionalSetJSON, readEntry } from '../netlify/functions/_shared/exchange-rates-storage.mjs';
import { sourceQuote, uuid } from './helpers/exchange-rates-store.mjs';
import { parseBranchExchange } from '../src/data/exchange-rates.js';

const START = Date.parse('2026-09-09T00:07:00Z');

test('control, breaker and snapshot contracts reject malformed state', () => {
  const control = createControl({ enabled: true, nowMs: START, controlVersion: uuid(1), updatedBy: 'manual' });
  assert.ok(isValidControl(control));
  assert.ok(!isValidControl({ ...control, controlVersion: '<script>' }));
  assert.ok(isValidBreaker(createBreaker(control.controlVersion)));
  assert.ok(!isValidBreaker({ ...createBreaker(control.controlVersion), blockLevel: 4 }));
  assert.equal(environmentEnabled(undefined), false);
  assert.equal(environmentEnabled('true'), true);
  assert.throws(() => environmentEnabled('1'), /must be true or false/);

  const quote = parseBranchExchange(sourceQuote('H01'), { officialId: 10, expectedBranchCode: 'H01' });
  const snapshot = buildSnapshot({
    runId: uuid(2), controlVersion: control.controlVersion, attemptedAtMs: START,
    completedAtMs: START + 1_000, sourceBranchIds: [10], unknownBranchCount: 0,
    missingBranchCount: 0,
    branches: [{ slug: 'superrich-thailand-10', officialId: 10, branchCode: 'H01', status: quote.status, rates: quote.rates }],
  });
  assert.ok(isValidSnapshot(snapshot));
  assert.equal(snapshot.nextUpdateAt, '2026-09-09T00:30:00.000Z');
  assert.equal(snapshot.expiresAt, '2026-09-09T00:31:30.000Z');
  assert.equal(nextUtcHalfHour(Date.parse('2026-09-09T00:30:00Z')), Date.parse('2026-09-09T01:00:00Z'));
  assert.ok(!JSON.stringify(snapshot).includes('<script>'));
  assert.ok(!isValidSnapshot({ ...snapshot, expiresAt: '2026-09-09T00:32:00.000Z' }));
  assert.ok(!isValidSnapshot({ ...snapshot, sourceBranchIds: [11, 10], sourceBranchCount: 2 }));
  assert.ok(!isValidSnapshot({ ...snapshot, branches: [{ ...snapshot.branches[0], status: 'failed' }] }));
});

test('breaker transitions cover partial, three failures and 6h/24h/disable blocks', () => {
  const version = uuid(1);
  let state = { ...createBreaker(version, new Date(START - 1).toISOString()), blockLevel: 2, consecutiveFailedRuns: 2 };
  state = nextBreakerState(state, { controlVersion: version, outcome: 'partial', nowMs: START }).breaker;
  assert.equal(state.consecutiveFailedRuns, 0);
  assert.equal(state.blockLevel, 2);
  assert.equal(state.lastError, 'source_partial');
  for (let index = 0; index < 3; index++) {
    state = nextBreakerState(state, { controlVersion: version, outcome: 'failed', nowMs: START + index }).breaker;
  }
  assert.equal(state.consecutiveFailedRuns, 0);
  assert.equal(state.blockedUntil, new Date(START + 2 + BREAKER_BACKOFF_MS.failedRuns).toISOString());

  state = createBreaker(version);
  let result = nextBreakerState(state, { controlVersion: version, outcome: 'blocked', nowMs: START });
  assert.equal(result.breaker.blockLevel, 1);
  assert.equal(result.breaker.blockedUntil, new Date(START + BREAKER_BACKOFF_MS.first).toISOString());
  result = nextBreakerState(result.breaker, { controlVersion: version, outcome: 'blocked', nowMs: START + 1 });
  assert.equal(result.breaker.blockLevel, 2);
  assert.equal(result.breaker.blockedUntil, new Date(START + 1 + BREAKER_BACKOFF_MS.second).toISOString());
  result = nextBreakerState(result.breaker, { controlVersion: version, outcome: 'blocked', nowMs: START + 2 });
  assert.equal(result.breaker.blockLevel, 3);
  assert.equal(result.autoDisable, true);

  assert.equal(parseRetryAfter('120', START), START + 120_000);
  assert.equal(parseRetryAfter(new Date(START + 5_000).toUTCString(), START), START + 5_000);
  assert.equal(parseRetryAfter('garbage', START), null);
  assert.equal(parseRetryAfter('9'.repeat(400), START), null);
});

test('storage selects production/site and nonproduction/deploy stores with strong consistency', async () => {
  const calls = [];
  const getStoreImpl = options => { calls.push(['site', options]); return { name: 'site' }; };
  const getDeployStoreImpl = options => { calls.push(['deploy', options]); return { name: 'deploy' }; };
  assert.equal(createRuntimeStore({ context: 'production', getStoreImpl, getDeployStoreImpl }).name, 'site');
  assert.equal(createRuntimeStore({ context: 'deploy-preview', getStoreImpl, getDeployStoreImpl }).name, 'deploy');
  assert.deepEqual(calls, [
    ['site', { name: 'exchange-rates', consistency: 'strong' }],
    ['deploy', { name: 'exchange-rates', consistency: 'strong' }],
  ]);

  const store = {
    getWithMetadata: async (...args) => { calls.push(['get', ...args]); return null; },
    setJSON: async (...args) => { calls.push(['set', ...args]); return { modified: true, etag: 'x' }; },
  };
  await readEntry(store, EXCHANGE_KEYS.control);
  await conditionalSetJSON(store, EXCHANGE_KEYS.control, {}, null);
  await conditionalSetJSON(store, EXCHANGE_KEYS.control, {}, { etag: 'old' });
  assert.deepEqual(calls.at(-3), ['get', EXCHANGE_KEYS.control, { type: 'json', consistency: 'strong' }]);
  assert.deepEqual(calls.at(-2).at(-1), { onlyIfNew: true });
  assert.deepEqual(calls.at(-1).at(-1), { onlyIfMatch: 'old' });
});

test('admin storage requires explicit local credentials and opens the production site store', () => {
  assert.throws(() => createAdminStore({ siteID: '', token: '' }), /required/);
  let received;
  const store = createAdminStore({
    siteID: 'site-id', token: 'secret-token',
    getStoreImpl: options => { received = options; return { name: 'admin' }; },
  });
  assert.equal(store.name, 'admin');
  assert.deepEqual(received, {
    name: 'exchange-rates', consistency: 'strong', siteID: 'site-id', token: 'secret-token',
  });
});
