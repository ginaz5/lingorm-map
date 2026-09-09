import assert from 'node:assert/strict';
import test from 'node:test';

import BRANCH_MAPPING from '../data/superrich-branches.json' with { type: 'json' };
import { state } from '../src/core/state.js';
import {
  applyExchangeRatesPayload,
  nextExchangeAction,
  parseExchangeRatesPayload,
} from '../src/features/exchange-rates.js';
import {
  matchesLocationFilters,
  renderExchangeRates,
  sortVisibleIndexes,
} from '../src/ui/render.js';
import { lang, setLang } from '../src/core/i18n.js';

const slugs = Object.keys(BRANCH_MAPPING.branches);

function apiPayload({ runId = 'run-1', controlVersion = 'control-1' } = {}) {
  return {
    schemaVersion: 1,
    checkedAt: '2026-09-09T00:05:00.000Z',
    enabled: true,
    controlVersion,
    snapshot: {
      runId,
      controlVersion,
      completedAt: '2026-09-09T00:04:30.000Z',
      nextUpdateAt: '2026-09-09T00:30:00.000Z',
      expiresAt: '2026-09-09T00:31:30.000Z',
      branches: slugs.map(slug => {
        const branch = BRANCH_MAPPING.branches[slug];
        return {
          slug,
          officialId: branch.officialId,
          branchCode: branch.branchCode,
          status: 'ok',
          rates: {
            USD_100: { denom: 'USD_100', rateScaledE6: 32_830_000, displayDecimals: 2, unavailableReason: null },
            USD_50: { denom: 'USD_50', rateScaledE6: 32_780_000, displayDecimals: 2, unavailableReason: null },
            TWD: { denom: 'TWD', rateScaledE6: 995_000, displayDecimals: 5, unavailableReason: null },
          },
        };
      }),
    },
  };
}

function resetExchangeState() {
  Object.assign(state, {
    data: [], visIdx: [], favorites: new Set(), favFilterOn: false,
    selectedDestinations: new Set(), exchangeLocationsOn: false,
    exchangeSort: 'default', exchangeRatesEnabled: null,
    exchangeControlVersion: null, exchangeRunId: null,
    exchangeRatesBySlug: {}, exchangeCompletedAt: null,
    exchangeNextUpdateAtMs: null, exchangeExpiresAtMs: null,
    exchangeRetryLevel: 0, exchangeLastAttemptAtMs: null,
    exchangeUpdateCheckPending: false, exchangeRatesLoading: false,
    exchangeHasUsableSnapshot: false,
  });
}

test.beforeEach(resetExchangeState);

test('public exchange payload accepts all 26 mapped branches and rejects missing coverage', () => {
  const parsed = parseExchangeRatesPayload(apiPayload());
  assert.equal(Object.keys(parsed.snapshot.bySlug).length, 26);
  assert.equal(parsed.snapshot.bySlug[slugs[0]].rates.TWD.rateScaledE6, 995_000);

  const incomplete = apiPayload();
  incomplete.snapshot.branches.pop();
  assert.equal(parseExchangeRatesPayload(incomplete), null);
});

test('scheduler pauses when hidden and expires before the next poll', () => {
  const base = {
    enabled: true, controlVersion: 'v1', runId: 'r1',
    nextUpdateAtMs: 80_000, expiresAtMs: 10_500,
    retryLevel: 0, lastAttemptAtMs: 1_000,
    visible: true, online: true, toggleOn: true,
    hasUsableSnapshot: true, updateCheckPending: true,
  };
  assert.deepEqual(nextExchangeAction(10_000, { ...base, visible: false }), { action: 'idle', delayMs: null });
  assert.deepEqual(nextExchangeAction(10_000, base), { action: 'expire', delayMs: 500 });
});

test('scheduler uses retry delay instead of immediately rechecking a stale run', () => {
  const decision = nextExchangeAction(5_000, {
    enabled: true, controlVersion: 'v1', runId: 'r1',
    nextUpdateAtMs: 2_000, expiresAtMs: 100_000,
    retryLevel: 1, lastAttemptAtMs: 1_000,
    visible: true, online: true, toggleOn: true,
    hasUsableSnapshot: true, updateCheckPending: true,
  });
  assert.deepEqual(decision, { action: 'fetch', delayMs: 6_000 });
});

test('same run response never extends locally anchored deadlines', () => {
  const payload = parseExchangeRatesPayload(apiPayload());
  applyExchangeRatesPayload(payload, {
    requestStartedAtMs: 1_000,
    responseReceivedAtMs: 1_100,
    waitingForNewRun: false,
  });
  const expiry = state.exchangeExpiresAtMs;
  const next = state.exchangeNextUpdateAtMs;

  applyExchangeRatesPayload(payload, {
    requestStartedAtMs: 20_000,
    responseReceivedAtMs: 20_100,
    waitingForNewRun: false,
  });
  assert.equal(state.exchangeExpiresAtMs, expiry);
  assert.equal(state.exchangeNextUpdateAtMs, next);
});

test('exchange rows ignore category and collection filters but keep shared filters', () => {
  const exchange = {
    id: slugs[0], status: 'Published', catZh: '換匯', catEn: 'Currency Exchange',
    type: '', destinationKey: 'bangkok', nameZh: '換匯店', nameEn: 'Exchange', alt: '', notesZh: '', notesEn: '',
  };
  const cafe = {
    id: 'cafe', status: 'Published', catZh: '咖啡廳', catEn: 'Cafe',
    type: 'LingOrm', destinationKey: 'bangkok', nameZh: '咖啡店', nameEn: 'Cafe', alt: '', notesZh: '', notesEn: '',
  };
  state.exchangeLocationsOn = true;
  assert.equal(matchesLocationFilters(exchange, '', '咖啡廳', 'LingOrm'), true);
  assert.equal(matchesLocationFilters(cafe, '', '換匯', ''), false);
  assert.equal(matchesLocationFilters(exchange, '不存在', '', ''), false);
  state.exchangeLocationsOn = false;
  assert.equal(matchesLocationFilters(exchange, '', '', ''), false);
});

test('best-rate sort keeps valid exchange rates first and regular locations last', () => {
  state.data = [
    { id: 'regular' },
    { id: slugs[1] },
    { id: slugs[0] },
    { id: slugs[2] },
  ];
  state.exchangeRatesBySlug = {
    [slugs[0]]: { rates: { USD_100: { rateScaledE6: 33_000_000 } } },
    [slugs[1]]: { rates: { USD_100: { rateScaledE6: 32_000_000 } } },
    [slugs[2]]: { rates: { USD_100: { rateScaledE6: null } } },
  };
  assert.deepEqual(sortVisibleIndexes([0, 1, 2, 3], 'USD_100'), [2, 1, 3, 0]);
});

test('exchange panel always contains three rows, disclaimer, source, and Maps link', () => {
  const row = {
    id: slugs[0], nameEn: 'Ratchadamri 1', notesEn: 'G floor',
    maps: 'https://maps.google.com/example',
  };
  state.visIdx = [0];
  state.data = [row];
  state.exchangeRatesEnabled = true;
  state.exchangeHasUsableSnapshot = true;
  state.exchangeCompletedAt = '2026-09-09T00:04:30.000Z';
  state.exchangeRatesBySlug = parseExchangeRatesPayload(apiPayload()).snapshot.bySlug;

  const html = renderExchangeRates(row);
  assert.match(html, /USD 100/);
  assert.match(html, /USD 50/);
  assert.match(html, /TWD 100–2,000/);
  assert.doesNotMatch(html, /美元鈔/);
  assert.doesNotMatch(html, /鈔票/);
  assert.match(html, /匯率僅供參考/);
  assert.match(html, /superrichthailand\.com\/exchange-rate/);
  assert.match(html, /https:\/\/maps\.google\.com\/example/);
  assert.match(html, /UTC\+7/);

  state.exchangeHasUsableSnapshot = false;
  const unavailable = renderExchangeRates(row);
  assert.equal((unavailable.match(/暫無報價/g) || []).length, 3);
  assert.match(unavailable, /匯率僅供參考/);

  const previousLang = lang;
  const previousLocalStorage = globalThis.localStorage;
  globalThis.localStorage = { setItem() {} };
  try {
    setLang('en');
    state.exchangeHasUsableSnapshot = true;
    const enHtml = renderExchangeRates(row);
    assert.match(enHtml, /USD 100/);
    assert.match(enHtml, /USD 50/);
    assert.match(enHtml, /TWD 100–2,000/);
    assert.doesNotMatch(enHtml, /banknote/);
  } finally {
    setLang(previousLang);
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
  }
});
