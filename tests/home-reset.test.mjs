import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { initHomeReset } from '../src/features/home-reset.js';

function makeDocument(ids) {
  const elements = new Map(ids.map(id => [id, new EventTarget()]));
  return { documentRoot: { getElementById: id => elements.get(id) ?? null }, elements };
}

/** Record every dependency call in one ordered log so sequence is assertable. */
function makeDeps(calls) {
  return {
    clearSearch: () => calls.push('clearSearch'),
    clearFilters: () => calls.push('clearFilters'),
    clearActiveLocation: () => calls.push('clearActiveLocation'),
    showListFromTop: () => calls.push('showListFromTop'),
    applyFilters: () => calls.push('applyFilters'),
    trackReset: () => calls.push('trackReset'),
  };
}

const RESET_SEQUENCE = [
  'clearSearch',
  'clearFilters',
  'clearActiveLocation',
  'showListFromTop',
  'applyFilters',
  'trackReset',
];

test('clicking the header title clears search, filters, and selection, then rebuilds', () => {
  const { documentRoot, elements } = makeDocument(['home-btn']);
  /** @type {string[]} */
  const calls = [];

  initHomeReset({ documentRoot, ...makeDeps(calls) });
  elements.get('home-btn').dispatchEvent(new Event('click'));

  assert.deepEqual(calls, RESET_SEQUENCE);
});

test('the reset rebuilds once and reports once, after every clear', () => {
  const { documentRoot, elements } = makeDocument(['home-btn']);
  /** @type {string[]} */
  const calls = [];

  initHomeReset({ documentRoot, ...makeDeps(calls) });
  elements.get('home-btn').dispatchEvent(new Event('click'));

  assert.equal(calls.filter(call => call === 'applyFilters').length, 1);
  assert.equal(calls.filter(call => call === 'trackReset').length, 1);
  assert.deepEqual(calls.slice(-2), ['applyFilters', 'trackReset']);
});

test('repeated clicks run the full reset each time', () => {
  const { documentRoot, elements } = makeDocument(['home-btn']);
  /** @type {string[]} */
  const calls = [];

  initHomeReset({ documentRoot, ...makeDeps(calls) });
  elements.get('home-btn').dispatchEvent(new Event('click'));
  elements.get('home-btn').dispatchEvent(new Event('click'));

  assert.deepEqual(calls, [...RESET_SEQUENCE, ...RESET_SEQUENCE]);
});

test('a page without the header button wires nothing', () => {
  const { documentRoot } = makeDocument([]);
  /** @type {string[]} */
  const calls = [];

  assert.equal(initHomeReset({ documentRoot, ...makeDeps(calls) }), null);
  assert.deepEqual(calls, []);
});

test('main wires silent clears, one fitted rebuild, and a single home_reset event', async () => {
  const [main, analytics] = await Promise.all([
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/analytics.js', import.meta.url), 'utf8'),
  ]);
  const silentClear = main.match(/function clearAllFiltersSilently\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';

  // Every clear inside the reset is silent, so it neither rebuilds nor tracks.
  assert.match(silentClear, /clearSelectFilter\('category', silent\)/);
  assert.match(silentClear, /clearSelectFilter\('type', silent\)/);
  assert.match(silentClear, /clearDestinationFilter\(undefined, silent\)/);
  assert.match(silentClear, /setFavoritesFilter\(false, silent\)/);
  assert.match(silentClear, /state\.exchangeSort = 'default'/);
  assert.match(main, /clearFilters: clearAllFiltersSilently/);
  // The map returns to the default view even when no destination was set.
  assert.match(main, /applyFilters: \(\) => applyFiltersAndSyncMap\(\{ fitMap: true \}\)/);
  assert.match(main, /trackReset: \(\) => trackHomeReset\(state\.visIdx\.length\)/);
  assert.match(analytics, /trackEvent\('home_reset'/);
  // Clearing search cancels the debounced search_complete event.
  const clearSearch = main.match(/function clearSearch\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(clearSearch, /clearTimeout\(searchAnalyticsTimer\)/);
});

test('the map header title is a labelled button wired to the reset', async () => {
  const [html, main, i18n] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/core/i18n.js', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /<button[^>]*id="home-btn"[^>]*class="logo cal-sans"/);
  assert.match(html, /id="home-btn"[^>]*data-i18n-aria="home_btn_label"/);
  assert.doesNotMatch(html, /<span class="logo cal-sans">/);
  assert.match(main, /initHomeReset\(/);
  // Bilingual contract: both dictionaries carry the accessible name, and each
  // starts with the visible text so voice control can target it (WCAG 2.5.3).
  assert.equal(i18n.match(/home_btn_label: 'LingOrm Map/g)?.length, 2);
});
