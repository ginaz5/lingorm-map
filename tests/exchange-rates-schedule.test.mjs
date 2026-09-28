import assert from 'node:assert/strict';
import test from 'node:test';
import { setEnvironmentContext } from '@netlify/blobs';

import exchangeRatesFetch, { config } from '../netlify/functions/exchange-rates-fetch.mjs';
import { serveExchangeRates } from '../netlify/functions/exchange-rates.mjs';
import {
  buildSnapshot, createBreaker, createControl, EXCHANGE_KEYS,
} from '../netlify/functions/_shared/exchange-rates-contract.mjs';
import { runExchangeRateFetch } from '../netlify/functions/_shared/exchange-rates-runner.mjs';
import { parseBranchExchange } from '../src/data/exchange-rates.js';
import {
  enabledControl, FakeBlobStore, jsonResponse, sourceOptions, sourceQuote, twoBranchMapping, uuid,
} from './helpers/exchange-rates-store.mjs';

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
        times.push(format.format(nowMs));
      }
    }
    assert.equal(times.length, 30);
    assert.equal(times[0], '08:00');
    assert.equal(times.at(-1), '22:30');
  }
});

for (const time of ['2026-09-27T23:00:00+07:00', '2026-09-28T07:59:59.999+07:00']) {
  test(`manual nighttime handler run reaches storage instead of skipping: ${time}`, async t => {
    t.mock.method(Date, 'now', () => Date.parse(time));
    const previousContext = process.env.CONTEXT;
    const previousBlobs = process.env.NETLIFY_BLOBS_CONTEXT;
    const previousGlobalBlobs = globalThis.netlifyBlobsContext;
    t.after(() => {
      if (previousContext === undefined) delete process.env.CONTEXT;
      else process.env.CONTEXT = previousContext;
      if (previousBlobs === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT;
      else process.env.NETLIFY_BLOBS_CONTEXT = previousBlobs;
      globalThis.netlifyBlobsContext = previousGlobalBlobs;
    });
    delete process.env.CONTEXT;
    globalThis.netlifyBlobsContext = undefined;
    setEnvironmentContext({
      siteID: 'fixture-site', token: 'fixture-token', deployID: 'fixturedeploy',
      primaryRegion: 'us-east-1', edgeURL: 'https://cached.blobs.test',
      uncachedEdgeURL: 'https://strong.blobs.test',
    });
    // A disabled control stops the run before any source request, so this
    // only proves the handler no longer short-circuits outside cron hours.
    const disabled = createControl({
      enabled: false, disabledReason: 'manual', updatedBy: 'manual',
      controlVersion: uuid(1), nowMs: Date.now(),
    });
    const requested = [];
    t.mock.method(globalThis, 'fetch', async url => {
      requested.push(new URL(url));
      return Response.json(disabled, { headers: { etag: 'fixture-etag' } });
    });
    const logs = [];
    t.mock.method(console, 'log', message => logs.push(JSON.parse(message)));
    await exchangeRatesFetch(new Request('https://example.test'), { deploy: { context: 'production' } });
    assert.deepEqual(logs, [{ event: 'exchange_rates_fetch', status: 'disabled', sourceRequestCount: 0 }]);
    assert.equal(requested.length, 1);
    assert.equal(requested[0].host, 'strong.blobs.test');
  });
}

test('manual nighttime runs still honor the breaker, then fetch and publish', async () => {
  let nowMs = Date.parse('2026-09-27T23:10:00+07:00');
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), nowMs - 60_000));
  store.seed(EXCHANGE_KEYS.breaker, {
    ...createBreaker(uuid(1), new Date(nowMs + 60_000).toISOString()),
    blockLevel: 1, consecutiveFailedRuns: 2,
  });
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
  const blocked = await runExchangeRateFetch(input);
  assert.equal(blocked.status, 'blocked');
  assert.equal(requests, 0);

  for (const [time, nextUpdateAt, expiresAt] of [
    ['2026-09-27T23:40:00+07:00', '2026-09-27T17:00:00.000Z', '2026-09-27T17:35:00.000Z'],
    ['2026-09-28T07:59:00+07:00', '2026-09-28T01:00:00.000Z', '2026-09-28T01:35:00.000Z'],
  ]) {
    nowMs = Date.parse(time);
    const before = requests;
    const result = await runExchangeRateFetch(input);
    assert.equal(result.status, 'published', time);
    assert.equal(requests - before, 3, time);
    const snapshot = store.entries.get(EXCHANGE_KEYS.snapshot).data;
    assert.equal(snapshot.nextUpdateAt, nextUpdateAt, time);
    assert.equal(snapshot.expiresAt, expiresAt, time);
  }
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.breaker).data, createBreaker(uuid(1)));
});

test('last snapshot expires at 23:35 instead of extending until the morning', async () => {
  const attemptedAtMs = Date.parse('2026-09-27T22:30:00+07:00');
  const quote = parseBranchExchange(sourceQuote('H01'), { officialId: 10, expectedBranchCode: 'H01' });
  const snapshot = buildSnapshot({
    runId: uuid(2), controlVersion: uuid(1), attemptedAtMs, completedAtMs: attemptedAtMs + 1_000,
    sourceBranchIds: [10], unknownBranchCount: 0, missingBranchCount: 0,
    branches: [{ slug: 'superrich-thailand-10', officialId: 10, branchCode: 'H01', status: quote.status, rates: quote.rates }],
  });
  assert.equal(snapshot.nextUpdateAt, '2026-09-27T16:00:00.000Z');
  assert.equal(snapshot.expiresAt, '2026-09-27T16:35:00.000Z');
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
