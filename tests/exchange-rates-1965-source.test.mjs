// Phase A1 source contract — docs/superrich1965-exchange-map-plan.zh-TW.md §2, §2.3, §3.3.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseRateText, RATE_SCALE, RATE_SCALE_EXPONENT } from '../src/data/exchange-rates.js';
import {
  BRANCH_NO_PATTERN_1965, COMPANY_CODE_1965, DENOMS_1965, RATE_SCALE_1965,
  RATE_SCALE_EXPONENT_1965, SOURCE_DENOMS_1965, branchQuoteFailure1965,
  normalizeBranchNo, parseBranchExchange1965, parseBranchList1965, parseRateText1965,
  parseSourceUpdateTime,
} from '../src/data/exchange-rates-1965.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`fixtures/superrich1965/${name}.json`, import.meta.url), 'utf8'));

const clone = (value) => JSON.parse(JSON.stringify(value));

// ─── scale ──────────────────────────────────────────────────────────────────

test('RATE_SCALE_1965 is a single global constant', () => {
  assert.equal(RATE_SCALE_1965, 10 ** RATE_SCALE_EXPONENT_1965);
  assert.equal(RATE_SCALE_1965, 1_000_000);
});

// ─── deliberate duplication guard ───────────────────────────────────────────
// The orange module is a parallel copy of the green one (plan §1), so the two
// rate parsers are separate code. They must never diverge: a difference would
// make the same source string display differently under the two brands.

test('the two brand modules share one scale', () => {
  assert.equal(RATE_SCALE_1965, RATE_SCALE);
  assert.equal(RATE_SCALE_EXPONENT_1965, RATE_SCALE_EXPONENT);
});

test('parseRateText1965 never diverges from the green parseRateText', () => {
  const vectors = [
    '32.77', '32.89', '0.99500', '0.8912', '0.89120', '3.9', '3.90', '33',
    '0.0231', '0.9950004', '0.9950005', '0.9950006', '  32.77  ', '000.5',
    '0', '0.0', '-1', '-0.5', '', '   ', 'N/A', '32,83', '3.2e1', '1/2', '.5', '32.',
  ];
  for (const value of vectors) {
    assert.deepEqual(
      parseRateText1965(value), parseRateText(value),
      `orange and green disagree on ${JSON.stringify(value)}`
    );
  }
  for (const bad of [null, undefined, 32.77, {}, [], true]) {
    assert.equal(parseRateText1965(bad), null);
    assert.equal(parseRateText(bad), null);
  }
});

// ─── parseRateText1965 ──────────────────────────────────────────────────────

test('parseRateText1965: displayDecimals follows the source string, not the scale', () => {
  assert.deepEqual(parseRateText1965('32.77'), { rateScaledE6: 32770000, displayDecimals: 2 });
  assert.deepEqual(parseRateText1965('0.99500'), { rateScaledE6: 995000, displayDecimals: 5 });
  assert.deepEqual(parseRateText1965('33'), { rateScaledE6: 33000000, displayDecimals: 0 });
});

test('parseRateText1965: more decimals than the scale round half-up instead of blanking', () => {
  assert.equal(parseRateText1965('0.9950004')?.rateScaledE6, 995000);
  assert.equal(parseRateText1965('0.9950005')?.rateScaledE6, 995001);
  assert.equal(parseRateText1965('0.9950006')?.displayDecimals, RATE_SCALE_EXPONENT_1965);
});

// ─── normalizeBranchNo ──────────────────────────────────────────────────────

test('normalizeBranchNo accepts the observed shapes and rejects the rest', () => {
  for (const good of ['00', '03', '51', '64', 'E52-01', ' 00 ']) {
    assert.equal(normalizeBranchNo(good), good.trim(), `should accept ${JSON.stringify(good)}`);
  }
  for (const bad of ['0', '000', '5', 'E52', 'E52-1', 'e52-01', '00-01', '', '  ', null, undefined, 0, 51, {}]) {
    assert.equal(normalizeBranchNo(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('BRANCH_NO_PATTERN_1965 is anchored so a longer string cannot slip through', () => {
  assert.equal(BRANCH_NO_PATTERN_1965.test('00x'), false);
  assert.equal(BRANCH_NO_PATTERN_1965.test('x00'), false);
});

// ─── parseSourceUpdateTime ──────────────────────────────────────────────────

test('parseSourceUpdateTime keeps a usable epoch and drops everything else', () => {
  assert.equal(parseSourceUpdateTime(1788949918238), 1788949918238);
  for (const bad of [0, -1, 1.5, '1788949918238', null, undefined, NaN, Infinity, {}]) {
    assert.equal(parseSourceUpdateTime(bad), null);
  }
});

// ─── parseBranchExchange1965 ────────────────────────────────────────────────

test('parseBranchExchange1965: reads only the two contracted buckets', async () => {
  const quote = parseBranchExchange1965(await fixture('exchange-rate-00'), { branchNo: '00' });
  assert.equal(quote.status, 'ok');
  assert.equal(quote.branchNo, '00');
  assert.deepEqual(Object.keys(quote.rates).sort(), ['TWD_1965', 'USD_1965']);
  assert.deepEqual(quote.rates.USD_1965, {
    denom: 'USD_1965', rateScaledE6: 32770000, displayDecimals: 2, unavailableReason: null,
  });
  assert.deepEqual(quote.rates.TWD_1965, {
    denom: 'TWD_1965', rateScaledE6: 995000, displayDecimals: 5, unavailableReason: null,
  });
});

test('parseBranchExchange1965: picks the 100-50 bucket, not the default-flagged or first one', async () => {
  const payload = await fixture('exchange-rate-00');
  const usd = payload.data.datas.find((entry) => entry.currency_code === 'USD');
  // Make "20-10" the default and put it first, so index- or is_default-based
  // matching would pick the wrong number.
  usd.denom_list = [
    { show_denom: '20-10', buy_rate_amount: '32.64', sell_rate_amount: '32.84', is_default: true },
    { show_denom: '100-50', buy_rate_amount: '32.77', sell_rate_amount: '32.89', is_default: false },
  ];
  const quote = parseBranchExchange1965(payload, { branchNo: '00' });
  assert.equal(quote.rates.USD_1965.rateScaledE6, 32770000);
});

test('parseBranchExchange1965: currency order is not stable, so matching is by code', async () => {
  const payload = await fixture('exchange-rate-00');
  const expected = parseBranchExchange1965(clone(payload), { branchNo: '00' });
  payload.data.datas.reverse();
  assert.deepEqual(parseBranchExchange1965(payload, { branchNo: '00' }), expected);
});

test('parseBranchExchange1965: sell_rate_amount never reaches the quote', async () => {
  const quote = parseBranchExchange1965(await fixture('exchange-rate-00'), { branchNo: '00' });
  const serialized = JSON.stringify(quote);
  assert.ok(!serialized.includes('32.89') && !serialized.includes('32890000'));
  assert.ok(!serialized.includes('1.0620') && !serialized.includes('1062000'));
});

test('parseBranchExchange1965: source display strings never reach the quote', async () => {
  const quote = parseBranchExchange1965(await fixture('exchange-rate-00'), { branchNo: '00' });
  const serialized = JSON.stringify(quote);
  for (const leaked of ['ไต้หวัน', 'United States', 'cdn.example', 'currency_description']) {
    assert.ok(!serialized.includes(leaked), `${leaked} must not reach the quote`);
  }
});

test('parseBranchExchange1965: a changed bucket string is missing, not guessed', async () => {
  const payload = await fixture('exchange-rate-00');
  const usd = payload.data.datas.find((entry) => entry.currency_code === 'USD');
  usd.denom_list[1].show_denom = '100 - 50';
  const quote = parseBranchExchange1965(payload, { branchNo: '00' });
  assert.equal(quote.status, 'partial');
  assert.equal(quote.rates.USD_1965.rateScaledE6, null);
  assert.equal(quote.rates.USD_1965.unavailableReason, 'missing');
  assert.equal(quote.rates.TWD_1965.rateScaledE6, 995000);
});

test('parseBranchExchange1965: an absent currency is missing', async () => {
  const payload = await fixture('exchange-rate-00');
  payload.data.datas = payload.data.datas.filter((entry) => entry.currency_code !== 'TWD');
  const quote = parseBranchExchange1965(payload, { branchNo: '00' });
  assert.equal(quote.status, 'partial');
  assert.equal(quote.rates.TWD_1965.unavailableReason, 'missing');
});

test('parseBranchExchange1965: an unusable number is invalid, not missing', async () => {
  const payload = await fixture('exchange-rate-00');
  const usd = payload.data.datas.find((entry) => entry.currency_code === 'USD');
  usd.denom_list[1].buy_rate_amount = 'N/A';
  const quote = parseBranchExchange1965(payload, { branchNo: '00' });
  assert.equal(quote.rates.USD_1965.unavailableReason, 'invalid');
});

test('parseBranchExchange1965: both buckets unusable is failed, not partial', async () => {
  const payload = await fixture('exchange-rate-00');
  payload.data.datas = [];
  const quote = parseBranchExchange1965(payload, { branchNo: '00' });
  assert.equal(quote.status, 'failed');
  assert.equal(quote.sourceUpdatedAtMs, 1788949918238);
});

test('parseBranchExchange1965: a broken envelope fails the whole branch', async () => {
  const base = await fixture('exchange-rate-00');
  const broken = [
    { ...clone(base), status_code: 500 },
    { ...clone(base), code: 'ERROR' },
    // branch-list's envelope must not be accepted here.
    { ...clone(base), code: '200' },
    { ...clone(base), data: null },
    { ...clone(base), data: { datas: 'nope', update_time: 1 } },
    null, undefined, [], 'SUCCESS', 42,
  ];
  for (const payload of broken) {
    const quote = parseBranchExchange1965(payload, { branchNo: '00' });
    assert.equal(quote.status, 'failed', `should reject ${JSON.stringify(payload)?.slice(0, 60)}`);
    assert.equal(quote.rates.USD_1965.unavailableReason, 'invalid');
    assert.equal(quote.sourceUpdatedAtMs, null);
  }
});

test('parseBranchExchange1965: an unusable branchNo fails before the payload is trusted', async () => {
  const payload = await fixture('exchange-rate-00');
  for (const bad of ['0', 'e52-01', '', null, undefined, 51]) {
    assert.equal(parseBranchExchange1965(payload, { branchNo: bad }).status, 'failed');
  }
  assert.equal(parseBranchExchange1965(payload, undefined).status, 'failed');
});

test('parseBranchExchange1965: update_time is carried but never becomes a rate', async () => {
  const payload = await fixture('exchange-rate-00');
  payload.data.update_time = 'not-a-number';
  const quote = parseBranchExchange1965(payload, { branchNo: '00' });
  assert.equal(quote.sourceUpdatedAtMs, null);
  assert.equal(quote.status, 'ok', 'an unusable update_time must not blank the rates');
});

// ─── branchQuoteFailure1965 ─────────────────────────────────────────────────

test('branchQuoteFailure1965 covers every denom with the transport reason', () => {
  const quote = branchQuoteFailure1965('51', 'timeout');
  assert.equal(quote.status, 'failed');
  assert.equal(quote.branchNo, '51');
  assert.equal(quote.sourceUpdatedAtMs, null);
  for (const denom of DENOMS_1965) {
    assert.deepEqual(quote.rates[denom], {
      denom, rateScaledE6: null, displayDecimals: null, unavailableReason: 'timeout',
    });
  }
});

// ─── parseBranchList1965 ────────────────────────────────────────────────────

test('parseBranchList1965: reads the branch picker, keeping code/name/company', async () => {
  const entries = parseBranchList1965(await fixture('branch-list'));
  assert.equal(entries?.length, 4);
  assert.deepEqual(entries[0], {
    code: '00', name: 'Silom Plaza (สีลมพลาซ่า)', companyCode: 'A04', isDefault: true,
  });
  assert.equal(entries.filter((entry) => entry.isDefault).length, 1);
});

test('parseBranchList1965: the E52 tenant is surfaced, not silently dropped', async () => {
  const entries = parseBranchList1965(await fixture('branch-list'));
  const pattaya = entries?.find((entry) => entry.code === 'E52-01');
  assert.equal(pattaya?.companyCode, 'E52');
  assert.notEqual(pattaya?.companyCode, COMPANY_CODE_1965);
});

test('parseBranchList1965: accepts the "200" envelope this endpoint actually sends', async () => {
  const payload = await fixture('branch-list');
  assert.equal(payload.code, '200');
  assert.ok(parseBranchList1965(payload));
});

test('parseBranchList1965: rejects duplicate or unusable codes', async () => {
  const dup = await fixture('branch-list');
  dup.data.datas[1].code = '00';
  assert.equal(parseBranchList1965(dup), null);

  const bad = await fixture('branch-list');
  bad.data.datas[1].code = 'nope';
  assert.equal(parseBranchList1965(bad), null);
});

test('parseBranchList1965: a total that disagrees with the rows means silent pagination', async () => {
  const payload = await fixture('branch-list');
  payload.data.total = 39;
  assert.equal(parseBranchList1965(payload), null);
});

test('parseBranchList1965: rejects broken envelopes and empty lists', async () => {
  const base = await fixture('branch-list');
  const broken = [
    { ...clone(base), status_code: 403 },
    { ...clone(base), code: 'ERROR' },
    { ...clone(base), data: null },
    { ...clone(base), data: { datas: [], total: 0 } },
    { ...clone(base), data: { datas: [{ code: '00' }], total: 1 } },
    null, undefined, [], 'ok',
  ];
  for (const payload of broken) {
    assert.equal(parseBranchList1965(payload), null, `should reject ${JSON.stringify(payload)?.slice(0, 60)}`);
  }
});

// ─── cross-brand sort-key isolation (plan §3.3) ─────────────────────────────

test('orange sort keys never collide with the green ones', async () => {
  const { DENOMS } = await import('../src/data/exchange-rates.js');
  assert.deepEqual(DENOMS_1965, ['USD_1965', 'TWD_1965']);
  for (const denom of DENOMS_1965) {
    assert.ok(!DENOMS.includes(denom), `${denom} must not exist in the green brand`);
  }
  for (const denom of DENOMS) {
    assert.ok(!DENOMS_1965.includes(denom), `${denom} must not exist in the orange brand`);
  }
});

test('the orange buckets are the merged ones the green brand cannot represent', () => {
  assert.deepEqual(SOURCE_DENOMS_1965.USD_1965, { currencyCode: 'USD', showDenom: '100-50' });
  assert.deepEqual(SOURCE_DENOMS_1965.TWD_1965, { currencyCode: 'TWD', showDenom: '1000-100' });
});
