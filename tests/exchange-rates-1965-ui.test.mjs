import assert from 'node:assert/strict';
import test from 'node:test';

import GREEN_MAPPING from '../data/superrich-branches.json' with { type: 'json' };
import { state } from '../src/core/state.js';
import { ORANGE_BRANCHES } from '../src/data/exchange-rates-1965-branch.js';
import { quoteExpiryMs } from '../src/data/exchange-rate-timing.js';
import {
  applyExchangeRatesPayload,
  getExchangeBrand,
  isExchangeLocation,
  syncExchangeControls,
} from '../src/features/exchange-rates.js';
import {
  BRANCH_CACHE_API,
  cancelBranchQueries,
  getExchangeRateCell1965,
  initBranchQueries,
  loadCachedBranchQuotes,
} from '../src/features/exchange-rates-1965-branch.js';
import { renderExchangeRates, sortVisibleIndexes } from '../src/ui/render.js';

const START = Date.parse('2026-10-17T01:00:00.000Z');
const greenSlugs = Object.keys(GREEN_MAPPING.branches);
const orangeSlugs = Object.keys(ORANGE_BRANCHES);

function orangeQuote(slug = orangeSlugs[0], {
  now = START, usd = 33_040_000, twd = 1_020_000,
  expiresAtMs = quoteExpiryMs(now), controlVersion = 'orange-control',
} = {}) {
  return {
    schemaVersion: 1, slug, controlVersion,
    attemptedAt: new Date(now).toISOString(),
    completedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    branch: { slug, ...ORANGE_BRANCHES[slug], status: 'ok', rates: {
      USD_1965: { denom: 'USD_1965', rateScaledE6: usd, displayDecimals: 2, unavailableReason: null },
      TWD_1965: { denom: 'TWD_1965', rateScaledE6: twd, displayDecimals: 2, unavailableReason: null },
    } },
  };
}

function cachePayload(quotes, overrides = {}) {
  return {
    schemaVersion: 1, checkedAt: new Date(Date.now()).toISOString(),
    enabled: true, controlVersion: 'orange-control', quotes, ...overrides,
  };
}

function resetState() {
  Object.assign(state, {
    data: [], visIdx: [], favFilterOn: false, favorites: new Set(), selectedDestinations: new Set(), exchangeSort: 'default',
    exchangeRatesEnabled: null, exchangeControlVersion: null, exchangeRunId: null,
    exchangeRatesBySlug: {}, exchangeCompletedAt: null,
    exchangeNextUpdateAtMs: null, exchangeExpiresAtMs: null,
    exchangeRetryLevel: 0, exchangeLastAttemptAtMs: null,
    exchangeUpdateCheckPending: false, exchangeRatesLoading: false,
    exchangeHasUsableSnapshot: false, exchange1965Branches: {},
    exchange1965BranchControlVersion: null, exchange1965BranchObservedAtMs: 0,
  });
}

function harness(t, onChange = () => {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: START });
  const listeners = {};
  const add = (event, fn) => { listeners[event] = fn; };
  const document = { visibilityState: 'visible', getElementById: () => null, addEventListener: add };
  const navigator = { onLine: true };
  const globals = { document, navigator, window: { addEventListener: add } };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  initBranchQueries(() => { syncExchangeControls(); onChange(); });
  cancelBranchQueries(); // Each case explicitly starts its first cache read.
  t.after(() => {
    cancelBranchQueries();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { listeners, document, navigator };
}

test.beforeEach(resetState);

test('brand detection supports slugs and location rows without changing the boolean API', () => {
  assert.equal(getExchangeBrand(greenSlugs[0]), 'green');
  assert.equal(getExchangeBrand({ id: orangeSlugs[0] }), 'orange');
  assert.equal(getExchangeBrand({ id: 'regular' }), null);
  assert.equal(getExchangeBrand('__proto__'), null);
  assert.equal(isExchangeLocation(orangeSlugs[0]), true);
  assert.equal(isExchangeLocation('regular'), false);
});

test('a cached orange branch panel uses its two buckets, company name, and official URL', async t => {
  harness(t);
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, BRANCH_CACHE_API);
    return Response.json(cachePayload([orangeQuote()]));
  });
  await loadCachedBranchQuotes();
  const row = { id: orangeSlugs[0], nameEn: 'Silom', notesEn: 'G floor', maps: 'https://maps.example/orange' };
  state.data = [row];
  state.visIdx = [0];
  const html = renderExchangeRates(row);

  assert.match(html, /SuperRich Currency Exchange \(1965\) Company Limited\./);
  assert.match(html, /SuperRich 1965：USD 100＋50/);
  assert.match(html, /SuperRich 1965：TWD 1,000–100/);
  assert.match(html, /1 TWD = 1\.02 THB/);
  assert.doesNotMatch(html, /1 USD = 1\.02 THB/);
  assert.equal((html.match(/fx-rate-row/g) || []).length, 2);
  assert.match(html, /superrich1965\.com\/en\/exchange-rate/);
  assert.doesNotMatch(html, /superrichthailand\.com/);
  assert.match(html, /各分店可接受的鈔票面額可能不同/);
  assert.equal(getExchangeRateCell1965(orangeSlugs[1], 'USD_1965'), null);
});

test('mixed-brand sorting compares only the selected brand bucket from cached branch quotes', async t => {
  harness(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json(cachePayload([
    orangeQuote(orangeSlugs[0], { usd: 33_000_000 }),
    orangeQuote(orangeSlugs[1], { usd: 32_000_000 }),
  ])));
  await loadCachedBranchQuotes();
  state.data = [
    { id: 'regular' }, { id: orangeSlugs[1] }, { id: greenSlugs[0] },
    { id: orangeSlugs[0] }, { id: greenSlugs[1] },
  ];
  state.exchangeRatesBySlug = {
    [greenSlugs[0]]: { rates: { USD_100: { rateScaledE6: 31_000_000 } } },
    [greenSlugs[1]]: { rates: { USD_100: { rateScaledE6: 34_000_000 } } },
  };

  assert.deepEqual(sortVisibleIndexes([0, 1, 2, 3, 4], 'USD_1965'), [3, 1, 2, 4, 0]);
  assert.deepEqual(sortVisibleIndexes([4, 3, 2, 1, 0], 'USD_1965'), [3, 1, 2, 4, 0]);
  assert.deepEqual(sortVisibleIndexes([0, 1, 2, 3, 4], 'USD_100'), [4, 2, 3, 1, 0]);
});

test('shared controls keep cached orange sorting usable while green is disabled', async t => {
  const { document } = harness(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json(cachePayload([orangeQuote()])));
  await loadCachedBranchQuotes();
  const options = ['default', 'USD_100', 'USD_50', 'TWD', 'USD_1965', 'TWD_1965']
    .map(value => ({ value, disabled: false }));
  const sort = { hidden: true, value: '', options };
  document.getElementById = id => id === 'exchange-sort' ? sort : null;
  state.exchangeSort = 'USD_1965';
  applyExchangeRatesPayload({ enabled: false, controlVersion: 'green-off', snapshot: null }, {
    requestStartedAtMs: START, responseReceivedAtMs: START, waitingForNewRun: false,
  });
  syncExchangeControls();

  assert.equal(sort.hidden, false);
  assert.equal(sort.value, 'USD_1965');
  assert.equal(options.find(option => option.value === 'USD_100').disabled, true);
  assert.equal(options.find(option => option.value === 'USD_1965').disabled, false);
  assert.equal(getExchangeRateCell1965(orangeSlugs[0], 'USD_1965').rateScaledE6, 33_040_000);
});

test('orange cache disable removes its selected sort without clearing green rates', async t => {
  harness(t);
  let body = cachePayload([orangeQuote()]);
  t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  await loadCachedBranchQuotes();
  state.exchangeSort = 'USD_1965';
  state.exchangeRatesEnabled = true;
  state.exchangeHasUsableSnapshot = true;
  state.exchangeRatesBySlug = { [greenSlugs[0]]: { rates: { USD_100: { rateScaledE6: 33_000_000 } } } };
  body = cachePayload([], { enabled: false, controlVersion: 'orange-off' });
  await loadCachedBranchQuotes();

  assert.equal(state.exchangeSort, 'default');
  assert.equal(getExchangeRateCell1965(orangeSlugs[0], 'USD_1965'), null);
  assert.equal(state.exchangeHasUsableSnapshot, true);
  assert.equal(state.exchangeRatesBySlug[greenSlugs[0]].rates.USD_100.rateScaledE6, 33_000_000);
});

for (const selected of ['TWD_1965', 'USD_100']) {
  test(`orange branch expiry ${selected === 'TWD_1965' ? 'resets its' : 'preserves green'} selected sort`, async t => {
    harness(t);
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(cachePayload([
      orangeQuote(orangeSlugs[0], { expiresAtMs: START + 5_000 }),
    ])));
    await loadCachedBranchQuotes();
    state.exchangeRatesEnabled = true;
    state.exchangeHasUsableSnapshot = true;
    state.exchangeRatesBySlug = { [greenSlugs[0]]: { rates: { USD_100: { rateScaledE6: 33_000_000 } } } };
    state.exchangeSort = selected;
    t.mock.timers.tick(5_000);

    assert.equal(state.exchangeSort, selected === 'TWD_1965' ? 'default' : 'USD_100');
    assert.equal(getExchangeRateCell1965(orangeSlugs[0], 'TWD_1965'), null);
    assert.equal(state.exchangeHasUsableSnapshot, true);
    assert.equal(fetch.mock.callCount(), 1);
  });
}

// Regression coverage for integrating orange into main's label-based interface.
test('orange legacy rows use the shared label filter and retain their publication state', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseCSV } = await import('../src/data/csv-parser.js');
  const { isPublicLocation, matchesLocationFilters, buildPopupContent } = await import('../src/ui/render.js');
  const rows = parseCSV(readFileSync(new URL('../data/locations.csv', import.meta.url), 'utf8'));
  const orange = rows.filter(row => getExchangeBrand(row) === 'orange');
  assert.equal(orange.length, 38);
  assert.equal(orange.filter(row => row.status === 'Published').length, 38);
  assert.equal(orange.filter(row => row.status === 'Paused').length, 0);
  for (const row of orange) {
    assert.equal(row.status, 'Published');
    assert.equal(row.type, 'Currency Exchange');
    assert.equal(row.catEn, '');
    assert.equal(isPublicLocation(row), row.status === 'Published');
  }
  const published = orange.find(row => row.id === 'superrich1965-56');
  state.favFilterOn = false;
  state.selectedDestinations = new Set();
  assert.equal(matchesLocationFilters(published, '', '', 'Currency Exchange'), true);
  assert.equal(matchesLocationFilters(published, '', 'Cafe', 'Currency Exchange'), false);
  assert.equal(matchesLocationFilters(published, '', '', 'LingOrm'), false);
  state.selectedDestinations = new Set(['tokyo']);
  assert.equal(matchesLocationFilters(published, '', '', 'Currency Exchange'), false);
  state.selectedDestinations.clear();
  state.favFilterOn = true;
  state.favorites = new Set();
  assert.equal(matchesLocationFilters(published, '', '', 'Currency Exchange'), false);
  state.favorites.add(published.id);
  assert.equal(matchesLocationFilters(published, '', '', 'Currency Exchange'), true);
  state.data = [published];
  assert.match(buildPopupContent(0), /badge b-exchange is-exchange-orange/);
  assert.doesNotMatch(buildPopupContent(0), /badge b-cat/);
});

test('both map providers distinguish orange-only clusters from green and mixed clusters', async t => {
  const { makeMarkerContent, getExchangeClusterBrand, getExchangeDataPointsBrand } = await import('../src/map/map.js');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: {
    createElement: () => ({ className: '', textContent: '' }),
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  const marker = makeMarkerContent('💱', true, 'orange');
  assert.equal(marker.className, 'marker-dot is-exchange is-exchange-orange');
  const clustered = brand => ({ __markerContent: { classList: { contains: name =>
    name === 'is-exchange' ? brand !== null : name === 'is-exchange-orange' && brand === 'orange',
  } } });
  const points = brands => callback => brands.forEach(brand => callback({
    getData: () => ({ isExchange: brand !== null, exchangeBrand: brand }),
  }));
  for (const [brands, expected] of [
    [['orange', 'orange'], 'orange'], [['green', 'green'], 'green'],
    [['orange', 'green'], null], [['orange', null], null], [[], null],
  ]) {
    assert.equal(getExchangeClusterBrand(brands.map(clustered)), expected);
    assert.equal(getExchangeDataPointsBrand(points(brands)), expected);
  }
});

for (const pause of ['offline', 'hidden', 'requestInFlight']) {
  test(`cached orange quotes expire while ${pause} and recover through the cache endpoint`, async t => {
    const row = { id: orangeSlugs[0], nameEn: 'Orange fixture' };
    let html = '';
    const { document, navigator, listeners } = harness(t, () => { html = renderExchangeRates(row); });
    state.data = [row]; state.visIdx = [0];
    let finishRequest;
    let requestCount = 0;
    const requests = t.mock.method(globalThis, 'fetch', async url => {
      assert.equal(url, BRANCH_CACHE_API);
      if (++requestCount === 1) {
        return Response.json(cachePayload([orangeQuote(orangeSlugs[0], { expiresAtMs: START + 5_000 })]));
      }
      return new Promise(resolve => { finishRequest = resolve; });
    });
    await loadCachedBranchQuotes();
    state.exchangeSort = 'USD_1965';
    state.exchangeRatesEnabled = true;
    state.exchangeRatesBySlug = { [greenSlugs[0]]: { rates: { USD_100: { rateScaledE6: 33_000_000 } } } };
    state.exchangeHasUsableSnapshot = true;
    html = renderExchangeRates(row);
    assert.match(html, /33\.04 THB/);
    if (pause === 'offline') { navigator.onLine = false; listeners.offline(); }
    if (pause === 'hidden') { document.visibilityState = 'hidden'; listeners.visibilitychange(); }
    if (pause === 'requestInFlight') { void loadCachedBranchQuotes(); await Promise.resolve(); }
    t.mock.timers.tick(5_000);

    assert.equal(getExchangeRateCell1965(orangeSlugs[0], 'USD_1965'), null);
    assert.equal(state.exchangeSort, 'default');
    assert.equal(state.exchangeHasUsableSnapshot, true);
    assert.ok(state.exchangeRatesBySlug[greenSlugs[0]]);
    assert.doesNotMatch(html, /33\.04 THB|fx-best|class="fx-checked"/);
    assert.equal((html.match(/暫無報價/g) || []).length, 2);
    assert.equal(requests.mock.callCount(), pause === 'requestInFlight' ? 2 : 1);

    if (pause === 'offline') { navigator.onLine = true; listeners.online(); }
    if (pause === 'hidden') { document.visibilityState = 'visible'; listeners.visibilitychange(); }
    const recovering = loadCachedBranchQuotes();
    await Promise.resolve();
    assert.equal(requests.mock.callCount(), 2);
    finishRequest(Response.json(cachePayload([orangeQuote(orangeSlugs[0], { now: Date.now() })])));
    await recovering;
    assert.equal(getExchangeRateCell1965(orangeSlugs[0], 'USD_1965').rateScaledE6, 33_040_000);
    assert.match(html, /33\.04 THB/);
    assert.doesNotMatch(html, /fx-best/);
  });
}
