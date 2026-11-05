// Selecting a place opens the detail panel and centres the place in the part
// of the map not covered by the search bar and results panel. This replaced
// the provider InfoWindow / InfoBubble popups and their mobile re-centering.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { state } from '../src/core/state.js';
import { buildMarkers, clearActiveLocation } from '../src/map/map.js';
import { activateCard } from '../src/ui/render.js';
import { initBottomSheet, getSheetSnap, setSheetSnap } from '../src/ui/bottom-sheet.js';
import { getMapInsets, visibleCenterOffset, fitPadding } from '../src/map/viewport.js';
import { makeMapFirstDom } from './helpers/map-first-dom.mjs';

const originalState = { ...state };
const globals = ['window', 'document', 'google', 'H'];
const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

afterEach(() => {
  Object.assign(state, originalState);
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function setup(provider, options = {}) {
  const dom = makeMapFirstDom(options);
  globalThis.window = dom.view;
  globalThis.document = dom.documentRoot;
  const calls = [];
  const objects = [];
  const googleMarkers = [];
  const map = {
    setCenter: (center, animate) => calls.push(animate ? ['center', center, 'animate'] : ['center', center]),
    setZoom: zoom => calls.push(['zoom', zoom]),
    panBy: (x, y) => calls.push(['panBy', x, y]),
    screenToGeo: (x, y) => ({ x, y }),
    addLayer() {}, removeLayer() {},
    addObject: object => objects.push(object),
    removeObject: object => { const at = objects.indexOf(object); if (at >= 0) objects.splice(at, 1); },
  };
  let hereTap = null;
  globalThis.google = {
    maps: {
      marker: {
        AdvancedMarkerElement: class {
          constructor(opts) { Object.assign(this, opts); this.listeners = {}; googleMarkers.push(this); }
          addListener(event, callback) { this.listeners[event] = callback; }
        },
      },
    },
  };
  globalThis.H = {
    clustering: {
      DataPoint: class {},
      Provider: class { addEventListener(_event, callback) { hereTap = callback; } },
    },
    map: {
      layer: { ObjectLayer: class {} },
      DomIcon: class { constructor(element) { this.element = element; } },
      DomMarker: class { constructor(position, options) { Object.assign(this, { position, options }); } },
    },
  };
  Object.assign(state, {
    provider, map,
    data: [0, 1].map(i => ({
      id: `place-${i}`, nameEn: `Place ${i}`, nameZh: `地點 ${i}`, icon: '☕',
      lat: '13.7', lng: `100.5${i}`, status: 'Published', catEn: 'Cafe', catZh: '咖啡廳',
      notesEn: '', notesZh: '', alt: '', type: 'LingOrm', src: '', sourceUrl: '', approx: '',
    })),
    visIdx: [0, 1], markers: [], activeIdx: -1, markerClusterer: null, favorites: new Set(),
  });
  /** The selected-place pin currently on the map, if any. */
  const selectedPin = () => provider === 'google'
    ? googleMarkers.find(marker => marker.zIndex === 2000 && marker.map === map) ?? null
    : objects.find(object => object.options?.zIndex === 2000) ?? null;
  return {
    ...dom, calls, map, selectedPin,
    tapMarker(i) {
      if (provider === 'google') state.markers[i].listeners.click();
      else hereTap({ target: { getData: () => ({ index: i }) } });
    },
  };
}

test('viewport helpers aim at the middle of the uncovered area', () => {
  assert.deepEqual(visibleCenterOffset({ top: 112, right: 0, bottom: 248, left: 0 }), { x: 0, y: -68 });
  assert.deepEqual(visibleCenterOffset({ top: 0, right: 0, bottom: 0, left: 300 }), { x: 150, y: 0 });
  assert.deepEqual(fitPadding(48, { top: 112, right: 0, bottom: 248, left: 0 }),
    { top: 160, right: 48, bottom: 296, left: 48 });
});

test('mobile insets follow the target sheet snap, not its animation', () => {
  const { documentRoot } = setup('google');
  initBottomSheet({ documentRoot });
  // 800px viewport, map ends at the 112px peek sheet: half sheet (360px)
  // covers 248px of the 688px map; the search bar and chips cover 112px.
  assert.deepEqual(getMapInsets(), { top: 112, right: 0, bottom: 248, left: 0 });
  setSheetSnap('peek');
  assert.deepEqual(getMapInsets(), { top: 112, right: 0, bottom: 0, left: 0 });
  setSheetSnap('full');
  // A full sheet leaves too little map, so it keeps a 96px band instead.
  assert.deepEqual(getMapInsets(), { top: 112, right: 0, bottom: 480, left: 0 });
});

test('desktop insets ignore the side panel the map already sits beside', () => {
  setup('google', { width: 1280, mapTopBottom: 60 });
  assert.deepEqual(getMapInsets(), { top: 60, right: 0, bottom: 0, left: 0 });
});

for (const provider of ['google', 'here']) {
  test(`${provider} marker tap opens the place and pans it above the sheet without zooming`, async () => {
    const h = setup(provider);
    initBottomSheet({ documentRoot: h.documentRoot });
    setSheetSnap('peek');
    await buildMarkers({ markerClustererCtor: class {} });
    h.calls.length = 0;

    h.tapMarker(1);

    assert.equal(state.activeIdx, 1);
    const pin = h.selectedPin();
    assert.ok(pin, 'the selected place gets its own pin above clusters');
    assert.deepEqual(pin.position, { lat: 13.7, lng: 100.51 });
    assert.equal(h.elements['place-detail'].hidden, false);
    assert.match(h.elements['place-detail-body'].innerHTML, /地點 1/);
    // Opening a place raises the sheet to half before the map pans.
    assert.equal(getSheetSnap(), 'half');
    const point = { lat: 13.7, lng: 100.51 };
    if (provider === 'google') {
      assert.deepEqual(h.calls, [['center', point], ['panBy', 0, 68]]);
    } else {
      // Recentre on the geo point under the uncovered area's middle.
      assert.deepEqual(h.calls, [['center', point], ['center', { x: 195, y: 412 }, 'animate']]);
    }
  });

  test(`${provider} list card zooms to the place and clearing returns to the list`, () => {
    const h = setup(provider, { width: 1280, mapTopBottom: 60 });
    h.elements['loc-list'].scrollTop = 420;

    activateCard(0);
    assert.deepEqual(h.calls.slice(0, 2), [['center', { lat: 13.7, lng: 100.5 }], ['zoom', 15]]);
    assert.equal(h.elements['panel-results'].hidden, true);
    assert.equal(h.elements.panel.dataset.view, 'place');

    h.elements['loc-list'].scrollTop = 0; // a hidden list may lose its scroll
    assert.ok(h.selectedPin());
    activateCard(1); // selecting another place moves the single pin
    assert.deepEqual(h.selectedPin().position, { lat: 13.7, lng: 100.51 });
    clearActiveLocation();
    assert.equal(h.selectedPin(), null);
    assert.equal(state.activeIdx, -1);
    assert.equal(h.elements['place-detail'].hidden, true);
    assert.equal(h.elements['panel-results'].hidden, false);
    assert.equal(h.elements['place-detail-body'].innerHTML, '');
    assert.equal(h.elements['loc-list'].scrollTop, 420);
  });
}

test('collapsing the desktop panel shifts the centre first so the map stays put', async () => {
  const { initSidePanel, setPanelCollapsed, isPanelCollapsed } = await import('../src/ui/side-panel.js');
  const { shiftCenterByPixels } = await import('../src/map/viewport.js');
  const h = setup('google', { width: 1280, mapTopBottom: 60 });
  const centers = [];
  Object.assign(h.map, {
    getCenter: () => ({ lat: () => 13.75, lng: () => 100.5 }),
    // 872px-wide map spanning 0.872° of longitude: 0.001° per pixel.
    getBounds: () => ({ getNorthEast: () => ({ lng: () => 100.936 }), getSouthWest: () => ({ lng: () => 100.064 }) }),
    setCenter: center => centers.push(center),
  });
  const order = [];
  initSidePanel({
    documentRoot: h.documentRoot,
    beforeToggle: next => {
      order.push(['before', next, h.elements['app-body'].dataset.panel]);
      shiftCenterByPixels(next ? -204 : 204);
    },
    onToggle: collapsed => order.push(['after', collapsed, h.elements['app-body'].dataset.panel]),
  });
  setPanelCollapsed(true);
  assert.equal(isPanelCollapsed(), true);
  // The hook sees the old layout; the centre moves 204px west (0.204°).
  assert.deepEqual(order, [['before', true, 'open'], ['after', true, 'collapsed']]);
  assert.equal(centers.length, 1);
  assert.equal(centers[0].lat, 13.75);
  assert.ok(Math.abs(centers[0].lng - 100.296) < 1e-9);
  assert.equal(h.elements['panel-toggle'].getAttribute('aria-expanded'), 'false');
  assert.equal(h.elements['panel-toggle'].dataset.i18nAria, 'panel_expand');
  setPanelCollapsed(true); // no change: no hooks
  assert.equal(order.length, 2);
  setPanelCollapsed(false);
});
