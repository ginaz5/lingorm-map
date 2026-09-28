import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { state } from '../src/core/state.js';
import { buildMarkers, clearActiveLocation } from '../src/map/map.js';
import { activateCard } from '../src/ui/render.js';
import { cancelPopupCenter, openLocationPopup } from '../src/map/popup.js';

const originalState = { ...state };
const globals = ['window', 'document', 'google', 'H', 'requestAnimationFrame', 'cancelAnimationFrame'];
const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

afterEach(() => {
  cancelPopupCenter();
  Object.assign(state, originalState);
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function setup(provider, width = 390) {
  let nextFrame = 0;
  const frames = new Map();
  const pans = [];
  const centers = [];
  const zooms = [];
  const options = [];
  const popupListeners = new Map();
  const classList = { add() {}, remove() {}, toggle() {} };
  const viewport = { left: 12, top: 56, width, height: 700 };
  // The popup can begin partly above the map and off-center horizontally.
  const rect = { left: 94, top: -100, width: 294, height: 300 };
  let attached = false;
  let hidden = false;
  // HERE anchor in map-relative px; defaults to wherever the positioned card is centred.
  let anchor = null;
  const card = { getBoundingClientRect: () => ({ ...rect }) };
  const mapElement = {
    getBoundingClientRect: () => hidden ? { width: 0, height: 0 } : viewport,
    querySelector: () => attached ? card : null,
  };
  const elements = {
    map: mapElement,
    panel: { setAttribute() {} },
    'map-wrap': { setAttribute() {} },
    'tab-map': { classList },
    'tab-list': { classList },
  };
  globalThis.window = { innerWidth: width };
  globalThis.document = {
    getElementById: id => elements[id] || null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList }),
  };
  globalThis.requestAnimationFrame = callback => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const map = {
    panBy: (x, y) => pans.push({ x, y }),
    screenToGeo: (x, y) => ({ lat: y / 100, lng: x / 100 }),
    geoToScreen: () => anchor || {
      x: rect.left + rect.width / 2 - viewport.left,
      y: rect.top + rect.height - viewport.top,
    },
    setCenter: (center, animate) => centers.push({ center, animate }),
    setZoom: zoom => zooms.push(zoom),
    getViewPort: () => ({ resize() {} }),
    addLayer() {}, removeLayer() {}, removeObject() {},
  };
  const infoWindow = {
    addListener(event, callback) {
      const listeners = popupListeners.get(event) || new Set();
      listeners.add(callback);
      popupListeners.set(event, listeners);
      return { remove: () => listeners.delete(callback) };
    },
    setOptions: value => options.push(value),
    setContent() {}, open() {},
    close() { attached = false; emit('close'); },
  };
  const emit = event => [...(popupListeners.get(event) || [])].forEach(fn => fn());
  globalThis.google = {
    maps: {
      event: { trigger() {} },
      marker: {
        AdvancedMarkerElement: class {
          constructor(opts) { Object.assign(this, opts); this.listeners = {}; }
          addListener(event, callback) { this.listeners[event] = callback; }
        },
      },
    },
  };
  let hereTap;
  globalThis.H = {
    ui: {
      InfoBubble: class {
        constructor(position, opts) { this.position = position; this.content = opts.content; }
        getElement() { return { querySelector: () => attached ? card : null }; }
      },
    },
    clustering: {
      DataPoint: class {},
      Provider: class { addEventListener(event, callback) { hereTap = callback; } },
    },
    map: { layer: { ObjectLayer: class {} } },
  };
  Object.assign(state, {
    provider, map, infoWindow, infoBubble: null,
    hereUi: { addBubble() {}, removeBubble() { attached = false; } },
    data: [0, 1].map(i => ({
      id: `place-${i}`, nameEn: `Place ${i}`, nameZh: `地點 ${i}`, icon: '☕',
      lat: '13.7', lng: '100.5', status: 'Published', catEn: 'Cafe', catZh: '咖啡廳',
    })),
    visIdx: [0, 1], markers: [{}, {}], activeIdx: -1, markerClusterer: null,
  });
  return {
    pans, centers, zooms, options, viewport, rect, popupListeners,
    attach() { attached = true; emit('domready'); },
    hideMap() { hidden = true; },
    setAnchor(value) { anchor = value; },
    tick() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(fn => fn(0));
    },
    tapHere(i) { hereTap({ target: { getData: () => ({ index: i }) } }); },
    assertCentered() {
      const dx = rect.left + rect.width / 2 - viewport.left - viewport.width / 2;
      const dy = rect.top + rect.height / 2 - viewport.top - viewport.height / 2;
      if (provider === 'google') assert.deepEqual(pans, [{ x: dx, y: dy }]);
      else assert.deepEqual(centers.at(-1), {
        center: { lat: (viewport.height / 2 + dy) / 100, lng: (viewport.width / 2 + dx) / 100 },
        animate: true,
      });
    },
  };
}

for (const provider of ['google', 'here']) {
  test(`${provider} marker click centers the rendered mobile popup without changing zoom`, async () => {
    const h = setup(provider);
    state.markers = [];
    await buildMarkers({ markerClustererCtor: class {} });
    if (provider === 'google') state.markers[0].listeners.click();
    else h.tapHere(0);
    assert.equal(state.activeIdx, 0);
    h.tick(); // SDK has not attached the card yet.
    assert.equal(h.pans.length + h.centers.length, 0);
    h.attach(); h.tick(); h.tick();
    h.assertCentered();
    assert.deepEqual(h.zooms, []);
  });

  test(`${provider} list selection also centers the popup after showing the map`, () => {
    const h = setup(provider);
    activateCard(0);
    h.attach(); h.tick(); h.tick();
    h.assertCentered();
    assert.deepEqual(h.zooms, [15]);
  });

  test(`${provider} desktop popup preserves the existing map view`, () => {
    const h = setup(provider, 1024);
    openLocationPopup(0, 'content');
    h.attach(); h.tick(); h.tick();
    assert.deepEqual(h.pans, []);
    assert.deepEqual(h.centers, []);
    if (provider === 'google') assert.deepEqual(h.options, [{ disableAutoPan: false }]);
  });

  test(`${provider} rapid selections discard old centering and use the latest card size`, () => {
    const h = setup(provider);
    openLocationPopup(0, 'first');
    h.attach(); h.tick();
    openLocationPopup(1, 'second');
    h.rect.height = 180;
    h.attach(); h.tick(); h.tick();
    h.assertCentered();
    assert.equal(h.pans.length + h.centers.length, 1);
  });

  test(`${provider} does not pan when the map becomes hidden or selection is cleared`, () => {
    const h = setup(provider);
    openLocationPopup(0, 'content');
    h.attach(); h.tick();
    h.hideMap(); h.tick();
    assert.equal(h.pans.length + h.centers.length, 0);
    openLocationPopup(1, 'content');
    clearActiveLocation();
    h.attach(); h.tick(); h.tick();
    assert.equal(h.pans.length + h.centers.length, 0);
  });
}

test('Google waits for stable popup dimensions and disables competing SDK auto-pan', () => {
  const h = setup('google');
  openLocationPopup(0, 'content');
  assert.deepEqual(h.options, [{ disableAutoPan: true }]);
  h.attach(); h.tick();
  h.rect.height = 220;
  h.tick();
  assert.deepEqual(h.pans, []);
  h.tick();
  h.assertCentered();
  assert.equal(h.popupListeners.get('domready').size, 0);
});

test('closing Google popup before its layout settles cancels the pan', () => {
  const h = setup('google');
  openLocationPopup(0, 'content');
  h.attach(); h.tick();
  state.infoWindow.close();
  h.tick();
  assert.deepEqual(h.pans, []);
});

test('HERE ignores the unpositioned bubble until the SDK moves it onto its anchor', () => {
  const h = setup('here');
  const positioned = { ...h.rect };
  h.setAnchor({ x: positioned.left + positioned.width / 2 - h.viewport.left, y: 0 });
  // Right after addBubble, HERE leaves the body at the map's top-left until a later
  // render frame. It can stay there for several frames, so it looks "stable".
  Object.assign(h.rect, { left: -positioned.width / 2, top: -150 });
  openLocationPopup(0, 'content');
  h.attach(); h.tick(); h.tick(); h.tick();
  assert.deepEqual(h.centers, []);
  Object.assign(h.rect, positioned);
  h.tick(); h.tick();
  h.assertCentered();
  assert.equal(h.centers.length, 1);
});
