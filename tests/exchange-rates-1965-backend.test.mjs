import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBreaker, createControl, EXCHANGE_KEYS, sanitizeDiagnostics,
} from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { ORANGE_BRANCHES } from '../src/data/exchange-rates-1965-branch.js';
import {
  collectSourceQuotes, NETLIFY_SOURCE_PROFILE, resolveSourceProfile, SOURCE_BASE_URL, SOURCE_MIN_START_GAP_MS,
} from '../netlify/functions/_shared/exchange-rates-1965-source.mjs';
import { createRuntimeStore } from '../netlify/functions/_shared/exchange-rates-1965-storage.mjs';
import { changeControl } from '../netlify/functions/_shared/exchange-rates-1965-control.mjs';
import { FakeBlobStore, jsonResponse, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-09-11T00:00:00Z');

test('orange control retry preserves a cooldown recorded during the breaker write', async () => {
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, nowMs: START, controlVersion: uuid(1), updatedBy: 'manual' }));
  store.seed(EXCHANGE_KEYS.breaker, createBreaker(uuid(1)));
  const latestBlockedUntil = new Date(START + 120_000).toISOString();
  let raced = false;
  store.beforeSet = ({ key }) => {
    if (key === EXCHANGE_KEYS.breaker && !raced) {
      raced = true;
      store.seed(key, createBreaker(uuid(2), latestBlockedUntil));
    }
  };

  await changeControl(store, {
    enabled: false, nowMs: START + 1_000, randomUUIDImpl: () => uuid(2),
  });

  assert.equal(raced, true);
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.breaker).data, createBreaker(uuid(2), latestBlockedUntil));
});

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
  const reviewed = { schemaVersion: 1, branches: ORANGE_BRANCHES };
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

test('one repeatedly failing branch produces a partial collection with one global retry', async () => {
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

test('runtime storage uses a distinct orange store', () => {
  let options;
  createRuntimeStore({ context: 'production', getStoreImpl: value => { options = value; return {}; } });
  assert.deepEqual(options, { name: 'exchange-rates-1965', consistency: 'strong' });
});

test('source profiles retain default and custom timing validation without the retired local alias', () => {
  assert.deepEqual(resolveSourceProfile(), NETLIFY_SOURCE_PROFILE);
  assert.deepEqual(resolveSourceProfile('netlify'), NETLIFY_SOURCE_PROFILE);
  const custom = { name: 'test', concurrency: 1, minStartGapMs: 0, requestTimeoutMs: 75_000, deadlineMs: 80_000 };
  assert.deepEqual(resolveSourceProfile(custom), custom);
  assert.equal(resolveSourceProfile(custom, { requestTimeoutMs: 250 }).requestTimeoutMs, 250);
  assert.throws(() => resolveSourceProfile('local'), /invalid_source_profile/);
  assert.throws(() => resolveSourceProfile({ ...custom, concurrency: 0 }), /invalid_source_profile/);
});

test('source diagnostics stay bounded and omit raw response data', () => {
  const clean = sanitizeDiagnostics(Array.from({ length: 20 }, (_, index) => ({
    officialId: index + 1, stage: 'token', status: 403, cfMitigated: 'challenge',
    contentType: 'text/html', retryAfter: null, rayId: 'r'.repeat(500),
    tokenRemainingSeconds: 18, tokenReissued: 1, body: '<html>PRIVATE_BODY</html>',
  })));
  assert.equal(clean.length, 8);
  assert.equal(clean[0].rayId.length, 100);
  assert.equal(clean[0].tokenRemainingSeconds, 18);
  assert.equal(clean[0].tokenReissued, 1);
  assert.equal('body' in clean[0], false);
  assert.doesNotMatch(JSON.stringify(clean), /PRIVATE_BODY/);
});
