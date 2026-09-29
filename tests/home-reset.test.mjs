import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { initHomeReset } from '../src/features/home-reset.js';

function makeElement(documentRoot, tagName = 'div') {
  return Object.assign(new EventTarget(), {
    tagName,
    value: '',
    scrollTop: 0,
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name); },
    focus() { documentRoot.activeElement = this; },
  });
}

function makeDocument(ids) {
  const elements = new Map();
  const documentRoot = {
    activeElement: null,
    getElementById: id => elements.get(id) ?? null,
    createElement: tagName => makeElement(documentRoot, tagName),
  };
  for (const id of ids) elements.set(id, documentRoot.createElement());
  return { documentRoot, elements };
}

const HOME_IDS = ['home-btn', 'search', 'loc-list'];

/** Record every dependency call in one ordered log so sequence is assertable. */
function makeDeps(calls) {
  return {
    clearFilters: () => calls.push('clearFilters'),
    setFavoritesFilter: on => calls.push(`setFavoritesFilter:${on}`),
    clearActiveLocation: () => calls.push('clearActiveLocation'),
    switchTab: tab => calls.push(`switchTab:${tab}`),
    applyFilters: () => calls.push('applyFilters'),
  };
}

test('clicking the header title clears search, filters, favorites, and selection', () => {
  const { documentRoot, elements } = makeDocument(HOME_IDS);
  const search = elements.get('search');
  const list = elements.get('loc-list');
  search.value = 'siam';
  list.scrollTop = 840;
  /** @type {string[]} */
  const calls = [];

  initHomeReset({ documentRoot, ...makeDeps(calls) });
  elements.get('home-btn').dispatchEvent(new Event('click'));

  assert.equal(search.value, '');
  assert.equal(list.scrollTop, 0);
  assert.deepEqual(calls, [
    'clearFilters',
    'setFavoritesFilter:false',
    'clearActiveLocation',
    'switchTab:list',
    'applyFilters',
  ]);
});

test('the reset rebuilds once, after every filter has been cleared', () => {
  const { documentRoot, elements } = makeDocument(HOME_IDS);
  /** @type {string[]} */
  const calls = [];

  initHomeReset({ documentRoot, ...makeDeps(calls) });
  elements.get('home-btn').dispatchEvent(new Event('click'));

  assert.equal(calls.filter(call => call === 'applyFilters').length, 1);
  assert.equal(calls.at(-1), 'applyFilters');
});

test('repeated clicks stay idempotent', () => {
  const { documentRoot, elements } = makeDocument(HOME_IDS);
  const search = elements.get('search');
  /** @type {string[]} */
  const calls = [];

  initHomeReset({ documentRoot, ...makeDeps(calls) });
  elements.get('home-btn').dispatchEvent(new Event('click'));
  search.value = 'again';
  elements.get('home-btn').dispatchEvent(new Event('click'));

  assert.equal(search.value, '');
  assert.equal(calls.filter(call => call === 'switchTab:list').length, 2);
});

test('missing header or list elements never throw', () => {
  const { documentRoot, elements } = makeDocument(['home-btn']);
  /** @type {string[]} */
  const calls = [];

  assert.doesNotThrow(() => initHomeReset({ documentRoot, ...makeDeps(calls) }));
  assert.doesNotThrow(() => elements.get('home-btn').dispatchEvent(new Event('click')));
  assert.deepEqual(calls, [
    'clearFilters',
    'setFavoritesFilter:false',
    'clearActiveLocation',
    'switchTab:list',
    'applyFilters',
  ]);
});

test('a page without the header button wires nothing', () => {
  const { documentRoot } = makeDocument([]);
  /** @type {string[]} */
  const calls = [];

  assert.equal(initHomeReset({ documentRoot, ...makeDeps(calls) }), null);
  assert.deepEqual(calls, []);
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
  // Bilingual contract: both dictionaries carry the accessible name.
  assert.equal(i18n.match(/home_btn_label:/g)?.length, 2);
});
