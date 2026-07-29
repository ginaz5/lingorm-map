import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { setLang } from '../src/core/i18n.js';
import { state } from '../src/core/state.js';
import {
  LOCATION_TYPES,
  locationTypeLabel,
} from '../src/data/location-types.js';
import {
  applyFilters,
  buildPopupContent,
  buildTypeFilter,
} from '../src/ui/render.js';

function makeLocation(overrides = {}) {
  return {
    id: 'location',
    nameEn: 'Location',
    nameZh: '地點',
    alt: '',
    notesEn: '',
    notesZh: '',
    catEn: 'Cafe',
    catZh: '咖啡廳',
    icon: '☕',
    status: 'Published',
    lat: '13.7',
    lng: '100.5',
    maps: '',
    src: '',
    sourceUrl: '',
    approx: '',
    countryCode: 'TH',
    destinationKey: 'bangkok',
    type: 'LingOrm',
    ...overrides,
  };
}

function installGlobals(elements) {
  const previousDocument = globalThis.document;
  const previousLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );
  globalThis.document = {
    getElementById: id => elements[id] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {},
    },
  });

  return () => {
    setLang('zh');
    globalThis.document = previousDocument;
    if (previousLocalStorageDescriptor) {
      Object.defineProperty(
        globalThis,
        'localStorage',
        previousLocalStorageDescriptor,
      );
    } else {
      delete globalThis.localStorage;
    }
    state.data = [];
    state.visIdx = [];
    state.isLoading = true;
    state.favorites = new Set();
    state.favFilterOn = false;
    state.selectedDestinations = new Set();
  };
}

test('location Type labels use the requested Chinese copy and raw English values', () => {
  assert.deepEqual(LOCATION_TYPES, [
    'LingOrm',
    'JKR Picks',
    'JKR Fan Projects',
    'Admin Picks',
  ]);
  assert.deepEqual(
    LOCATION_TYPES.map(type => locationTypeLabel(type, 'zh')),
    ['LingOrm', 'JKR 推薦', 'JKR 應援', '留友看'],
  );
  assert.deepEqual(
    LOCATION_TYPES.map(type => locationTypeLabel(type, 'en')),
    LOCATION_TYPES,
  );
});

test('buildTypeFilter localizes labels, preserves values, and hides unavailable Types', () => {
  const typeFilter = { value: 'JKR Picks', innerHTML: '' };
  const restore = installGlobals({ 'type-filter': typeFilter });

  try {
    state.data = [
      makeLocation({ type: 'LingOrm' }),
      makeLocation({ id: 'jkr', type: 'JKR Picks' }),
      makeLocation({ id: 'admin', type: 'Admin Picks' }),
      makeLocation({
        id: 'hidden-fan-project',
        type: 'JKR Fan Projects',
        status: 'Paused',
      }),
    ];

    buildTypeFilter();
    assert.equal(typeFilter.value, 'JKR Picks');
    assert.match(typeFilter.innerHTML, /<option value="">主題<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="LingOrm">LingOrm<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="JKR Picks">JKR 推薦<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="Admin Picks">留友看<\/option>/);
    assert.doesNotMatch(typeFilter.innerHTML, /JKR Fan Projects|JKR 應援/);

    setLang('en');
    buildTypeFilter();
    assert.equal(typeFilter.value, 'JKR Picks');
    assert.match(typeFilter.innerHTML, /<option value="">Type<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="JKR Picks">JKR Picks<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="Admin Picks">Admin Picks<\/option>/);
  } finally {
    restore();
  }
});

test('theme combines with category and destination filters using AND', () => {
  const elements = {
    search: { value: '' },
    'cat-filter': { value: '咖啡廳' },
    'type-filter': { value: 'JKR Picks' },
    'loc-list': { innerHTML: '' },
    'result-info': { textContent: '' },
  };
  const restore = installGlobals(elements);

  try {
    state.isLoading = false;
    state.data = [
      makeLocation({ id: 'match', type: 'JKR Picks' }),
      makeLocation({ id: 'wrong-type', type: 'LingOrm' }),
      makeLocation({
        id: 'wrong-category',
        type: 'JKR Picks',
        catEn: 'Restaurant',
        catZh: '餐廳',
      }),
      makeLocation({
        id: 'wrong-destination',
        type: 'JKR Picks',
        destinationKey: 'koh-samui',
      }),
    ];
    state.selectedDestinations = new Set(['bangkok']);

    applyFilters();

    assert.deepEqual(state.visIdx, [0]);
  } finally {
    restore();
  }
});

test('map popup adds the localized Type badge and omits it when Type is blank', () => {
  const restore = installGlobals({});

  try {
    state.data = [
      makeLocation({ type: 'JKR Picks' }),
      makeLocation({ id: 'blank-type', type: '' }),
    ];

    const zhPopup = buildPopupContent(0);
    assert.match(zhPopup, /<span class="badge b-cat">咖啡廳<\/span>/);
    assert.match(zhPopup, /<span class="badge b-type">JKR 推薦<\/span>/);

    setLang('en');
    const enPopup = buildPopupContent(0);
    assert.match(enPopup, /<span class="badge b-cat">Cafe<\/span>/);
    assert.match(enPopup, /<span class="badge b-type">JKR Picks<\/span>/);

    assert.doesNotMatch(buildPopupContent(1), /b-type/);
  } finally {
    restore();
  }
});

test('public filter controls are ordered category, theme, then destination', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const categoryIndex = html.indexOf('id="cat-filter"');
  const themeIndex = html.indexOf('id="type-filter"');
  const destinationIndex = html.indexOf('id="dest-filter-btn"');

  assert.ok(categoryIndex >= 0);
  assert.ok(themeIndex > categoryIndex);
  assert.ok(destinationIndex > themeIndex);
});

test('desktop panel is wider and gives the longer category filter more space', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.panel\{width:400px;min-width:340px;/);
  assert.match(css, /#cat-filter\{flex:1\.3\}/);
  assert.match(css, /#type-filter\{flex:\.75\}/);
});
