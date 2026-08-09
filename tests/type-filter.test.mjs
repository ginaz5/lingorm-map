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
    assert.match(typeFilter.innerHTML, /<option value="">所有主題<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="LingOrm">LingOrm（2）<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="JKR Picks">JKR 推薦（1）<\/option>/);
    assert.match(typeFilter.innerHTML, /<option value="Admin Picks">留友看（1）<\/option>/);
    assert.doesNotMatch(typeFilter.innerHTML, /JKR Fan Projects|JKR 應援/);

    setLang('en');
    buildTypeFilter();
    assert.equal(typeFilter.value, 'JKR Picks');
    assert.match(typeFilter.innerHTML, /<option value="">All themes<\/option>/);
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
    assert.match(list.innerHTML, /<span class="badge b-type">JKR 應援<\/span>/);
    assert.equal(list.innerHTML.match(/class="badge b-type"/g)?.length, 1);

    setLang('en');
    renderList();
    assert.match(list.innerHTML, /<span class="badge b-cat">Cafe<\/span>/);
    assert.match(list.innerHTML, /<span class="badge b-type">JKR Fan Projects<\/span>/);
    assert.equal(list.innerHTML.match(/class="badge b-type"/g)?.length, 1);
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

test('public filter controls are ordered category, theme, then destination', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const categoryIndex = html.indexOf('id="cat-filter"');
  const themeIndex = html.indexOf('id="type-filter"');
  const destinationIndex = html.indexOf('id="dest-filter-btn"');

  assert.ok(categoryIndex >= 0);
  assert.ok(themeIndex > categoryIndex);
  assert.ok(destinationIndex > themeIndex);
});

test('filter layout uses content-aware widths so selected labels are not clipped', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.panel\{width:400px;min-width:340px;/);
  assert.match(css, /\.filter-row\{display:flex;gap:8px;flex-wrap:wrap\}/);
  assert.match(
    css,
    /#cat-filter,#type-filter\{flex:1 1 calc\(50% - 4px\);min-width:max-content;max-width:100%\}/,
  );
  assert.match(
    css,
    /\.destination-filter\{position:relative;flex:1 1 calc\(100% - 48px\);min-width:0\}/,
  );
  assert.doesNotMatch(css, /#type-filter\{flex:0 0 70px\}/);
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

test('narrow mobile filters can give category and Type their own rows', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /@media\(max-width:700px\)\{[\s\S]*?\.panel\{width:100%;min-width:0;/,
  );
  assert.match(
    css,
    /@media\(max-width:340px\)\{\s*#cat-filter,#type-filter\{flex-basis:100%\}/,
  );
});
