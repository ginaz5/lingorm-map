import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSnapshot, createBreaker, createControl, EXCHANGE_KEYS, isValidSnapshot,
} from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { loadBranchMapping, runExchangeRateFetch } from '../netlify/functions/_shared/exchange-rates-1965-runner.mjs';
import {
  collectSourceQuotes, SOURCE_BASE_URL, SOURCE_MIN_START_GAP_MS,
} from '../netlify/functions/_shared/exchange-rates-1965-source.mjs';
import { createRuntimeStore } from '../netlify/functions/_shared/exchange-rates-1965-storage.mjs';
import { serveExchangeRates } from '../netlify/functions/exchange-rates-1965.mjs';
import { FakeBlobStore, jsonResponse, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-09-11T00:00:00Z');

function mapping() {
  return {
    schemaVersion: 1,
    branches: {
      'superrich1965-56': { officialId: 56, branchNo: '00', companyCode: 'A04' },
      'superrich1965-57': { officialId: 57, branchNo: '35', companyCode: 'A04' },
    },
  };
}

function sourcePayload(updatedAt = START) {
  return {
    status_code: 200,
    code: 'SUCCESS',
    data: {
      update_time: updatedAt,
      datas: [
        { currency_code: 'USD', denom_list: [{ show_denom: '100-50', buy_rate_amount: '33.04' }] },
        { currency_code: 'TWD', denom_list: [{ show_denom: '1000-100', buy_rate_amount: '1.02' }] },
      ],
    },
  };
}

function clock() {
  let value = START;
  return { now: () => value, sleep: async ms => { value += ms; } };
}

function enabledControl(version = uuid(1)) {
  return createControl({ enabled: true, nowMs: START, controlVersion: version, updatedBy: 'manual' });
}

test('mapping accepts only reviewed A04 two-digit identities', async () => {
  assert.deepEqual(await loadBranchMapping(mapping()), mapping());
  await assert.rejects(loadBranchMapping({ ...mapping(), branches: {
    'superrich1965-56': { officialId: 56, branchNo: 'E52-01', companyCode: 'E52' },
  } }), /invalid_branch_mapping/);
  await assert.rejects(loadBranchMapping({ ...mapping(), branches: {
    'wrong-slug': { officialId: 56, branchNo: '00', companyCode: 'A04' },
  } }), /invalid_branch_mapping/);
});

test('source fetches the fixed mapping with paced POST requests and safe headers', async () => {
  const fake = clock();
  const calls = [];
  const result = await collectSourceQuotes({
    mapping: mapping(),
    nowImpl: fake.now,
    sleepImpl: fake.sleep,
    functionStartedAtMs: fake.now(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(sourcePayload());
    },
  });
  assert.equal(result.outcome, 'complete');
  assert.equal(result.requestCount, 2);
  assert.equal(result.quotes.length, 2);
  assert.equal(result.quotes[0].quote.rates.USD_1965.rateScaledE6, 33_040_000);
  assert.equal(result.quotes[0].quote.sourceUpdatedAtMs, START);
  assert.ok(result.requestStartTimes[1] - result.requestStartTimes[0] >= SOURCE_MIN_START_GAP_MS);
  for (const [index, call] of calls.entries()) {
    assert.equal(call.url, `${SOURCE_BASE_URL}/get`);
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.headers.Accept, 'application/json');
    assert.equal(call.init.headers['Content-Type'], 'application/json');
    assert.match(call.init.headers['User-Agent'], /LingOrmBangkokMap.*https:\/\//);
    assert.equal(call.init.headers.Authorization, undefined);
    assert.equal(call.init.headers.Cookie, undefined);
    assert.deepEqual(JSON.parse(call.init.body), { filters: [
      { field: 'company_code', value: 'A04' },
      { field: 'branch_no', value: index === 0 ? '00' : '35' },
    ] });
  }
});

test('committed mapping completes in exactly 38 source requests without an inventory call', async () => {
  const fake = clock();
  const reviewed = await loadBranchMapping();
  const requested = [];
  const result = await collectSourceQuotes({
    mapping: reviewed, nowImpl: fake.now, sleepImpl: fake.sleep, functionStartedAtMs: fake.now(),
    fetchImpl: async (url, init) => {
      requested.push({ url, body: JSON.parse(init.body) });
      return jsonResponse(sourcePayload());
    },
  });
  assert.equal(result.outcome, 'complete');
  assert.equal(result.requestCount, 38);
  assert.equal(result.quotes.length, 38);
  assert.equal(new Set(requested.map(call => call.body.filters[1].value)).size, 38);
  assert.ok(requested.every(call => call.url === `${SOURCE_BASE_URL}/get`));
});

test('Cloudflare challenge stops the round and exposes bounded header diagnostics', async () => {
  const fake = clock();
  const result = await collectSourceQuotes({
    mapping: mapping(), nowImpl: fake.now, sleepImpl: fake.sleep, functionStartedAtMs: fake.now(),
    fetchImpl: async () => jsonResponse('<html>challenge</html>', 200, {
      'cf-mitigated': 'challenge', 'cf-ray': 'ray-id', 'content-type': 'text/html',
    }),
  });
  assert.equal(result.outcome, 'blocked');
  assert.equal(result.retryUsed, false);
  assert.ok(result.requestCount <= 2);
  assert.deepEqual(result.diagnostics[0], {
    officialId: 56, status: 200, cfMitigated: 'challenge',
    contentType: 'text/html', retryAfter: null, rayId: 'ray-id',
  });
});

test('a challenge after an earlier success still wins and stops the round', async () => {
  const fake = clock();
  const result = await collectSourceQuotes({
    mapping: mapping(), nowImpl: fake.now, sleepImpl: fake.sleep, functionStartedAtMs: fake.now(),
    fetchImpl: async (_url, init) => {
      const branchNo = JSON.parse(init.body).filters[1].value;
      return branchNo === '00'
        ? jsonResponse(sourcePayload())
        : jsonResponse('<html>challenge</html>', 200, { 'cf-mitigated': 'challenge' });
    },
  });
  assert.equal(result.outcome, 'blocked');
  assert.equal(result.quotes.find(branch => branch.quote.branchNo === '00').quote.status, 'ok');
  assert.equal(result.retryUsed, false);
});

test('one repeatedly failing branch produces a partial snapshot with one global retry', async () => {
  const fake = clock();
  const attempts = new Map();
  const result = await collectSourceQuotes({
    mapping: mapping(), nowImpl: fake.now, sleepImpl: fake.sleep, functionStartedAtMs: fake.now(),
    fetchImpl: async (_url, init) => {
      const branchNo = JSON.parse(init.body).filters[1].value;
      attempts.set(branchNo, (attempts.get(branchNo) || 0) + 1);
      return branchNo === '00' ? jsonResponse(sourcePayload()) : jsonResponse({}, 500);
    },
  });
  assert.equal(result.outcome, 'partial');
  assert.equal(result.retryUsed, true);
  assert.equal(result.requestCount, 3);
  assert.equal(attempts.get('00'), 1);
  assert.equal(attempts.get('35'), 2);
});

test('runner is storage-free and source-free while the orange feature is disabled', async () => {
  const store = new FakeBlobStore();
  let calls = 0;
  const result = await runExchangeRateFetch({
    store, mapping: mapping(), enabledDefault: undefined,
    fetchImpl: async () => { calls++; throw new Error('must not fetch'); },
  });
  assert.deepEqual(result, { status: 'disabled', sourceRequestCount: 0 });
  assert.equal(calls, 0);
  assert.equal(store.calls.some(call => call.operation === 'set'), false);
});

test('runner publishes a valid brand-isolated snapshot when enabled', async () => {
  const fake = clock();
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl());
  const result = await runExchangeRateFetch({
    store, mapping: mapping(), enabledDefault: 'false', nowImpl: fake.now,
    sleepImpl: fake.sleep, functionStartedAtMs: fake.now(), randomUUIDImpl: () => uuid(2),
    fetchImpl: async () => jsonResponse(sourcePayload()),
  });
  assert.equal(result.status, 'published');
  assert.equal(result.sourceOutcome, 'complete');
  const snapshot = store.entries.get(EXCHANGE_KEYS.snapshot).data;
  assert.ok(isValidSnapshot(snapshot));
  assert.deepEqual(snapshot.branches[0], {
    slug: 'superrich1965-56', officialId: 56, branchNo: '00', companyCode: 'A04',
    sourceUpdatedAtMs: START, status: 'ok', rates: snapshot.branches[0].rates,
  });
  assert.ok([...store.entries.keys()].every(key => key.startsWith('exchange-rates-1965/')));
});

test('a third 429 block auto-disables only the orange control', async () => {
  const fake = clock();
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl());
  store.seed(EXCHANGE_KEYS.breaker, {
    ...createBreaker(uuid(1)), blockLevel: 2, lastStatus: 'blocked', lastError: 'source_blocked',
  });
  const generated = [uuid(2), uuid(3)];
  const result = await runExchangeRateFetch({
    store, mapping: mapping(), enabledDefault: 'false', nowImpl: fake.now,
    sleepImpl: fake.sleep, functionStartedAtMs: fake.now(), randomUUIDImpl: () => generated.shift(),
    fetchImpl: async () => jsonResponse({}, 429, { 'retry-after': '900' }),
  });
  assert.equal(result.sourceOutcome, 'blocked');
  assert.equal(result.autoDisabled, true);
  assert.equal(store.entries.get(EXCHANGE_KEYS.control).data.enabled, false);
  assert.equal(store.entries.get(EXCHANGE_KEYS.control).data.disabledReason, 'source_blocked');
  assert.ok([...store.entries.keys()].every(key => key.startsWith('exchange-rates-1965/')));
});

test('public API defaults disabled and returns only current orange snapshots', async () => {
  const disabled = await serveExchangeRates({ store: new FakeBlobStore(), enabledDefault: undefined, nowMs: START });
  assert.deepEqual(await disabled.json(), {
    schemaVersion: 1, checkedAt: new Date(START).toISOString(), enabled: false,
    controlVersion: null, snapshot: null,
  });
  assert.equal(disabled.headers.get('cache-control'), 'no-store');

  const store = new FakeBlobStore();
  const control = enabledControl();
  store.seed(EXCHANGE_KEYS.control, control);
  store.seed(EXCHANGE_KEYS.snapshot, buildSnapshot({
    runId: uuid(2), controlVersion: control.controlVersion, attemptedAtMs: START + 1,
    completedAtMs: START + 2, sourceBranchIds: [56], unknownBranchCount: 0, missingBranchCount: 0,
    branches: [{
      slug: 'superrich1965-56', officialId: 56, branchNo: '00', companyCode: 'A04',
      sourceUpdatedAtMs: START, status: 'ok',
      rates: {
        USD_1965: { denom: 'USD_1965', rateScaledE6: 33_040_000, displayDecimals: 2, unavailableReason: null },
        TWD_1965: { denom: 'TWD_1965', rateScaledE6: 1_020_000, displayDecimals: 2, unavailableReason: null },
      },
    }],
  }));
  const response = await serveExchangeRates({ store, enabledDefault: 'false', nowMs: START + 3 });
  assert.equal((await response.json()).snapshot.branches[0].slug, 'superrich1965-56');
  const expired = await serveExchangeRates({ store, enabledDefault: 'false', nowMs: Date.parse('2026-09-11T00:31:30.000Z') });
  assert.equal((await expired.json()).snapshot, null);

  const disabledControl = createControl({
    enabled: false, nowMs: START + 4, controlVersion: uuid(3), updatedBy: 'manual', disabledReason: 'manual',
  });
  store.seed(EXCHANGE_KEYS.control, disabledControl);
  const manuallyDisabled = await serveExchangeRates({ store, enabledDefault: 'true', nowMs: START + 5 });
  assert.equal((await manuallyDisabled.json()).enabled, false);
});

test('runtime storage uses a distinct orange store', () => {
  let options;
  createRuntimeStore({ context: 'production', getStoreImpl: value => { options = value; return {}; } });
  assert.deepEqual(options, { name: 'exchange-rates-1965', consistency: 'strong' });
});
