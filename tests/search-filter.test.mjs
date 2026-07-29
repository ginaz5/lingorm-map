import assert from 'node:assert/strict';
import test from 'node:test';

import { setLang } from '../src/core/i18n.js';
import { buildMarkers, syncVisibleMarkers } from '../src/map/map.js';
import { applyFilters } from '../src/ui/render.js';
import { state } from '../src/core/state.js';

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
    src: '',
    sourceUrl: '',
    approx: '',
    countryCode: 'TH',
    destinationKey: 'bangkok',
    type: 'LingOrm',
    ...overrides,
  };
}

function installBrowserState() {
  const elements = {
    search: { value: '' },
    'cat-filter': { value: '' },
    'type-filter': { value: '' },
    'loc-list': { innerHTML: '' },
    'result-info': { textContent: '' },
  };
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
  return {
    elements,
    restore() {
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
      state.map = null;
      state.provider = null;
      state.markers = [];
      state.markerClusterer = null;
      state.favorites = new Set();
      state.favFilterOn = false;
      state.selectedDestinations = new Set();
      state.pendingDestinationFit = false;
    },
  };
}

test('search matches names, aliases, and notes in either language', () => {
  const browser = installBrowserState();

  try {
    state.isLoading = false;
    state.data = [
      makeLocation({
        id: 'target',
        nameEn: 'English Name',
        nameZh: '中文名稱',
        alt: 'ชื่อไทย',
        notesEn: 'Ling ordered coconut chocolate',
        notesZh: 'Orm 喝了香蕉口味',
      }),
      makeLocation({
        id: 'other',
        nameEn: 'Other Place',
        nameZh: '其他地點',
      }),
    ];

    for (const query of [
      'english name',
      '中文名稱',
      'ชื่อไทย',
      'COCONUT',
      '香蕉口味',
    ]) {
      browser.elements.search.value = query;
      applyFilters();
      assert.deepEqual(state.visIdx, [0], `expected "${query}" to match the target`);
    }

    setLang('en');
    browser.elements.search.value = '香蕉口味';
    applyFilters();
    assert.deepEqual(state.visIdx, [0], 'English UI should still search Chinese notes');

    setLang('zh');
    browser.elements.search.value = 'coconut';
    applyFilters();
    assert.deepEqual(state.visIdx, [0], 'Chinese UI should still search English notes');

    browser.elements.search.value = 'not present';
    applyFilters();
    assert.deepEqual(state.visIdx, []);
  } finally {
    browser.restore();
  }
});

test('notes search combines with category, favorites, and public status', () => {
  const browser = installBrowserState();

  try {
    state.isLoading = false;
    state.data = [
      makeLocation({
        id: 'favorite-cafe',
        nameEn: 'First',
        nameZh: '第一間',
        notesZh: '共同關鍵字',
      }),
      makeLocation({
        id: 'other-cafe',
        nameEn: 'Second',
        nameZh: '第二間',
        notesZh: '共同關鍵字',
      }),
      makeLocation({
        id: 'restaurant',
        nameEn: 'Third',
        nameZh: '第三間',
        notesZh: '共同關鍵字',
        catEn: 'Restaurant',
        catZh: '餐廳',
      }),
      makeLocation({
        id: 'draft-cafe',
        nameEn: 'Draft',
        nameZh: '草稿',
        notesZh: '共同關鍵字',
        status: 'Draft',
      }),
    ];
    browser.elements.search.value = '共同關鍵字';
    browser.elements['cat-filter'].value = '咖啡廳';

    applyFilters();
    assert.deepEqual(state.visIdx, [0, 1]);

    state.favFilterOn = true;
    state.favorites = new Set(['favorite-cafe', 'draft-cafe']);
    applyFilters();
    assert.deepEqual(state.visIdx, [0]);
  } finally {
    browser.restore();
  }
});

test('multiple destinations use OR and combine with category using AND', () => {
  const browser = installBrowserState();

  try {
    state.isLoading = false;
    state.data = [
      makeLocation({ id: 'bangkok-cafe', destinationKey: 'bangkok' }),
      makeLocation({
        id: 'samui-cafe',
        destinationKey: 'koh-samui',
      }),
      makeLocation({
        id: 'hcmc-restaurant',
        countryCode: 'VN',
        destinationKey: 'ho-chi-minh-city',
        catEn: 'Restaurant',
        catZh: '餐廳',
      }),
    ];
    state.selectedDestinations = new Set(['bangkok', 'ho-chi-minh-city']);

    applyFilters();
    assert.deepEqual(state.visIdx, [0, 2]);

    browser.elements['cat-filter'].value = '咖啡廳';
    applyFilters();
    assert.deepEqual(state.visIdx, [0]);

    state.selectedDestinations.clear();
    applyFilters();
    assert.deepEqual(state.visIdx, [0, 1]);
  } finally {
    browser.restore();
  }
});

test('Google MarkerClusterer uses the same notes search results as the list', () => {
  const browser = installBrowserState();

  try {
    const targetMarker = { id: 'target-marker' };
    const otherMarker = { id: 'other-marker' };
    const added = [];
    const removed = [];

    state.isLoading = false;
    state.data = [
      makeLocation({
        id: 'target',
        nameEn: 'Target',
        nameZh: '目標',
        notesEn: 'coconut chocolate',
      }),
      makeLocation({
        id: 'other',
        nameEn: 'Other',
        nameZh: '其他',
        notesEn: 'banana chocolate',
      }),
    ];
    state.map = { id: 'google-map' };
    state.provider = 'google';
    state.markers = [targetMarker, otherMarker];
    state.markerClusterer = {
      markers: [otherMarker],
      addMarkers: markers => added.push(...markers),
      removeMarkers: markers => removed.push(...markers),
    };
    browser.elements.search.value = 'coconut';

    applyFilters();
    syncVisibleMarkers();

    assert.deepEqual(state.visIdx, [0]);
    assert.deepEqual(added, [targetMarker]);
    assert.deepEqual(removed, [otherMarker]);
  } finally {
    browser.restore();
  }
});

test('Google markers without a cluster use the same notes search results as the list', () => {
  const browser = installBrowserState();

  try {
    const map = { id: 'google-map' };
    const targetMarker = { map };
    const otherMarker = { map };

    state.isLoading = false;
    state.data = [
      makeLocation({
        id: 'target',
        nameEn: 'Target',
        nameZh: '目標',
        notesZh: '椰子巧克力',
      }),
      makeLocation({
        id: 'other',
        nameEn: 'Other',
        nameZh: '其他',
        notesZh: '香蕉巧克力',
      }),
    ];
    state.map = map;
    state.provider = 'google';
    state.markers = [targetMarker, otherMarker];
    browser.elements.search.value = '椰子';

    applyFilters();
    assert.equal(otherMarker.map, map, 'render-only filtering should not mutate map markers');
    syncVisibleMarkers();

    assert.deepEqual(state.visIdx, [0]);
    assert.equal(targetMarker.map, map);
    assert.equal(otherMarker.map, null);
  } finally {
    browser.restore();
  }
});

test('Google marker rebuild seeds the cluster from the current filtered indexes', async () => {
  const browser = installBrowserState();
  const previousGoogle = globalThis.google;
  const clusterBuilds = [];

  class AdvancedMarkerElement {
    constructor(options) {
      this.position = options.position;
      this.content = options.content;
      this.map = null;
    }

    addListener() {}
  }

  class MarkerClusterer {
    constructor(options) {
      this.markers = [...options.markers];
      clusterBuilds.push(this.markers);
    }

    clearMarkers() {
      this.markers = [];
    }
  }

  globalThis.google = {
    maps: {
      marker: { AdvancedMarkerElement },
    },
  };
  globalThis.document.createElement = () => ({
    className: '',
    textContent: '',
    classList: {
      add() {},
      toggle() {},
    },
  });

  try {
    state.isLoading = false;
    state.data = [
      makeLocation({
        id: 'target',
        nameEn: 'Target',
        nameZh: '目標',
        notesEn: 'coconut chocolate',
      }),
      makeLocation({
        id: 'other',
        nameEn: 'Other',
        nameZh: '其他',
        notesEn: 'banana chocolate',
      }),
    ];
    state.map = { id: 'google-map' };
    state.provider = 'google';
    state.visIdx = [0];

    await buildMarkers({ markerClustererCtor: MarkerClusterer });

    assert.ok(state.markers[0]);
    assert.ok(state.markers[1], 'hidden markers remain available for later filters');
    assert.deepEqual(clusterBuilds[0], [state.markers[0]]);

    state.visIdx = [1];
    await buildMarkers({ markerClustererCtor: MarkerClusterer });

    assert.deepEqual(clusterBuilds[1], [state.markers[1]]);
  } finally {
    globalThis.google = previousGoogle;
    browser.restore();
  }
});

test('HERE clustering uses the same notes search results as the list', async () => {
  const browser = installBrowserState();
  const previousHere = globalThis.H;
  const createdDataPoints = [];

  globalThis.H = {
    map: {
      layer: {
        ObjectLayer: class {
          constructor(provider) {
            this.provider = provider;
          }
        },
      },
    },
    clustering: {
      DataPoint: class {
        constructor(lat, lng, weight, data) {
          this.lat = lat;
          this.lng = lng;
          this.weight = weight;
          this.data = data;
          createdDataPoints.push(this);
        }
      },
      Provider: class {
        constructor(dataPoints, options) {
          this.dataPoints = dataPoints;
          this.options = options;
        }

        addEventListener() {}
      },
    },
  };

  try {
    state.isLoading = false;
    state.data = [
      makeLocation({
        id: 'target',
        nameEn: 'Target',
        nameZh: '目標',
        notesZh: '椰子巧克力',
      }),
      makeLocation({
        id: 'other',
        nameEn: 'Other',
        nameZh: '其他',
        notesZh: '香蕉巧克力',
      }),
    ];
    browser.elements.search.value = '椰子';

    applyFilters();
    assert.deepEqual(state.visIdx, [0]);

    state.map = {
      addLayer() {},
      removeLayer() {},
      removeObject() {},
    };
    state.provider = 'here';
    await buildMarkers();

    assert.deepEqual(createdDataPoints.map(point => point.data.index), [0]);
  } finally {
    globalThis.H = previousHere;
    browser.restore();
  }
});
