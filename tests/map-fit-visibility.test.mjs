import assert from 'node:assert/strict';
import test from 'node:test';

import { state } from '../src/core/state.js';
import { applyFiltersAndSyncMap, showListFromTop } from '../src/app/app-coordinator.js';
import { initHomeReset } from '../src/features/home-reset.js';
import { clearActiveLocation, fitMapToVisibleLocations } from '../src/map/map.js';
import { activateCard } from '../src/ui/render.js';
import { flushPendingFocus } from '../src/map/viewport.js';

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

/**
 * The map is full-bleed in every layout, so it only lacks dimensions before
 * layout (modelled by `mapVisible: false`). Providers run a pending fit and a
 * pending place focus right after they initialize (see initWithGoogle/Here).
 */
function withMapFixture(provider, { width = 390, mapVisible = true } = {}, run) {
  const globals = {
    document: globalThis.document,
    window: globalThis.window,
    google: globalThis.google,
    H: globalThis.H,
  };
  const originalState = { ...state };
  const elements = Object.fromEntries([
    'home-btn', 'panel', 'map-wrap',
    'search', 'cat-filter', 'label-filter', 'loc-list', 'result-info',
  ].map(id => [id, makeElement()]));
  globalThis.window = { innerWidth: width };
  const size = { visible: mapVisible };
  const mapElement = {
    get clientWidth() { return size.visible ? 600 : 0; },
    get clientHeight() { return size.visible ? 500 : 0; },
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
    getViewModel: () => ({
      setLookAtData(options, animate) {
        assertVisible();
        calls.push({ type: 'fit', ...options, animate });
      },
    }),
    addLayer() {}, removeLayer() {},
  };
  globalThis.google = { maps: { event: { trigger() {} } } };
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
    markers: [], markerClusterer: null, hereUi: null,
    selectedDestinations: new Set(['bangkok']), favorites: new Set(), favFilterOn: false,
    pendingDestinationFit: false, exchangeSort: 'default', isLoading: false,
  });
  elements.search.value = 'Bangkok';

  try {
    return run({ elements, mapElement, size, map, calls });
  } finally {
    flushPendingFocus();
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

/** What a provider does once its map exists: run the pending fit, then focus. */
function initializeProvider(map) {
  state.map = map;
  if (state.pendingDestinationFit) fitMapToVisibleLocations();
  flushPendingFocus();
}

for (const provider of ['google', 'here']) {
  for (const [layout, width] of [['mobile', 390], ['desktop', 1200]]) {
    test(`${provider}: ${layout} home reset fits immediately because the map stays visible`, () => {
      withMapFixture(provider, { width }, ({ elements, calls }) => {
        resetHome(elements);

        assert.equal(elements['loc-list'].scrollTop, 0);
        assert.equal(state.activeIdx, -1);
        assert.deepEqual(state.visIdx, [0, 1]);
        assert.equal(state.pendingDestinationFit, false);
        assert.deepEqual(calls.map(call => call.type), ['fit']);
        assert.deepEqual({ ...calls[0].bounds }, { north: 16.4, south: 13.7, east: 102.8, west: 100.5 });
      });
    });
  }

  test(`${provider}: a fit requested before map readiness runs when the provider initializes`, () => {
    withMapFixture(provider, {}, ({ map, calls }) => {
      state.map = null;
      assert.equal(fitMapToVisibleLocations(), false);
      assert.equal(state.pendingDestinationFit, true);
      assert.deepEqual(calls, []);

      initializeProvider(map);
      assert.deepEqual(calls.map(call => call.type), ['center', 'zoom']);
      assert.equal(state.pendingDestinationFit, false);
    });
  });

  test(`${provider}: a fit before the map has dimensions stays pending`, () => {
    withMapFixture(provider, { mapVisible: false }, ({ size, calls }) => {
      assert.equal(fitMapToVisibleLocations(), false);
      assert.equal(state.pendingDestinationFit, true);
      assert.deepEqual(calls, []);

      size.visible = true;
      state.visIdx = [1];
      assert.equal(fitMapToVisibleLocations(), true);
      assert.deepEqual(calls, [
        { type: 'center', center: { lat: 16.4, lng: 102.8 } },
        { type: 'zoom', zoom: 14 },
      ]);
      assert.equal(state.pendingDestinationFit, false);
    });
  });

  test(`${provider}: no current results clear a deferred fit without changing the viewport`, () => {
    withMapFixture(provider, { mapVisible: false }, ({ size, calls }) => {
      assert.equal(fitMapToVisibleLocations(), false);
      state.visIdx = [];
      size.visible = true;
      assert.equal(fitMapToVisibleLocations(), false);
      assert.deepEqual(calls, []);
      assert.equal(state.pendingDestinationFit, false);
    });
  });

  test(`${provider}: a place opened before the map loads is focused after the pending fit`, () => {
    withMapFixture(provider, {}, ({ map, calls }) => {
      state.map = null;
      state.visIdx = [0, 1];
      assert.equal(fitMapToVisibleLocations(), false);
      activateCard(1);
      assert.equal(state.activeIdx, 1);
      assert.deepEqual(calls, []);

      initializeProvider(map);
      assert.deepEqual(calls.map(call => call.type), ['fit', 'center', 'zoom']);
      assert.deepEqual(calls.at(-2), { type: 'center', center: { lat: 16.4, lng: 102.8 } });
      assert.deepEqual(calls.at(-1), { type: 'zoom', zoom: 15 });
      assert.equal(state.pendingDestinationFit, false);
    });
  });

  test(`${provider}: clearing the selection drops a pending place focus`, () => {
    withMapFixture(provider, {}, ({ map, calls }) => {
      state.map = null;
      activateCard(1);
      clearActiveLocation();
      initializeProvider(map);
      assert.deepEqual(calls, []);
      assert.equal(state.activeIdx, -1);
    });
  });
}
