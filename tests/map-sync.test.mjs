import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFiltersAndSyncMap } from '../src/app/app-coordinator.js';
import { refreshActivePopup, syncVisibleMarkers } from '../src/map/map.js';
import { state } from '../src/core/state.js';

function makeLocation() {
  return {
    id: 'active-location',
    nameEn: 'Active Location',
    nameZh: '目前地點',
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
  };
}

function resetMapState() {
  state.activeIdx = -1;
  state.data = [];
  state.visIdx = [];
  state.provider = null;
  state.map = null;
  state.infoWindow = null;
  state.infoBubble = null;
  state.markers = [];
  state.markerClusterer = null;
  state.pendingDestinationFit = false;
}

test('syncVisibleMarkers is a no-op before map initialization', () => {
  resetMapState();
  state.visIdx = [0];
  state.markers = [{
    setVisibility() {
      throw new Error('marker visibility should not change without a map');
    },
  }];

  assert.doesNotThrow(() => syncVisibleMarkers());
  resetMapState();
});

test('refreshActivePopup updates the active Google info window', () => {
  const contents = [];
  resetMapState();
  state.activeIdx = 0;
  state.data = [makeLocation()];
  state.provider = 'google';
  state.infoWindow = {
    setContent: html => contents.push(html),
  };

  try {
    assert.equal(refreshActivePopup(), true);
    assert.equal(contents.length, 1);
    assert.match(contents[0], /目前地點/);
  } finally {
    resetMapState();
  }
});

test('refreshActivePopup updates the active HERE info bubble', () => {
  const contents = [];
  resetMapState();
  state.activeIdx = 0;
  state.data = [makeLocation()];
  state.provider = 'here';
  state.infoBubble = {
    setContent: html => contents.push(html),
  };

  try {
    assert.equal(refreshActivePopup(), true);
    assert.equal(contents.length, 1);
    assert.match(contents[0], /目前地點/);
  } finally {
    resetMapState();
  }
});

test('refreshActivePopup reports when no provider popup is open', () => {
  resetMapState();
  assert.equal(refreshActivePopup(), false);
});

test('coordinated fit delegates pending-map behavior to map.js', () => {
  const previousDocument = globalThis.document;
  const elements = {
    search: { value: '' },
    'cat-filter': { value: '' },
    'type-filter': { value: '' },
    'loc-list': { innerHTML: '' },
    'result-info': { textContent: '' },
  };
  globalThis.document = {
    getElementById: id => elements[id] ?? null,
  };
  resetMapState();
  state.isLoading = false;

  try {
    applyFiltersAndSyncMap({ fitMap: true });
    assert.equal(state.pendingDestinationFit, true);
  } finally {
    globalThis.document = previousDocument;
    state.isLoading = true;
    resetMapState();
  }
});
