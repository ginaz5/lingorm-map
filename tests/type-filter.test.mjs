import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import BRANCH_MAPPING from '../data/superrich-branches.json' with { type: 'json' };
import { setLang } from '../src/core/i18n.js';
import { state } from '../src/core/state.js';
import {
  LOCATION_TYPES,
  locationTypeLabel,
} from '../src/data/location-types.js';
import {
  applyFilters,
  buildPlaceDetailContent,
  buildTypeFilter,
  renderList,
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
    'Currency Exchange',
  ]);
  assert.deepEqual(
    LOCATION_TYPES.map(type => locationTypeLabel(type, 'zh')),
    ['LingOrm', 'JKR 推薦', 'JKR 應援', '留友看', '換匯'],
  );
  assert.deepEqual(
    LOCATION_TYPES.map(type => locationTypeLabel(type, 'en')),
    LOCATION_TYPES,
  );
});

test('buildTypeFilter localizes labels, preserves values, and hides unavailable Types', () => {
  const typeFilter = { value: 'JKR Picks', innerHTML: '' };
  const restore = installGlobals({ 'label-filter': typeFilter });

  try {
    state.data = [
      makeLocation({ type: 'LingOrm' }),
      makeLocation({ id: 'lingorm-2', type: 'LingOrm' }),
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
    assert.match(typeFilter.innerHTML, /<option value="">所有標籤<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="LingOrm">LingOrm（2）<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="JKR Picks">JKR 推薦（1）<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="Admin Picks">留友看（1）<\/option>/);
    assert.doesNotMatch(typeFilter.innerHTML, /JKR Fan Projects|JKR 應援/);

    setLang('en');
    buildTypeFilter();
    assert.equal(typeFilter.value, 'JKR Picks');
    assert.match(typeFilter.innerHTML, /<option value="">All label<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="JKR Picks">JKR Picks \(1\)<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="Admin Picks">Admin Picks \(1\)<\/option>/);
  } finally {
    restore();
  }
});

test('theme combines with category and destination filters using AND', () => {
  const elements = {
    search: { value: '' },
    'cat-filter': { value: '咖啡廳' },
    'label-filter': { value: 'JKR Picks' },
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

    const zhPopup = buildPlaceDetailContent(0);
    assert.match(zhPopup, /<span class="badge b-cat">咖啡廳<\/span>/);
    assert.match(zhPopup, /<span class="badge b-label">JKR 推薦<\/span>/);

    setLang('en');
    const enPopup = buildPlaceDetailContent(0);
    assert.match(enPopup, /<span class="badge b-cat">Cafe<\/span>/);
    assert.match(enPopup, /<span class="badge b-label">JKR Picks<\/span>/);

    assert.doesNotMatch(buildPlaceDetailContent(1), /b-label/);
  } finally {
    restore();
  }
});

test('exchange locations have no Category badge and carry the green styling on the label badge instead', () => {
  const restore = installGlobals({});
  const exchangeSlug = Object.keys(BRANCH_MAPPING.branches)[0];

  try {
    state.data = [
      makeLocation({ id: exchangeSlug, catEn: '', catZh: '', type: 'Currency Exchange' }),
    ];

    const zhPopup = buildPlaceDetailContent(0);
    assert.doesNotMatch(zhPopup, /badge b-cat/);
    assert.match(zhPopup, /<span class="badge b-exchange">換匯<\/span>/);

    setLang('en');
    const enPopup = buildPlaceDetailContent(0);
    assert.doesNotMatch(enPopup, /badge b-cat/);
    assert.match(enPopup, /<span class="badge b-exchange">Currency Exchange<\/span>/);
  } finally {
    restore();
  }
});

test('location list adds the localized Type badge and omits it when Type is blank', () => {
  const list = { innerHTML: '' };
  const restore = installGlobals({ 'loc-list': list });

  try {
    state.isLoading = false;
    state.data = [
      makeLocation({ type: 'JKR Fan Projects' }),
      makeLocation({ id: 'blank-type', type: '' }),
    ];
    state.visIdx = [0, 1];

    renderList();
    assert.match(list.innerHTML, /<span class="badge b-cat">咖啡廳<\/span>/);
    assert.match(list.innerHTML, /<span class="badge b-label">JKR 應援<\/span>/);
    assert.equal(list.innerHTML.match(/class="badge b-label"/g)?.length, 1);

    setLang('en');
    renderList();
    assert.match(list.innerHTML, /<span class="badge b-cat">Cafe<\/span>/);
    assert.match(list.innerHTML, /<span class="badge b-label">JKR Fan Projects<\/span>/);
    assert.equal(list.innerHTML.match(/class="badge b-label"/g)?.length, 1);
  } finally {
    restore();
  }
});

test('location list reuses popup actions without triggering its parent card', () => {
  const list = { innerHTML: '' };
  const restore = installGlobals({ 'loc-list': list });

  try {
    state.isLoading = false;
    state.data = [
      makeLocation(),
      makeLocation({ id: 'no-coordinates', lat: '', lng: '' }),
    ];
    state.visIdx = [0, 1];

    renderList();

    assert.equal(list.innerHTML.match(/class="popup-actions"/g)?.length, 2);
    assert.equal(list.innerHTML.match(/class="fav-btn/g)?.length, 2);
    assert.match(
      list.innerHTML,
      /onclick="event\.stopPropagation\(\);openNavigation\(0, 'list_card'\)"/,
    );
    assert.match(
      list.innerHTML,
      /onclick="event\.stopPropagation\(\);openInGoogleMaps\(0, 'list_card'\)"/,
    );
    assert.doesNotMatch(list.innerHTML, /openNavigation\(1\)|openInGoogleMaps\(1\)/);
  } finally {
    restore();
  }
});

test('public filter controls are ordered category, label, then destination', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const categoryIndex = html.indexOf('id="cat-filter"');
  const themeIndex = html.indexOf('id="label-filter"');
  const destinationIndex = html.indexOf('id="dest-filter-btn"');

  assert.ok(categoryIndex >= 0);
  assert.ok(themeIndex > categoryIndex);
  assert.ok(destinationIndex > themeIndex);
});

test('the filter sheet stacks full-width controls so selected labels are not clipped', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.filter-row\{display:flex;flex-direction:column;gap:16px\}/);
  assert.match(css, /#cat-filter,\.label-filter\{width:100%;min-width:0\}/);
  assert.match(css, /\.destination-filter\{position:relative;min-width:0\}/);
  assert.match(css, /\.filter-field-label\{font-size:13px;font-weight:600/);
  assert.doesNotMatch(css, /#label-filter\{flex:0 0 70px\}/);
});

test('filter sheet controls share a 44px touch height and 16px text', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.filter-sel\{[^}]*height:44px/);
  assert.match(css, /\.filter-sel\{[^}]*font-size:16px/);
  assert.match(css, /\.label-info-btn\{[^}]*height:44px/);
  assert.match(css, /\.dest-filter-btn\{[^}]*height:44px/);
  assert.match(css, /\.dest-option\{min-height:44px;/);
});

test('search box and select filters keep visible hover and focus states', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.search-bar:focus-within\{box-shadow:var\(--float-shadow-strong\)\}/);
  assert.match(css, /\.search-input\{[^}]*font-size:16px/);
  assert.match(css, /\.filter-sel:hover\{border-color:var\(--primary\)\}/);
  assert.match(css, /\.dest-filter-btn:hover\{border-color:var\(--primary\)\}/);
});

test('all three public filters use the same dropdown arrow geometry', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  const arrowPath = 'm7 10 5 5 5-5z';
  assert.match(html, new RegExp(`<path d="${arrowPath}"`));
  assert.match(css, new RegExp(`d='${arrowPath}'`, 'g'));
  assert.match(css, /appearance:none;-webkit-appearance:none;/);
  assert.match(css, /background-position:right 8px center;background-size:16px;/);
  assert.match(css, /\.dest-filter-btn svg\{width:16px;height:16px;fill:var\(--muted\);/);
});

test('filter chips and the filter sheet use the shared mobile breakpoint', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.chip\.is-selected\{background:var\(--primary\);border-color:var\(--primary\);color:var\(--canvas\)\}/);
  assert.match(
    css,
    /@media\(max-width:700px\)\{\s*\.filter-sheet\{position:fixed;inset:auto 0 0;width:100%;margin:0;/,
  );
});
