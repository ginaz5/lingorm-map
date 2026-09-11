import assert from 'node:assert/strict';
import test from 'node:test';

import GREEN_MAPPING from '../data/superrich-branches.json' with { type: 'json' };
import ORANGE_MAPPING from '../data/superrich1965-branches.json' with { type: 'json' };
import { state } from '../src/core/state.js';
import {
  applyExchangeRatesPayload,
  getExchangeBrand,
  isExchangeLocation,
  syncExchangeControls,
} from '../src/features/exchange-rates.js';
import {
  applyExchangeRates1965Payload,
  expireExchangeRates1965,
  getExchangeRateCell1965,
  parseExchangeRates1965Payload,
} from '../src/features/exchange-rates-1965.js';
import { renderExchangeRates, sortVisibleIndexes } from '../src/ui/render.js';

const greenSlugs = Object.keys(GREEN_MAPPING.branches);
const orangeSlugs = Object.keys(ORANGE_MAPPING.branches);

function orangePayload({ runId = 'orange-run', controlVersion = 'orange-control' } = {}) {
  return {
    schemaVersion: 1,
    checkedAt: '2026-09-11T00:05:00.000Z',
    enabled: true,
    controlVersion,
    snapshot: {
      runId,
      controlVersion,
      completedAt: '2026-09-11T00:04:30.000Z',
      nextUpdateAt: '2026-09-11T00:30:00.000Z',
      expiresAt: '2026-09-11T00:31:30.000Z',
      branches: orangeSlugs.map(slug => {
        const branch = ORANGE_MAPPING.branches[slug];
        return {
          slug,
          officialId: branch.officialId,
          branchNo: branch.branchNo,
          companyCode: branch.companyCode,
          sourceUpdatedAtMs: 1_788_951_064_201,
          status: 'ok',
          rates: {
            USD_1965: { denom: 'USD_1965', rateScaledE6: 33_040_000, displayDecimals: 2, unavailableReason: null },
            TWD_1965: { denom: 'TWD_1965', rateScaledE6: 1_020_000, displayDecimals: 2, unavailableReason: null },
          },
        };
      }),
    },
  };
}

function emptyOrangeState() {
  return {
    ratesBySlug: {}, runId: null, controlVersion: null, enabled: null,
    completedAt: null, nextUpdateAtMs: null, expiresAtMs: null,
    retryLevel: 0, lastAttemptAtMs: null, updateCheckPending: false,
    ratesLoading: false, hasUsableSnapshot: false,
  };
}

function resetState() {
  Object.assign(state, {
    data: [], visIdx: [], exchangeLocationsOn: true, exchangeSort: 'default',
    exchangeRatesEnabled: null, exchangeControlVersion: null, exchangeRunId: null,
    exchangeRatesBySlug: {}, exchangeCompletedAt: null,
    exchangeNextUpdateAtMs: null, exchangeExpiresAtMs: null,
    exchangeRetryLevel: 0, exchangeLastAttemptAtMs: null,
    exchangeUpdateCheckPending: false, exchangeRatesLoading: false,
    exchangeHasUsableSnapshot: false, exchange1965: emptyOrangeState(),
  });
}

test.beforeEach(resetState);

test('orange public payload requires exact coverage and branch identity', () => {
  const parsed = parseExchangeRates1965Payload(orangePayload());
  assert.equal(Object.keys(parsed.snapshot.bySlug).length, 38);
  assert.equal(getExchangeRateCell1965(orangeSlugs[0], 'USD_1965'), null);

  const incomplete = orangePayload();
  incomplete.snapshot.branches.pop();
  assert.equal(parseExchangeRates1965Payload(incomplete), null);

  const wrongBranch = orangePayload();
  wrongBranch.snapshot.branches[0].branchNo = '99';
  assert.equal(parseExchangeRates1965Payload(wrongBranch), null);
});

test('brand detection supports slugs and location rows without changing the boolean API', () => {
  assert.equal(getExchangeBrand(greenSlugs[0]), 'green');
  assert.equal(getExchangeBrand({ id: orangeSlugs[0] }), 'orange');
  assert.equal(getExchangeBrand({ id: 'regular' }), null);
  assert.equal(isExchangeLocation(orangeSlugs[0]), true);
  assert.equal(isExchangeLocation('regular'), false);
});

test('orange panel uses two orange buckets, company name, and orange official URL', () => {
  const parsed = parseExchangeRates1965Payload(orangePayload());
  applyExchangeRates1965Payload(parsed, {
    requestStartedAtMs: 1_000,
    responseReceivedAtMs: 1_100,
    waitingForNewRun: false,
  });
  const row = { id: orangeSlugs[0], nameEn: 'Silom', notesEn: 'G floor', maps: 'https://maps.example/orange' };
  state.data = [row];
  state.visIdx = [0];
  const html = renderExchangeRates(row);

  assert.match(html, /SuperRich Currency Exchange \(1965\) Company Limited\./);
  assert.match(html, /SuperRich 1965：USD 100＋50/);
  assert.match(html, /SuperRich 1965：TWD 1,000–100/);
  assert.equal((html.match(/fx-rate-row/g) || []).length, 2);
  assert.match(html, /superrich1965\.com\/en\/exchange-rate/);
  assert.doesNotMatch(html, /superrichthailand\.com/);
  assert.match(html, /各分店可接受的鈔票面額可能不同/);
});

test('mixed-brand sorting compares only the selected brand bucket', () => {
  state.data = [
    { id: 'regular' },
    { id: orangeSlugs[1] },
    { id: greenSlugs[0] },
    { id: orangeSlugs[0] },
    { id: greenSlugs[1] },
  ];
  state.exchange1965.ratesBySlug = {
    [orangeSlugs[0]]: { rates: { USD_1965: { rateScaledE6: 33_000_000 } } },
    [orangeSlugs[1]]: { rates: { USD_1965: { rateScaledE6: 32_000_000 } } },
  };
  state.exchangeRatesBySlug = {
    [greenSlugs[0]]: { rates: { USD_100: { rateScaledE6: 31_000_000 } } },
    [greenSlugs[1]]: { rates: { USD_100: { rateScaledE6: 34_000_000 } } },
  };

  assert.deepEqual(sortVisibleIndexes([0, 1, 2, 3, 4], 'USD_1965'), [3, 1, 2, 4, 0]);
  assert.deepEqual(sortVisibleIndexes([4, 3, 2, 1, 0], 'USD_1965'), [3, 1, 2, 4, 0]);
  assert.deepEqual(sortVisibleIndexes([0, 1, 2, 3, 4], 'USD_100'), [4, 2, 3, 1, 0]);
});

test('shared controls keep one brand usable when the other is unavailable', () => {
  const previousDocument = globalThis.document;
  const options = ['default', 'USD_100', 'USD_50', 'TWD', 'USD_1965', 'TWD_1965']
    .map(value => ({ value, disabled: false }));
  const toggle = { checked: false };
  const sort = { hidden: true, value: '', options };
  globalThis.document = { getElementById: id => id === 'exchange-toggle' ? toggle : id === 'exchange-sort' ? sort : null };
  try {
    state.exchangeSort = 'USD_1965';
    state.exchangeRatesEnabled = false;
    state.exchangeHasUsableSnapshot = false;
    state.exchange1965.enabled = true;
    state.exchange1965.hasUsableSnapshot = true;
    syncExchangeControls();

    assert.equal(sort.hidden, false);
    assert.equal(sort.value, 'USD_1965');
    assert.equal(options.find(option => option.value === 'USD_100').disabled, true);
    assert.equal(options.find(option => option.value === 'USD_1965').disabled, false);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('disabling or expiring one brand does not clear the other brand', () => {
  state.exchangeSort = 'USD_1965';
  state.exchangeRatesBySlug = { [greenSlugs[0]]: { rates: {} } };
  state.exchangeHasUsableSnapshot = true;
  state.exchange1965.ratesBySlug = { [orangeSlugs[0]]: { rates: {} } };
  state.exchange1965.hasUsableSnapshot = true;

  applyExchangeRatesPayload({ enabled: false, controlVersion: 'green-off', snapshot: null }, {
    requestStartedAtMs: 1_000, responseReceivedAtMs: 1_100, waitingForNewRun: false,
  });
  assert.equal(state.exchangeSort, 'USD_1965');
  assert.equal(state.exchange1965.hasUsableSnapshot, true);

  state.exchangeRatesBySlug = { [greenSlugs[0]]: { rates: {} } };
  state.exchangeHasUsableSnapshot = true;
  expireExchangeRates1965();
  assert.equal(state.exchangeHasUsableSnapshot, true);
  assert.ok(state.exchangeRatesBySlug[greenSlugs[0]]);

  applyExchangeRates1965Payload({ enabled: false, controlVersion: 'orange-off', snapshot: null }, {
    requestStartedAtMs: 2_000, responseReceivedAtMs: 2_100, waitingForNewRun: false,
  });
  assert.equal(state.exchangeSort, 'default');
  assert.equal(state.exchangeHasUsableSnapshot, true);
});
