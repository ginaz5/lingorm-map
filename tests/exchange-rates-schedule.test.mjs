import assert from 'node:assert/strict';
import test from 'node:test';

import exchangeRatesFetch, { config } from '../netlify/functions/exchange-rates-fetch.mjs';
import { serveExchangeRates } from '../netlify/functions/exchange-rates.mjs';
import {
  buildSnapshot, createBreaker, EXCHANGE_KEYS, isExchangeFetchTime,
} from '../netlify/functions/_shared/exchange-rates-contract.mjs';
import { runExchangeRateFetch } from '../netlify/functions/_shared/exchange-rates-runner.mjs';
import { parseBranchExchange } from '../src/data/exchange-rates.js';
import {
  enabledControl, FakeBlobStore, jsonResponse, sourceOptions, sourceQuote, twoBranchMapping, uuid,
} from './helpers/exchange-rates-store.mjs';

test('fetch window includes Bangkok 08:00 and excludes 23:00 across midnight', () => {
  for (const [time, allowed] of [
    ['2026-09-27T07:59:59.999+07:00', false],
    ['2026-09-27T08:00:00+07:00', true],
    ['2026-09-27T22:30:00+07:00', true],
    ['2026-09-27T22:59:59.999+07:00', true],
    ['2026-09-27T23:00:00+07:00', false],
    ['2026-09-28T00:00:00+07:00', false],
    ['2026-09-28T07:59:59.999+07:00', false],
    ['2026-09-28T08:00:00+07:00', true],
  ]) {
    assert.equal(isExchangeFetchTime(Date.parse(time)), allowed, time);
  }
  assert.equal(isExchangeFetchTime(NaN), false);
});

test('UTC cron has exactly 30 half-hour slots from Bangkok 08:00 to 22:30', () => {
  assert.equal(config.schedule, '0,30 1-15 * * *');
  const [minutes, hours] = config.schedule.split(' ');
  const [firstHour, lastHour] = hours.split('-').map(Number);
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (const day of ['2026-01-01', '2026-07-01']) {
    const times = [];
    for (let hour = firstHour; hour <= lastHour; hour++) {
      for (const minute of minutes.split(',').map(Number)) {
        const nowMs = Date.parse(`${day}T00:00:00Z`) + (hour * 60 + minute) * 60_000;
        assert.equal(isExchangeFetchTime(nowMs), true);
        times.push(format.format(nowMs));
      }
    }
    assert.equal(times.length, 30);
    assert.equal(times[0], '08:00');
    assert.equal(times.at(-1), '22:30');
  }
});

for (const time of ['2026-09-27T23:00:00+07:00', '2026-09-28T07:59:59.999+07:00']) {
  test(`nighttime handler skips storage and source requests: ${time}`, async t => {
    t.mock.method(Date, 'now', () => Date.parse(time));
    t.mock.method(globalThis, 'fetch', () => { throw new Error('must not request'); });
    const logs = [];
    t.mock.method(console, 'log', message => logs.push(JSON.parse(message)));
    await exchangeRatesFetch(new Request('https://example.test'), { deploy: { context: 'production' } });
    assert.deepEqual(logs, [{ event: 'exchange_rates_fetch', status: 'outside_window', sourceRequestCount: 0 }]);
  });
}

test('nighttime runner leaves control, cooldown and snapshot untouched, then resumes at 08:00', async () => {
  let nowMs = Date.parse('2026-09-27T23:00:00+07:00');
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), nowMs - 60_000));
  store.seed(EXCHANGE_KEYS.breaker, {
    ...createBreaker(uuid(1), new Date(nowMs + 60_000).toISOString()),
    blockLevel: 1, consecutiveFailedRuns: 2,
  });
  store.seed(EXCHANGE_KEYS.snapshot, { previous: true });
  const before = structuredClone(store.entries);
  let requests = 0;
  const input = {
    store, mapping: twoBranchMapping(), nowImpl: () => nowMs,
    sleepImpl: async ms => { nowMs += ms; },
    randomUUIDImpl: () => uuid(2), enabledDefault: 'false',
    fetchImpl: async url => {
      requests++;
      return url.endsWith('/branch-client/options')
        ? jsonResponse(sourceOptions([10, 11]))
        : jsonResponse(sourceQuote(url.includes('branchId=10') ? 'H01' : 'B01'));
    },
  };
  for (const time of ['2026-09-27T23:00:00+07:00', '2026-09-28T07:59:59.999+07:00']) {
    nowMs = Date.parse(time);
    assert.deepEqual(await runExchangeRateFetch(input), { status: 'outside_window', sourceRequestCount: 0 });
    assert.deepEqual(store.entries, before);
    assert.deepEqual(store.calls, []);
    assert.equal(requests, 0);
  }
  nowMs = Date.parse('2026-09-28T08:00:00+07:00');
  const result = await runExchangeRateFetch(input);
  assert.equal(result.status, 'published');
  assert.equal(requests, 3);
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.breaker).data, createBreaker(uuid(1)));
});

test('runner checks the window again when storage reads cross 23:00', async () => {
  let nowMs = Date.parse('2026-09-27T22:59:59.999+07:00');
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), nowMs - 60_000));
  const get = store.getWithMetadata.bind(store);
  store.getWithMetadata = async (...args) => {
    const entry = await get(...args);
    nowMs = Date.parse('2026-09-27T23:00:00+07:00');
    return entry;
  };
  const result = await runExchangeRateFetch({
    store, mapping: twoBranchMapping(), nowImpl: () => nowMs,
    fetchImpl: () => { throw new Error('must not request'); },
  });
  assert.deepEqual(result, { status: 'outside_window', sourceRequestCount: 0 });
  assert.ok(store.calls.every(call => call.operation === 'get'));
});

test('last snapshot expires at 23:01:30 instead of extending until the morning', async () => {
  const attemptedAtMs = Date.parse('2026-09-27T22:30:00+07:00');
  const quote = parseBranchExchange(sourceQuote('H01'), { officialId: 10, expectedBranchCode: 'H01' });
  const snapshot = buildSnapshot({
    runId: uuid(2), controlVersion: uuid(1), attemptedAtMs, completedAtMs: attemptedAtMs + 1_000,
    sourceBranchIds: [10], unknownBranchCount: 0, missingBranchCount: 0,
    branches: [{ slug: 'superrich-thailand-10', officialId: 10, branchCode: 'H01', status: quote.status, rates: quote.rates }],
  });
  assert.equal(snapshot.nextUpdateAt, '2026-09-27T16:00:00.000Z');
  assert.equal(snapshot.expiresAt, '2026-09-27T16:01:30.000Z');
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), attemptedAtMs));
  store.seed(EXCHANGE_KEYS.snapshot, snapshot);
  for (const nowMs of [Date.parse(snapshot.expiresAt), Date.parse('2026-09-28T08:00:00+07:00')]) {
    const response = await serveExchangeRates({ store, nowMs });
    const payload = await response.json();
    assert.equal(payload.enabled, true);
    assert.equal(payload.snapshot, null);
  }
});
