import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { state } from '../src/core/state.js';
import { T } from '../src/core/i18n.js';
import { parseCSV } from '../src/data/csv-parser.js';
import { ORANGE_BRANCHES, BRANCH_QUOTE_TTL_MS, parseBranchQueryPayload } from '../src/data/exchange-rates-1965-branch.js';
import { queryOrangeBranch, loadCachedBranchQuotes, getBranchQueryState, initBranchQueries, cancelBranchQueries, BRANCH_QUERY_API, BRANCH_CACHE_API } from '../src/features/exchange-rates-1965-branch.js';
import { getExchangeRateCell1965 } from '../src/features/exchange-rates-1965.js';
import { isExchangeSortAvailable, syncExchangeControls } from '../src/features/exchange-rates.js';
import { renderExchangeRates, buildPopupContent, sortVisibleIndexes } from '../src/ui/render.js';
import { refreshActivePopup } from '../src/map/map.js';
import { uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-17T01:00:00.000Z');
const [slug, otherSlug] = Object.keys(ORANGE_BRANCHES);
const base = parseCSV(readFileSync(new URL('../data/locations.csv', import.meta.url), 'utf8')).find(row => row.id === slug);
const row = { ...base, status: 'Published' }; // Real pilot branch; no snapshot mutations in tests.
function payload(target = slug, overrides = {}) {
  return {
    schemaVersion: 1, checkedAt: new Date(START).toISOString(), slug: target, enabled: true, controlVersion: uuid(1), reason: null, retryAfterSeconds: 0,
    quote: { schemaVersion: 1, slug: target, controlVersion: uuid(1), attemptedAt: new Date(START).toISOString(),
      completedAt: new Date(START).toISOString(), expiresAt: new Date(START + BRANCH_QUOTE_TTL_MS).toISOString(),
      branch: { slug: target, ...ORANGE_BRANCHES[target], status: 'ok', rates: {
        USD_1965: { denom: 'USD_1965', rateScaledE6: 32_770_000, displayDecimals: 2, unavailableReason: null },
        TWD_1965: { denom: 'TWD_1965', rateScaledE6: 995_000, displayDecimals: 5, unavailableReason: null },
      } },
    }, ...overrides,
  };
}

function harness(t, onChange = () => {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: START });
  state.exchange1965Branches = {};
  state.exchange1965BranchControlVersion = null;
  state.exchange1965BranchObservedAtMs = 0;
  state.exchangeSort = 'default';
  state.exchange1965.ratesBySlug = {};
  state.exchange1965.hasUsableSnapshot = false;
  state.exchange1965.enabled = null;
  state.data = [row]; state.visIdx = [0]; state.favorites = new Set();
  const listeners = {};
  const add = (event, fn, capture) => { listeners[event] = { fn, capture }; };
  const document = { visibilityState: 'visible', getElementById: () => null, addEventListener: add };
  const globals = { document, window: { addEventListener: add } };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  initBranchQueries(() => { syncExchangeControls(); onChange(); });
  cancelBranchQueries(); // Unit cases below opt into cache reads explicitly.
  t.after(() => {
    cancelBranchQueries();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { listeners, document };
}

test('rendering, resume and expiry only read shared cache and never POST to the source proxy', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, BRANCH_CACHE_API);
    return Response.json({ schemaVersion: 1, checkedAt: new Date(Date.now()).toISOString(), enabled: true, controlVersion: uuid(1), quotes: [] });
  });
  const { listeners } = harness(t);
  const html = renderExchangeRates(row);
  assert.match(html, /data-orange-query=/);
  assert.match(html, /查詢此分店匯率/);
  listeners.visibilitychange.fn();
  listeners.pageshow.fn();
  listeners.online.fn();
  t.mock.timers.tick(10 * 60_000);
  await loadCachedBranchQuotes();
  assert.equal(fetch.mock.callCount(), 1);
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /initBranchQueries\(/);
  assert.doesNotMatch(main, /initExchangeRates1965\(/);
});

function cachePayload(quotes = [payload().quote], overrides = {}) {
  return { schemaVersion: 1, checkedAt: new Date(Date.now()).toISOString(), enabled: true,
    controlVersion: uuid(1), quotes, ...overrides };
}

test('cache reads render rates without progress or a manual button; missing branches retain single-branch buttons', async t => {
  harness(t);
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, BRANCH_CACHE_API);
    return Response.json(cachePayload());
  });
  await loadCachedBranchQuotes();
  assert.match(renderExchangeRates(row), /32\.77 THB/);
  assert.doesNotMatch(renderExchangeRates(row), /data-orange-query|附近報價|查詢已暫停/);
  assert.match(renderExchangeRates({ ...row, id: otherSlug }), /data-orange-query=/);
  assert.equal(isExchangeSortAvailable('USD_1965'), true);
  t.mock.timers.tick(60_000);
  await loadCachedBranchQuotes();
  assert.equal(fetch.mock.callCount(), 2);
});

test('cache-read failures retain valid quotes and expiry restores the per-branch fallback button', async t => {
  harness(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json(cachePayload()));
  await loadCachedBranchQuotes();
  const expires = getBranchQueryState(slug).expiresAtMs;
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await loadCachedBranchQuotes();
  assert.equal(getBranchQueryState(slug).expiresAtMs, expires);
  assert.ok(getBranchQueryState(slug).quote);
  t.mock.timers.setTime(expires + 1);
  assert.equal(getBranchQueryState(slug).quote, null);
  assert.match(renderExchangeRates(row), /data-orange-query=/);
});

test('cache disable invalidates orange quotes without touching green quotes', async t => {
  harness(t);
  state.exchangeRatesBySlug = { green: { preserved: true } };
  let body = cachePayload();
  t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  await loadCachedBranchQuotes();
  body = cachePayload([], { enabled: false, controlVersion: uuid(2) });
  await loadCachedBranchQuotes();
  assert.equal(getBranchQueryState(slug).quote, null);
  assert.deepEqual(state.exchangeRatesBySlug.green, { preserved: true });
});

test('a failed manual request cannot erase a newer quote obtained by a concurrent cache read', async t => {
  harness(t);
  let finish;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === BRANCH_CACHE_API) return Response.json(cachePayload());
    return new Promise(resolve => { finish = resolve; });
  });
  const manual = queryOrangeBranch(slug);
  await Promise.resolve();
  await loadCachedBranchQuotes();
  finish(Response.json(payload(slug, { quote: null, reason: 'busy', retryAfterSeconds: 2 }), { status: 202 }));
  await manual;
  assert.ok(getBranchQueryState(slug).quote);
  assert.equal(getBranchQueryState(slug).loading, false);
  assert.doesNotMatch(renderExchangeRates(row), /data-orange-query/);
});

for (const newGeneration of [false, true]) {
  test(`a delayed manual success cannot replace a newer cached quote (${newGeneration ? 'new control' : 'same control'})`, async t => {
    harness(t);
    let finish;
    const fresh = payload().quote;
    fresh.completedAt = new Date(START + 1000).toISOString();
    if (newGeneration) fresh.controlVersion = uuid(2);
    t.mock.method(globalThis, 'fetch', async url => {
      if (url === BRANCH_CACHE_API) return Response.json(cachePayload([fresh], { controlVersion: fresh.controlVersion }));
      return new Promise(resolve => { finish = resolve; });
    });
    const manual = queryOrangeBranch(slug);
    await Promise.resolve();
    t.mock.timers.tick(1000);
    await loadCachedBranchQuotes();
    finish(Response.json(payload()));
    await manual;
    assert.equal(getBranchQueryState(slug).quote.completedAt, fresh.completedAt);
    assert.equal(getBranchQueryState(slug).quote.controlVersion, fresh.controlVersion);
  });
}

test('duplicate clicks share a request; cards and popups use only that branch’s rates and time', async t => {
  harness(t);
  let finish;
  const fetch = t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.equal(url, BRANCH_QUERY_API);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { slug });
    return new Promise(resolve => { finish = resolve; });
  });
  const first = queryOrangeBranch(slug);
  assert.equal(queryOrangeBranch(slug), first);
  await Promise.resolve();
  assert.equal(fetch.mock.callCount(), 1);
  assert.match(renderExchangeRates(row), /data-orange-query="[^"]+" disabled/);
  finish(Response.json(payload()));
  await first;
  assert.equal(getExchangeRateCell1965(slug, 'USD_1965').rateScaledE6, 32_770_000);
  assert.equal(getExchangeRateCell1965(otherSlug, 'USD_1965'), null);
  assert.equal(isExchangeSortAvailable('USD_1965'), true);
  state.exchangeSort = 'USD_1965';
  for (const html of [renderExchangeRates(row), buildPopupContent(0)]) {
    assert.match(html, /32\.77 THB/);
    assert.match(html, /0\.99500 THB/);
    assert.match(html, /fx-best/);
    assert.match(html, /class="fx-checked"/);
    assert.match(html, /只比較已取得有效報價/);
  }
  await queryOrangeBranch(slug);
  assert.equal(fetch.mock.callCount(), 1);
});

for (const provider of ['google', 'here']) {
  test(`${provider} popup loses expired manual quotes without touching green rates or fetching again`, async t => {
    const { listeners } = harness(t, () => refreshActivePopup());
    let html = '';
    const popup = { setContent: value => { html = value; } };
    Object.assign(state, { provider, activeIdx: 0, map: null,
      infoWindow: provider === 'google' ? popup : null, infoBubble: provider === 'here' ? popup : null,
      exchangeRatesBySlug: { green: { rates: { USD_100: { rateScaledE6: 33_000_000 } } } }, exchangeHasUsableSnapshot: true });
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(payload()));
    await queryOrangeBranch(slug);
    state.exchangeSort = 'USD_1965';
    refreshActivePopup();
    assert.match(html, /32\.77 THB/);
    // A suspended browser's render guard rejects old data even before timers run.
    t.mock.timers.setTime(START + BRANCH_QUOTE_TTL_MS + 1);
    assert.equal(getExchangeRateCell1965(slug, 'USD_1965'), null);
    listeners.visibilitychange.fn();
    assert.doesNotMatch(html, /32\.77 THB|fx-best|class="fx-checked"/);
    assert.equal(state.exchangeSort, 'default');
    assert.equal(state.exchangeHasUsableSnapshot, true);
    assert.equal(state.exchangeRatesBySlug.green.rates.USD_100.rateScaledE6, 33_000_000);
    assert.equal(fetch.mock.callCount(), 1);
    assert.match(html, /data-orange-query="[^"]+">/);
  });
}

for (const reason of ['busy', 'cooldown', 'disabled', 'unavailable']) {
  test(`${reason} disables repeat clicks until retry time, then permits a manual retry only`, async t => {
    harness(t);
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(payload(slug, {
      quote: null, reason, retryAfterSeconds: 2, enabled: reason === 'disabled' ? false : true,
    }), { status: reason === 'busy' ? 202 : 503 }));
    await queryOrangeBranch(slug);
    assert.equal(getBranchQueryState(slug).reason, reason);
    assert.equal(isExchangeSortAvailable('USD_1965'), false);
    await queryOrangeBranch(slug);
    assert.equal(fetch.mock.callCount(), 1);
    t.mock.timers.tick(2_000);
    assert.equal(fetch.mock.callCount(), 1);
    await queryOrangeBranch(slug);
    assert.equal(fetch.mock.callCount(), 2);
  });
}

test('client response validation rejects swapped identities, wrong control, stale and inflated quote lifetimes', t => {
  harness(t);
  for (const mutate of [
    p => { p.quote.branch.branchNo = '99'; }, p => { p.quote.slug = otherSlug; },
    p => { p.quote.controlVersion = uuid(2); }, p => { p.enabled = false; },
    p => { p.quote.expiresAt = p.checkedAt; },
    p => { p.quote.expiresAt = new Date(START + BRANCH_QUOTE_TTL_MS + 1).toISOString(); },
    p => { p.quote.branch.rates.TWD_1965.rateScaledE6 = 0; },
    p => { p.retryAfterSeconds = -1; }, p => { p.reason = 'raw-upstream-detail'; },
  ]) {
    const value = payload(); mutate(value);
    assert.equal(parseBranchQueryPayload(value, slug), null);
  }
  const input = payload(); input.quote.branch.cookie = 'untrusted';
  assert.equal(parseBranchQueryPayload(input, slug).quote.branch.cookie, undefined);
});

test('invalid/network responses expose no rates and never automatically retry', async t => {
  harness(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('invalid JSON'));
  await queryOrangeBranch(slug);
  assert.equal(getBranchQueryState(slug).quote, null);
  assert.equal(getBranchQueryState(slug).loading, false);
  t.mock.timers.tick(60_000);
  assert.equal(fetch.mock.callCount(), 1);
});

test('newer disable invalidates other quotes and a delayed older response cannot restore them', async t => {
  harness(t);
  let finishOld;
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const target = JSON.parse(options.body).slug;
    if (target === slug) return new Promise(resolve => { finishOld = resolve; });
    return Response.json(payload(target, { enabled: false, quote: null, reason: 'disabled', controlVersion: uuid(2),
      checkedAt: new Date(START + 1000).toISOString(), retryAfterSeconds: 60 }));
  });
  const old = queryOrangeBranch(slug);
  await Promise.resolve();
  await queryOrangeBranch(otherSlug);
  finishOld(Response.json(payload()));
  await old;
  assert.equal(state.exchange1965BranchControlVersion, uuid(2));
  assert.equal(getBranchQueryState(slug).quote, null);
  assert.equal(fetch.mock.callCount(), 2);
});

test('orange sorting puts quoted branches first without inventing rates for unqueried branches', async t => {
  harness(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json(payload()));
  await queryOrangeBranch(slug);
  state.data = [{ ...row, id: otherSlug }, row, { ...row, id: 'regular' }];
  state.visIdx = [0, 1, 2];
  assert.deepEqual(sortVisibleIndexes(state.visIdx, 'USD_1965'), [1, 0, 2]);
  for (const key of ['fx_query', 'fx_query_loading', 'fx_query_cached', 'fx_query_hint', 'fx_query_wait', 'fx_query_busy', 'fx_query_disabled', 'fx_query_failed', 'fx_query_sort_scope']) {
    assert.equal(typeof T.zh[key], 'string');
    assert.equal(typeof T.en[key], 'string');
  }
});
