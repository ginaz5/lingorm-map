import assert from 'node:assert/strict';
import test from 'node:test';

import { state } from '../src/core/state.js';
import { applyFiltersAndSyncMap, showListFromTop } from '../src/app/app-coordinator.js';
import { initHomeReset } from '../src/features/home-reset.js';
import { clearActiveLocation, fitMapToVisibleLocations } from '../src/map/map.js';
import { activateCard } from '../src/ui/render.js';
import { switchTab } from '../src/ui/ui.js';

function makeLocation(id, lat, lng, destinationKey = 'bangkok') {
  return {
    id, lat, lng, destinationKey,
    nameEn: id, nameZh: id, alt: '', notesEn: '', notesZh: '',
    catEn: 'Cafe', catZh: '咖啡廳', icon: '☕', status: 'Published',
    type: 'LingOrm', countryCode: 'TH', src: '', sourceUrl: '', approx: '',
  };
}

function makeElement() {
  const element = new EventTarget();
  const attributes = new Map();
  return Object.assign(element, {
    value: '', innerHTML: '', textContent: '', scrollTop: 250,
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name) ?? null,
    classList: { toggle() {}, remove() {}, add() {} },
  });
}

/** Model the mobile CSS: a list tab has no map dimensions below 701px. */
function withMapFixture(provider, { tab = 'map', width = 390 } = {}, run) {
  const globals = {
    document: globalThis.document,
    window: globalThis.window,
    google: globalThis.google,
    H: globalThis.H,
  };
  const originalState = { ...state };
  const elements = Object.fromEntries([
    'home-btn', 'panel', 'map-wrap', 'tab-map', 'tab-list',
    'search', 'cat-filter', 'label-filter', 'loc-list', 'result-info',
  ].map(id => [id, makeElement()]));
  elements['map-wrap'].setAttribute('data-mobile-tab', tab);
  elements.panel.setAttribute('data-mobile-tab', tab);
  globalThis.window = { innerWidth: width };
  const mapElement = {
    get clientWidth() {
      return window.innerWidth <= 700 && elements['map-wrap'].getAttribute('data-mobile-tab') === 'list'
        ? 0 : 600;
    },
    get clientHeight() { return this.clientWidth ? 500 : 0; },
  };
  globalThis.document = {
    getElementById: id => id === 'map' ? mapElement : elements[id] ?? null,
    querySelectorAll: () => [],
  };

  const calls = [];
  function assertVisible() {
    assert.ok(mapElement.clientWidth > 0 && mapElement.clientHeight > 0,
      'the SDK fit must run only after the map has visible dimensions');
  }
  const map = {
    fitBounds(bounds, padding) {
      assertVisible();
      calls.push({ type: 'fit', bounds, padding });
    },
    setCenter(center) { assertVisible(); calls.push({ type: 'center', center }); },
    setZoom(zoom) { assertVisible(); calls.push({ type: 'zoom', zoom }); },
    getViewPort: () => ({ resize: () => calls.push({ type: 'resize' }) }),
    getViewModel: () => ({
      setLookAtData(options, animate) {
        assertVisible();
        calls.push({ type: 'fit', ...options, animate });
      },
    }),
    addLayer() {}, removeLayer() {},
  };
  globalThis.google = { maps: { event: {
    trigger(actualMap, event) {
      assert.equal(actualMap, map);
      assert.equal(event, 'resize');
      calls.push({ type: 'resize' });
    },
  } } };
  globalThis.H = {
    geo: { Rect: class Rect {
      constructor(north, west, south, east) { Object.assign(this, { north, west, south, east }); }
    } },
    clustering: {
      DataPoint: class DataPoint {},
      Provider: class Provider { addEventListener() {} },
    },
    map: { layer: { ObjectLayer: class ObjectLayer {} } },
  };
  Object.assign(state, {
    data: [
      makeLocation('Bangkok', '13.7', '100.5'),
      makeLocation('Khon Kaen', '16.4', '102.8', 'khon-kaen'),
    ],
    visIdx: [0], activeIdx: 0, provider, map,
    markers: [], markerClusterer: null, infoWindow: null, infoBubble: null, hereUi: null,
    selectedDestinations: new Set(['bangkok']), favorites: new Set(), favFilterOn: false,
    pendingDestinationFit: false, exchangeSort: 'default', isLoading: false,
  });
  elements.search.value = 'Bangkok';

  try {
    return run({ elements, mapElement, map, calls });
  } finally {
    Object.assign(state, originalState);
    for (const [name, value] of Object.entries(globals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
}

function resetHome(elements) {
  const home = initHomeReset({
    clearSearch: () => { elements.search.value = ''; },
    clearFilters: () => { state.selectedDestinations.clear(); },
    clearActiveLocation,
    showListFromTop,
    applyFilters: () => applyFiltersAndSyncMap({ fitMap: true }),
    trackReset() {},
  });
  assert.ok(home);
  home.resetToHome();
}

for (const provider of ['google', 'here']) {
  for (const tab of ['map', 'list']) {
    test(`${provider}: mobile home reset from ${tab} defers fit until the map is shown and resized`, () => {
      withMapFixture(provider, { tab }, ({ elements, calls }) => {
        resetHome(elements);

        assert.equal(elements['map-wrap'].getAttribute('data-mobile-tab'), 'list');
        assert.equal(elements['loc-list'].scrollTop, 0);
        assert.equal(state.activeIdx, -1);
        assert.deepEqual(state.visIdx, [0, 1]);
        assert.equal(state.pendingDestinationFit, true);
        assert.deepEqual(calls, []);

        switchTab('map');
        assert.deepEqual(calls.map(call => call.type), ['resize', 'fit']);
        assert.deepEqual({ ...calls[1].bounds }, { north: 16.4, south: 13.7, east: 102.8, west: 100.5 });
        assert.equal(state.pendingDestinationFit, false);

        switchTab('list');
        switchTab('map');
        assert.deepEqual(calls.map(call => call.type), ['resize', 'fit', 'resize']);
      });
    });
  }

  test(`${provider}: desktop home reset fits immediately even with the list tab selected`, () => {
    withMapFixture(provider, { tab: 'list', width: 1200 }, ({ elements, calls }) => {
      resetHome(elements);
      assert.deepEqual(calls.map(call => call.type), ['fit']);
      assert.equal(state.pendingDestinationFit, false);
    });
  });

  test(`${provider}: a fit requested before map readiness remains pending while hidden`, () => {
    withMapFixture(provider, { tab: 'list' }, ({ map, calls }) => {
      state.map = null;
      assert.equal(fitMapToVisibleLocations(), false);
      assert.equal(state.pendingDestinationFit, true);
      switchTab('map');
      assert.equal(state.pendingDestinationFit, true);
      switchTab('list');

      state.map = map;
      assert.equal(fitMapToVisibleLocations(), false);
      assert.equal(state.pendingDestinationFit, true);
      assert.deepEqual(calls, []);
      switchTab('map');
      assert.deepEqual(calls.map(call => call.type), ['resize', 'center', 'zoom']);
      assert.equal(state.pendingDestinationFit, false);
    });
  });

  test(`${provider}: a deferred fit uses the current filtered results`, () => {
    withMapFixture(provider, { tab: 'list' }, ({ calls }) => {
      state.visIdx = [0, 1];
      assert.equal(fitMapToVisibleLocations(), false);
      state.visIdx = [1];
      switchTab('map');
      assert.deepEqual(calls, [
        { type: 'resize' },
        { type: 'center', center: { lat: 16.4, lng: 102.8 } },
        { type: 'zoom', zoom: 14 },
      ]);
      assert.equal(state.pendingDestinationFit, false);
    });
  });

  test(`${provider}: no current results clear a deferred fit without changing the viewport`, () => {
    withMapFixture(provider, { tab: 'list' }, ({ calls }) => {
      assert.equal(fitMapToVisibleLocations(), false);
      state.visIdx = [];
      switchTab('map');
      assert.deepEqual(calls, [{ type: 'resize' }]);
      assert.equal(state.pendingDestinationFit, false);
    });
  });

  test(`${provider}: opening a card after a deferred fit keeps the selected place zoom`, () => {
    withMapFixture(provider, { tab: 'list' }, ({ calls }) => {
      state.visIdx = [0, 1];
      assert.equal(fitMapToVisibleLocations(), false);
      activateCard(1);
      assert.deepEqual(calls.map(call => call.type), ['resize', 'fit', 'center', 'zoom']);
      assert.deepEqual(calls.at(-2), { type: 'center', center: { lat: 16.4, lng: 102.8 } });
      assert.deepEqual(calls.at(-1), { type: 'zoom', zoom: 15 });
      assert.equal(state.pendingDestinationFit, false);
    });
  });
}
