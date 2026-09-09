import assert from 'node:assert/strict';
import test from 'node:test';

import BRANCH_MAPPING from '../data/superrich-branches.json' with { type: 'json' };
import { state } from '../src/core/state.js';
import {
  applyExchangeRatesPayload,
  initExchangeRates,
  nextExchangeAction,
  parseExchangeRatesPayload,
  scheduleExchangeAction,
  setExchangeLocationsVisible,
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

test('scheduler pauses polling but retains expiration when hidden, offline, or fetching', () => {
  const base = {
    enabled: true, controlVersion: 'v1', runId: 'r1',
    nextUpdateAtMs: 80_000, expiresAtMs: 10_500,
    retryLevel: 0, lastAttemptAtMs: 1_000,
    visible: true, online: true, toggleOn: true,
    hasUsableSnapshot: true, updateCheckPending: true,
  };
  for (const paused of [{ visible: false }, { online: false }, { toggleOn: false }, { requestInFlight: true }]) {
    assert.deepEqual(nextExchangeAction(10_000, { ...base, ...paused }), { action: 'expire', delayMs: 500 });
    assert.deepEqual(nextExchangeAction(10_000, { ...base, ...paused, hasUsableSnapshot: false }), { action: 'idle', delayMs: null });
  }
  assert.deepEqual(nextExchangeAction(10_000, base), { action: 'expire', delayMs: 500 });
  assert.deepEqual(nextExchangeAction(100_000, base), { action: 'expire', delayMs: 0 });
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

function browserHarness(t, onChange = () => {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  const listeners = {};
  const browserDocument = { visibilityState: 'visible', getElementById: () => null, addEventListener: (name, fn) => { listeners[name] = fn; } };
  const browserNavigator = { onLine: true };
  const globals = {
    document: browserDocument,
    navigator: browserNavigator,
    window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
    localStorage: { getItem: () => 'true', setItem() {} },
  };
  const descriptors = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  t.after(async () => {
    setExchangeLocationsVisible(false);
    state.exchangeHasUsableSnapshot = false;
    scheduleExchangeAction();
    await new Promise(resolve => setImmediate(resolve));
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const payload = apiPayload();
  payload.checkedAt = '2026-09-09T00:31:25.000Z';
  applyExchangeRatesPayload(parseExchangeRatesPayload(payload), {
    requestStartedAtMs: Date.now(), responseReceivedAtMs: Date.now(), waitingForNewRun: false,
  });
  state.exchangeSort = 'USD_100';
  const row = { id: slugs[0], nameEn: 'Fixture branch', notesEn: '', maps: '' };
  state.data = [row];
  state.visIdx = [0];
  initExchangeRates(onChange);
  return { listeners, browserDocument, browserNavigator, row };
}

test('going offline expires rendered rates and best badges without another API request', t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected fetch'); });
  let rendered = '';
  const { listeners, browserNavigator, row } = browserHarness(t, () => { rendered = renderExchangeRates(state.data[0]); });
  assert.match(renderExchangeRates(row), /32\.83 THB/);
  assert.match(renderExchangeRates(row), /fx-best/);
  browserNavigator.onLine = false;
  listeners.offline();
  t.mock.timers.tick(5_000);
  assert.equal(state.exchangeHasUsableSnapshot, false);
  assert.equal(state.exchangeSort, 'default');
  assert.equal((rendered.match(/暫無報價/g) || []).length, 3);
  assert.doesNotMatch(rendered, /32\.83 THB|fx-best/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('expiration still runs while an API request is pending', async t => {
  let finish;
  const fetchMock = t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { finish = resolve; }));
  browserHarness(t);
  state.exchangeLastAttemptAtMs = Date.now() - 60_000;
  scheduleExchangeAction();
  t.mock.timers.tick(0);
  assert.equal(fetchMock.mock.callCount(), 1);
  t.mock.timers.tick(5_000);
  assert.equal(state.exchangeHasUsableSnapshot, false);
  assert.equal(fetchMock.mock.callCount(), 1);
  const payload = apiPayload({ runId: 'new-run' });
  finish(Response.json(payload));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.exchangeHasUsableSnapshot, true);
  assert.equal(state.exchangeRunId, 'new-run');
});

test('returning from a suspended tab clears expired prices before fetching', t => {
  const observed = [];
  t.mock.method(globalThis, 'fetch', async () => {
    observed.push(state.exchangeHasUsableSnapshot);
    return Response.json({ schemaVersion: 1, checkedAt: new Date().toISOString(), enabled: false, controlVersion: null, snapshot: null });
  });
  const { listeners, browserDocument } = browserHarness(t);
  browserDocument.visibilityState = 'hidden';
  listeners.visibilitychange();
  t.mock.timers.setTime(Date.now() + 120_000);
  browserDocument.visibilityState = 'visible';
  listeners.visibilitychange();
  assert.equal(state.exchangeHasUsableSnapshot, false);
  t.mock.timers.tick(0);
  assert.deepEqual(observed, [false]);
});
