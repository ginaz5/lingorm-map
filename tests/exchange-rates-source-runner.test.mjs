import assert from 'node:assert/strict';
import test from 'node:test';

import { createBreaker, EXCHANGE_KEYS, isValidSnapshot } from '../netlify/functions/_shared/exchange-rates-contract.mjs';
import { loadBranchMapping, runExchangeRateFetch } from '../netlify/functions/_shared/exchange-rates-runner.mjs';
import { collectSourceQuotes, SOURCE_MIN_START_GAP_MS } from '../netlify/functions/_shared/exchange-rates-source.mjs';
import {
  FakeBlobStore, enabledControl, jsonResponse, sourceOptions, sourceQuote,
  twoBranchMapping, uuid,
} from './helpers/exchange-rates-store.mjs';

function fakeClock(start = Date.parse('2026-09-09T00:00:00Z')) {
  let value = start;
  return {
    now: () => value,
    sleep: async ms => { value += ms; },
    advance: ms => { value += ms; },
  };
}

function routeFetch(overrides = {}) {
  return async url => {
    if (url.endsWith('/branch-client/options')) return jsonResponse(sourceOptions([10, 11]));
    if (url.includes('branchId=10')) return overrides[10] ?? jsonResponse(sourceQuote('H01'));
    if (url.includes('branchId=11')) return overrides[11] ?? jsonResponse(sourceQuote('B01'));
    throw new Error(`unexpected URL ${url}`);
  };
}

test('source collection starts requests at least 200ms apart and allows at most two in flight', async () => {
  const clock = fakeClock();
  let active = 0;
  let maxActive = 0;
  const pending = [];
  const fetchImpl = async url => {
    if (url.endsWith('/branch-client/options')) return jsonResponse(sourceOptions([10, 11]));
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise(resolve => {
      pending.push(() => {
        active--;
        resolve(jsonResponse(sourceQuote(url.includes('branchId=10') ? 'H01' : 'B01')));
      });
      if (pending.length === 2) queueMicrotask(() => pending.splice(0).forEach(done => done()));
    });
  };
  const result = await collectSourceQuotes({
    mapping: twoBranchMapping(), fetchImpl, nowImpl: clock.now, sleepImpl: clock.sleep,
    functionStartedAtMs: clock.now(),
  });
  assert.equal(result.outcome, 'complete');
  assert.equal(result.requestCount, 3);
  assert.equal(maxActive, 2);
  for (let index = 1; index < result.requestStartTimes.length; index++) {
    assert.ok(result.requestStartTimes[index] - result.requestStartTimes[index - 1] >= SOURCE_MIN_START_GAP_MS);
  }
});

test('real 26-branch mapping completes in 27 requests with safe source headers', async () => {
  const clock = fakeClock();
  const mapping = await loadBranchMapping();
  const byId = new Map(Object.values(mapping.branches).map(branch => [branch.officialId, branch.branchCode]));
  const requests = [];
  const result = await collectSourceQuotes({
    mapping,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/branch-client/options')) return jsonResponse(sourceOptions([...byId.keys()]));
      const id = Number(new URL(url).searchParams.get('branchId'));
      return jsonResponse(sourceQuote(byId.get(id)));
    },
    nowImpl: clock.now, sleepImpl: clock.sleep, functionStartedAtMs: clock.now(),
  });
  assert.equal(result.outcome, 'complete');
  assert.equal(result.requestCount, 27);
  assert.equal(result.quotes.length, 26);
  for (const request of requests) {
    assert.equal(request.init.headers['X-Language-Code'], 'en');
    assert.match(request.init.headers['User-Agent'], /LingOrmBangkokMap.*https:\/\//);
    assert.equal(request.init.headers.Cookie, undefined);
    assert.equal(request.init.headers.Authorization, undefined);
  }
});

test('the five-second request timer remains active while reading the response body', async () => {
  const clock = fakeClock();
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls++;
    return {
      status: 200,
      ok: true,
      headers: new Headers(),
      text: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
    };
  };
  const result = await collectSourceQuotes({
    mapping: twoBranchMapping(), fetchImpl, nowImpl: clock.now, sleepImpl: clock.sleep,
    functionStartedAtMs: clock.now(), requestTimeoutMs: 5,
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.retryUsed, true);
  assert.equal(calls, 2);
  assert.ok(result.quotes.every(branch => branch.quote.rates.USD_100.unavailableReason === 'timeout'));
});

test('one global retry waits until all branch first attempts have run', async () => {
  const clock = fakeClock();
  const calls = [];
  let branch10Attempts = 0;
  const fetchImpl = async url => {
    if (url.endsWith('/branch-client/options')) {
      calls.push('options');
      return jsonResponse(sourceOptions([10, 11]));
    }
    if (url.includes('branchId=10')) {
      calls.push('10');
      branch10Attempts++;
      return branch10Attempts === 1 ? jsonResponse({}, 500) : jsonResponse(sourceQuote('H01'));
    }
    calls.push('11');
    return jsonResponse(sourceQuote('B01'));
  };
  const result = await collectSourceQuotes({
    mapping: twoBranchMapping(), fetchImpl, nowImpl: clock.now, sleepImpl: clock.sleep,
    functionStartedAtMs: clock.now(),
  });
  assert.deepEqual(calls, ['options', '10', '11', '10']);
  assert.equal(result.retryUsed, true);
  assert.equal(result.requestCount, 4);
  assert.equal(result.outcome, 'complete');
});

test('inventory retry consumes the only extra request and 4xx responses never retry', async () => {
  const clock = fakeClock();
  let optionAttempts = 0;
  let branch10Attempts = 0;
  const result = await collectSourceQuotes({
    mapping: twoBranchMapping(),
    fetchImpl: async url => {
      if (url.endsWith('/branch-client/options')) {
        optionAttempts++;
        return optionAttempts === 1 ? jsonResponse({}, 500) : jsonResponse(sourceOptions([10, 11]));
      }
      if (url.includes('branchId=10')) {
        branch10Attempts++;
        return jsonResponse({}, 404);
      }
      return jsonResponse(sourceQuote('B01'));
    },
    nowImpl: clock.now, sleepImpl: clock.sleep, functionStartedAtMs: clock.now(),
  });
  assert.equal(optionAttempts, 2);
  assert.equal(branch10Attempts, 1);
  assert.equal(result.retryUsed, true);
  assert.equal(result.outcome, 'partial');
});

test('403/429 wins over concurrent success, aborts new dispatch, and never retries', async () => {
  const clock = fakeClock();
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.endsWith('/branch-client/options')) return jsonResponse(sourceOptions([10, 11]));
    if (url.includes('branchId=10')) return jsonResponse({}, 429, { 'retry-after': '600' });
    return jsonResponse(sourceQuote('B01'));
  };
  const result = await collectSourceQuotes({
    mapping: twoBranchMapping(), fetchImpl, nowImpl: clock.now, sleepImpl: clock.sleep,
    functionStartedAtMs: clock.now(),
  });
  assert.equal(result.outcome, 'blocked');
  assert.equal(result.blockedStatus, 429);
  assert.equal(result.retryUsed, false);
  assert.equal(result.retryAfterMs, result.requestStartTimes.at(-1) + 600_000);
  assert.ok(calls.length <= 3);
});

test('invalid JSON and an unknown inventory publish explicit current-batch failures', async () => {
  const clock = fakeClock();
  const invalid = await collectSourceQuotes({
    mapping: twoBranchMapping(),
    fetchImpl: async () => jsonResponse('not json'),
    nowImpl: clock.now, sleepImpl: clock.sleep, functionStartedAtMs: clock.now(),
  });
  assert.equal(invalid.outcome, 'failed');
  assert.equal(invalid.retryUsed, false);
  assert.ok(invalid.quotes.every(branch => branch.quote.status === 'failed'));

  const unknownClock = fakeClock();
  const unknown = await collectSourceQuotes({
    mapping: twoBranchMapping(),
    fetchImpl: async url => url.endsWith('/branch-client/options')
      ? jsonResponse(sourceOptions([10, 11, 99]))
      : routeFetch()(url),
    nowImpl: unknownClock.now, sleepImpl: unknownClock.sleep, functionStartedAtMs: unknownClock.now(),
  });
  assert.equal(unknown.outcome, 'partial');
  assert.deepEqual(unknown.unknownIds, [99]);
});

test('runner publishes a complete snapshot and clears breaker using first-read CAS state', async () => {
  const clock = fakeClock();
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), clock.now()));
  store.seed(EXCHANGE_KEYS.breaker, {
    ...createBreaker(uuid(1), new Date(clock.now() - 1).toISOString()),
    blockLevel: 2, consecutiveFailedRuns: 2, lastStatus: 'failed', lastError: 'source_failed',
  });
  const ids = [uuid(2)];
  const result = await runExchangeRateFetch({
    store, mapping: twoBranchMapping(), fetchImpl: routeFetch(), nowImpl: clock.now,
    sleepImpl: clock.sleep, randomUUIDImpl: () => ids.shift(), enabledDefault: 'false',
  });
  assert.equal(result.status, 'published');
  assert.equal(result.sourceOutcome, 'complete');
  assert.ok(isValidSnapshot(store.entries.get(EXCHANGE_KEYS.snapshot).data));
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.breaker).data, createBreaker(uuid(1)));
  const snapshotWrite = store.calls.find(call => call.operation === 'set' && call.key === EXCHANGE_KEYS.snapshot);
  assert.deepEqual(snapshotWrite.options, { onlyIfNew: true });
  const breakerWrite = store.calls.find(call => call.operation === 'set' && call.key === EXCHANGE_KEYS.breaker);
  assert.ok(breakerWrite.options.onlyIfMatch);
});

test('disabled and temporarily blocked runners perform zero source requests', async () => {
  let sourceCalls = 0;
  const disabledStore = new FakeBlobStore();
  const disabled = await runExchangeRateFetch({
    store: disabledStore, mapping: twoBranchMapping(), enabledDefault: 'false',
    fetchImpl: async () => { sourceCalls++; throw new Error('must not run'); },
  });
  assert.equal(disabled.status, 'disabled');

  const clock = fakeClock();
  const blockedStore = new FakeBlobStore();
  blockedStore.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), clock.now()));
  blockedStore.seed(EXCHANGE_KEYS.breaker, createBreaker(uuid(1), new Date(clock.now() + 60_000).toISOString()));
  const blocked = await runExchangeRateFetch({
    store: blockedStore, mapping: twoBranchMapping(), enabledDefault: 'false', nowImpl: clock.now,
    fetchImpl: async () => { sourceCalls++; throw new Error('must not run'); },
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(sourceCalls, 0);
});

test('runner drops results when control changes during source work', async () => {
  const clock = fakeClock();
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), clock.now()));
  let changed = false;
  const fetchImpl = async url => {
    if (!changed && url.includes('branchId=')) {
      changed = true;
      store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(2), clock.now()));
    }
    return routeFetch()(url);
  };
  const result = await runExchangeRateFetch({
    store, mapping: twoBranchMapping(), fetchImpl, nowImpl: clock.now, sleepImpl: clock.sleep,
    randomUUIDImpl: () => uuid(3), enabledDefault: 'false',
  });
  assert.equal(result.status, 'stale_control');
  assert.equal(store.entries.has(EXCHANGE_KEYS.snapshot), false);
});

test('snapshot CAS conflicts are abandoned without force-overwriting or clearing breaker', async () => {
  const clock = fakeClock();
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), clock.now()));
  let conflicted = false;
  store.beforeSet = ({ key }) => {
    if (key === EXCHANGE_KEYS.snapshot && !conflicted) {
      conflicted = true;
      store.seed(EXCHANGE_KEYS.snapshot, { winner: true });
    }
  };
  const result = await runExchangeRateFetch({
    store, mapping: twoBranchMapping(), fetchImpl: routeFetch(), nowImpl: clock.now,
    sleepImpl: clock.sleep, randomUUIDImpl: () => uuid(2), enabledDefault: 'false',
  });
  assert.equal(result.status, 'snapshot_conflict');
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.snapshot).data, { winner: true });
  assert.equal(store.calls.filter(call => call.operation === 'set' && call.key === EXCHANGE_KEYS.snapshot).length, 1);
  assert.equal(store.entries.has(EXCHANGE_KEYS.breaker), false);
});

test('third source block updates breaker then disables with a new control version', async () => {
  const clock = fakeClock();
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), clock.now()));
  store.seed(EXCHANGE_KEYS.breaker, {
    ...createBreaker(uuid(1)), blockLevel: 2, lastStatus: 'blocked', lastError: 'source_blocked',
  });
  const generated = [uuid(8), uuid(9)];
  const result = await runExchangeRateFetch({
    store, mapping: twoBranchMapping(),
    fetchImpl: routeFetch({ 10: jsonResponse({}, 403) }),
    nowImpl: clock.now, sleepImpl: clock.sleep,
    randomUUIDImpl: () => generated.shift(), enabledDefault: 'false',
  });
  assert.equal(result.sourceOutcome, 'blocked');
  assert.equal(result.autoDisabled, true);
  const control = store.entries.get(EXCHANGE_KEYS.control).data;
  assert.equal(control.enabled, false);
  assert.equal(control.controlVersion, uuid(9));
  assert.equal(control.updatedBy, 'breaker');
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.breaker).data, createBreaker(uuid(9)));
});

test('an old blocked run cannot auto-disable a newer control version', async () => {
  const clock = fakeClock();
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), clock.now()));
  store.seed(EXCHANGE_KEYS.breaker, {
    ...createBreaker(uuid(1)), blockLevel: 2, lastStatus: 'blocked', lastError: 'source_blocked',
  });
  let raced = false;
  store.beforeSet = ({ key, data }) => {
    if (key === EXCHANGE_KEYS.breaker && data.blockLevel === 3 && !raced) {
      raced = true;
      store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(7), clock.now()));
    }
  };
  const generated = [uuid(8), uuid(9)];
  const result = await runExchangeRateFetch({
    store, mapping: twoBranchMapping(), fetchImpl: routeFetch({ 10: jsonResponse({}, 403) }),
    nowImpl: clock.now, sleepImpl: clock.sleep,
    randomUUIDImpl: () => generated.shift(), enabledDefault: 'false',
  });
  assert.equal(result.autoDisabled, false);
  assert.equal(store.entries.get(EXCHANGE_KEYS.control).data.controlVersion, uuid(7));
  assert.equal(store.entries.get(EXCHANGE_KEYS.control).data.enabled, true);
});
