// Phase A source contract — docs/superrich-exchange-map-plan.zh-TW.md §2.2, §4.3.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BRANCH_CODE_PATTERN, DENOMS, GOOGLE_MAPS_HOSTS, RATE_SCALE, RATE_SCALE_EXPONENT,
  SOURCE_DENOMS, branchQuoteFailure, normalizeBranchCode, normalizeGoogleLink,
  parseBranchDetail, parseBranchExchange, parseBranchOptions, parseRateText,
} from '../src/data/exchange-rates.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`fixtures/superrich/${name}.json`, import.meta.url), 'utf8'));

const clone = (value) => JSON.parse(JSON.stringify(value));

// ─── scale ──────────────────────────────────────────────────────────────────

test('RATE_SCALE is a single global constant', () => {
  assert.equal(RATE_SCALE, 10 ** RATE_SCALE_EXPONENT);
  assert.equal(RATE_SCALE, 1_000_000);
});

// ─── parseRateText ──────────────────────────────────────────────────────────

test('parseRateText: trailing zeros do not change the compared integer', () => {
  // The plan once claimed these differ as floats. They do not; the real risk
  // is per-row scales, so both must land on the same integer.
  assert.equal(parseRateText('0.8912')?.rateScaledE6, 891200);
  assert.equal(parseRateText('0.89120')?.rateScaledE6, 891200);
  assert.equal(parseRateText('3.9')?.rateScaledE6, parseRateText('3.90')?.rateScaledE6);
});

test('parseRateText: displayDecimals follows the source string, not the scale', () => {
  assert.deepEqual(parseRateText('32.83'), { rateScaledE6: 32830000, displayDecimals: 2 });
  assert.deepEqual(parseRateText('0.99500'), { rateScaledE6: 995000, displayDecimals: 5 });
  assert.deepEqual(parseRateText('33'), { rateScaledE6: 33000000, displayDecimals: 0 });
});

test('parseRateText: every denomination shares one scale', () => {
  const usd = parseRateText('32.83');
  const twd = parseRateText('0.99500');
  assert.ok(usd && twd);
  // Same multiplier both times: dividing back out recovers the decimal value.
  assert.equal(usd.rateScaledE6 / RATE_SCALE, 32.83);
  assert.equal(twd.rateScaledE6 / RATE_SCALE, 0.995);
});

test('parseRateText: more decimals than the scale round half-up instead of blanking', () => {
  assert.equal(parseRateText('0.9950004')?.rateScaledE6, 995000);
  assert.equal(parseRateText('0.9950005')?.rateScaledE6, 995001);
  assert.equal(parseRateText('0.9950006')?.displayDecimals, RATE_SCALE_EXPONENT);
});

test('parseRateText: rejects unusable values', () => {
  for (const bad of ['0', '0.0', '-1', '-0.5', '', '   ', 'N/A', '32,83', '3.2e1', '1/2', '.5', '32.']) {
    assert.equal(parseRateText(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
  for (const bad of [null, undefined, 32.83, {}, []]) {
    assert.equal(parseRateText(bad), null);
  }
});

test('parseRateText: rejects values beyond the safe integer range', () => {
  assert.equal(parseRateText('99999999999.999999'), null);
  assert.ok(parseRateText('9007199254.740991'));
});

// ─── googleLink whitelist ───────────────────────────────────────────────────

test('normalizeGoogleLink: accepts both live forms', () => {
  const shortened = 'https://maps.app.goo.gl/dqWjKM8ZMEVxPJ2VA';
  const cid = 'https://www.google.com/maps?cid=718901648721976383';
  assert.equal(normalizeGoogleLink(shortened), shortened);
  assert.equal(normalizeGoogleLink(cid), cid);
  assert.equal(normalizeGoogleLink(`  ${cid}  `), cid);
});

test('normalizeGoogleLink: drops anything else', () => {
  for (const bad of [
    'https://maps.apple.com/?q=1',
    'https://evil.example/maps?cid=1',
    'https://www.google.com.evil.example/maps',
    'http://www.google.com/maps?cid=1',
    'javascript:alert(1)',
    'not a url',
    '',
    null,
  ]) {
    assert.equal(normalizeGoogleLink(bad), null, `should drop ${String(bad)}`);
  }
});

test('GOOGLE_MAPS_HOSTS covers the observed hosts', () => {
  assert.ok(GOOGLE_MAPS_HOSTS.includes('maps.app.goo.gl'));
  assert.ok(GOOGLE_MAPS_HOSTS.includes('www.google.com'));
});

// ─── branch identity ────────────────────────────────────────────────────────

test('normalizeBranchCode: accepts the verified sample, rejects noise', () => {
  assert.equal(normalizeBranchCode('M17'), 'M17');
  assert.equal(normalizeBranchCode('H01'), 'H01');
  assert.ok(BRANCH_CODE_PATTERN.test('M17'));
  for (const bad of ['', 'm17', 'M', '17', 'MMMM1', 'M1234', 'M17 ;drop', null, 17]) {
    assert.equal(normalizeBranchCode(bad), null, `should reject ${String(bad)}`);
  }
});

// ─── branch options / detail ────────────────────────────────────────────────

test('parseBranchOptions: returns ids only, never source labels', async () => {
  const ids = parseBranchOptions(await fixture('branch-options'));
  assert.deepEqual(ids, [10, 11, 28, 30, 32, 33, 35]);
  assert.ok(ids.every((id) => typeof id === 'number'));
});

test('parseBranchOptions: rejects malformed or duplicated payloads', async () => {
  const base = await fixture('branch-options');
  assert.equal(parseBranchOptions(null), null);
  assert.equal(parseBranchOptions({ data: 'nope' }), null);
  assert.equal(parseBranchOptions({ data: [] }), null);
  assert.equal(parseBranchOptions({ data: [{ label: 'x', value: '28' }] }), null);
  const dupe = clone(base);
  dupe.data.push({ label: 'copy', value: 28 });
  assert.equal(parseBranchOptions(dupe), null);
});

test('parseBranchDetail: keeps coordinates and link, drops the address string', async () => {
  const detail = parseBranchDetail(await fixture('branch-10'));
  assert.deepEqual(detail, {
    officialId: 10,
    lat: 13.748517,
    lng: 100.541713,
    googleLink: 'https://www.google.com/maps?cid=718901648721976383',
  });
  assert.ok(!Object.keys(detail ?? {}).includes('address'));
});

test('parseBranchDetail: rejects out-of-range or unparsable coordinates', async () => {
  const base = await fixture('branch-28');
  for (const patch of [{ latitude: '999' }, { longitude: 'x' }, { latitude: '' }, { id: 0 }]) {
    assert.equal(parseBranchDetail({ ...base, data: { ...base.data, ...patch } }), null);
  }
});

test('parseBranchDetail: a non-whitelisted link becomes null without failing the branch', async () => {
  const base = await fixture('branch-28');
  const detail = parseBranchDetail({ ...base, data: { ...base.data, googleLink: 'https://evil.example/x' } });
  assert.equal(detail?.officialId, 28);
  assert.equal(detail?.googleLink, null);
});

test('source parsers reject unsuccessful business responses even if data is present', async () => {
  const options = await fixture('branch-options');
  const detail = await fixture('branch-10');
  const exchange = await fixture('exchange-28');
  for (const patch of [{ code: 'FAILED' }, { statusCode: 500 }, { code: undefined }]) {
    assert.equal(parseBranchOptions({ ...options, ...patch }), null);
    assert.equal(parseBranchDetail({ ...detail, ...patch }), null);
    assert.equal(parseBranchExchange({ ...exchange, ...patch }, { officialId: 28 }).status, 'failed');
  }
  assert.equal(parseBranchDetail(detail.data), null, 'an unwrapped fixture must not impersonate an API response');
});

test('branch code validation accepts the full observed 26-branch inventory', async () => {
  const codes = await fixture('branch-codes');
  assert.equal(codes.length, 26);
  assert.equal(new Set(codes.map(row => row.officialId)).size, 26);
  assert.equal(new Set(codes.map(row => row.branchCode)).size, 26);
  for (const row of codes) assert.equal(normalizeBranchCode(row.branchCode), row.branchCode);
});

// ─── exchange parsing ───────────────────────────────────────────────────────

test('parseBranchExchange: reads exactly the three contracted denominations', async () => {
  const quote = parseBranchExchange(await fixture('exchange-28'), { officialId: 28 });
  assert.equal(quote.status, 'ok');
  assert.equal(quote.branchCode, 'M17');
  assert.equal(quote.rates.USD_100.rateScaledE6, 32830000);
  assert.equal(quote.rates.USD_50.rateScaledE6, 32830000);
  assert.equal(quote.rates.TWD.rateScaledE6, 995000);
  assert.equal(quote.rates.TWD.displayDecimals, 5);
  assert.deepEqual(Object.keys(quote.rates), [...DENOMS]);
});

test('parseBranchExchange: ignores the other USD denominations and other currencies', async () => {
  const quote = parseBranchExchange(await fixture('exchange-28'), { officialId: 28 });
  const values = DENOMS.map((denom) => quote.rates[denom].rateScaledE6);
  // 32.75 / 32.65 / 32.30 (20-10, 5, 1) and 38.10 (EUR) must not appear.
  for (const leaked of [32750000, 32650000, 32300000, 38100000]) {
    assert.ok(!values.includes(leaked), `leaked ${leaked}`);
  }
});

test('parseBranchExchange: a changed denomRem string is missing, never guessed', async () => {
  const payload = clone(await fixture('exchange-28'));
  payload.data.exchange.TWD[0].denomRem = '2000-100';
  const quote = parseBranchExchange(payload, { officialId: 28 });
  assert.equal(quote.rates.TWD.rateScaledE6, null);
  assert.equal(quote.rates.TWD.unavailableReason, 'missing');
  assert.equal(quote.status, 'partial');
});

test('parseBranchExchange: never reads sellText', async () => {
  const base = await fixture('exchange-28');
  const swapped = clone(base);
  for (const rows of Object.values(swapped.data.exchange)) {
    for (const row of rows) row.sellText = '999.99';
  }
  const stripped = clone(base);
  for (const rows of Object.values(stripped.data.exchange)) {
    for (const row of rows) delete row.sellText;
  }
  const expected = parseBranchExchange(base, { officialId: 28 });
  assert.deepEqual(parseBranchExchange(swapped, { officialId: 28 }), expected);
  assert.deepEqual(parseBranchExchange(stripped, { officialId: 28 }), expected);
});

test('parseBranchExchange: an invalid buyText blanks only its own row', async () => {
  const payload = clone(await fixture('exchange-28'));
  payload.data.exchange.USD[0].buyText = '0';
  const quote = parseBranchExchange(payload, { officialId: 28 });
  assert.equal(quote.rates.USD_100.unavailableReason, 'invalid');
  assert.equal(quote.rates.USD_50.rateScaledE6, 32830000);
  assert.equal(quote.status, 'partial');
});

test('parseBranchExchange: inconsistent branchCode fails the whole branch', async () => {
  const payload = clone(await fixture('exchange-28'));
  payload.data.exchange.TWD[0].branchCode = 'H01';
  const quote = parseBranchExchange(payload, { officialId: 28 });
  assert.equal(quote.status, 'failed');
  assert.equal(quote.branchCode, null);
  assert.ok(DENOMS.every((denom) => quote.rates[denom].rateScaledE6 === null));
});

test('parseBranchExchange: a branchCode from another branch fails the whole branch', async () => {
  const payload = await fixture('exchange-28');
  const quote = parseBranchExchange(payload, { officialId: 28, expectedBranchCode: 'H01' });
  assert.equal(quote.status, 'failed');
  assert.equal(parseBranchExchange(payload, { officialId: 28, expectedBranchCode: 'M17' }).status, 'ok');
});

test('parseBranchExchange: a malformed or missing branchCode fails the whole branch', async () => {
  const payload = clone(await fixture('exchange-28'));
  for (const rows of Object.values(payload.data.exchange)) {
    for (const row of rows) delete row.branchCode;
  }
  assert.equal(parseBranchExchange(payload, { officialId: 28 }).status, 'failed');
});

test('parseBranchExchange: structural damage yields a whole-branch invalid result', async () => {
  const base = await fixture('exchange-28');
  for (const payload of [null, {}, { data: {} }, { data: { exchange: [] } }, { data: { exchange: { USD: 'x' } } }]) {
    const quote = parseBranchExchange(payload, { officialId: 28 });
    assert.equal(quote.status, 'failed');
    assert.equal(quote.rates.USD_100.unavailableReason, 'invalid');
  }
  const empty = clone(base);
  empty.data.exchange = {};
  const quote = parseBranchExchange(empty, { officialId: 28 });
  assert.equal(quote.status, 'failed');
  assert.ok(DENOMS.every((denom) => quote.rates[denom].unavailableReason === 'missing'));
});

test('branchQuoteFailure: transport failures produce the same shape', () => {
  const quote = branchQuoteFailure(28, 'timeout');
  assert.equal(quote.status, 'failed');
  assert.equal(quote.branchCode, null);
  assert.ok(DENOMS.every((denom) => quote.rates[denom].unavailableReason === 'timeout'));
});

// ─── no raw source strings escape ───────────────────────────────────────────

test('parseBranchExchange: hostile source strings never reach the output', async () => {
  const payload = clone(await fixture('exchange-28'));
  const hostile = '<img src=x onerror=alert(1)>';
  for (const rows of Object.values(payload.data.exchange)) {
    for (const row of rows) {
      row.denomCode = hostile;
      row.image = hostile;
      row.message = hostile;
    }
  }
  payload.message = hostile;
  const serialized = JSON.stringify(parseBranchExchange(payload, { officialId: 28 }));
  assert.ok(!serialized.includes('<'), 'no markup may survive parsing');
  assert.ok(!serialized.includes('onerror'));
});

test('parseBranchExchange: output contains only enums, numbers and the branch code', async () => {
  const quote = parseBranchExchange(await fixture('exchange-28'), { officialId: 28 });
  assert.deepEqual(Object.keys(quote).sort(), ['branchCode', 'officialId', 'rates', 'status']);
  for (const denom of DENOMS) {
    const cell = quote.rates[denom];
    assert.deepEqual(Object.keys(cell).sort(), ['denom', 'displayDecimals', 'rateScaledE6', 'unavailableReason']);
    assert.ok(DENOMS.includes(cell.denom));
    assert.ok(cell.rateScaledE6 === null || Number.isSafeInteger(cell.rateScaledE6));
  }
});

test('SOURCE_DENOMS records the exact verified strings', () => {
  assert.deepEqual(SOURCE_DENOMS.USD_100, { unit: 'USD', denomRem: '100' });
  assert.deepEqual(SOURCE_DENOMS.USD_50, { unit: 'USD', denomRem: '50' });
  assert.deepEqual(SOURCE_DENOMS.TWD, { unit: 'TWD', denomRem: '2000 - 100' });
});
