import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFiltersAndSyncMap } from '../src/app/app-coordinator.js';
import { syncVisibleMarkers } from '../src/map/map.js';
import { refreshPlaceDetail } from '../src/ui/place-detail.js';
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

/** @param {boolean} open */
function withDetailDocument(open, run) {
  const previousDocument = globalThis.document;
  const elements = {
    'place-detail': { hidden: !open },
    'place-detail-body': { innerHTML: 'stale', scrollTop: 120 },
  };
  globalThis.document = { getElementById: id => elements[id] ?? null };
  try {
    run(elements);
  } finally {
    globalThis.document = previousDocument;
    resetMapState();
  }
}

for (const provider of ['google', 'here']) {
  test(`refreshPlaceDetail re-renders the open place for ${provider} and keeps its scroll`, () => {
    withDetailDocument(true, elements => {
      resetMapState();
      state.activeIdx = 0;
      state.data = [makeLocation()];
      state.provider = provider;
      assert.equal(refreshPlaceDetail(), true);
      assert.match(elements['place-detail-body'].innerHTML, /目前地點/);
      assert.equal(elements['place-detail-body'].scrollTop, 120);
    });
  });
}

test('refreshPlaceDetail reports when no place is open', () => {
  withDetailDocument(false, elements => {
    state.activeIdx = 0;
    state.data = [makeLocation()];
    assert.equal(refreshPlaceDetail(), false);
    assert.equal(elements['place-detail-body'].innerHTML, 'stale');
  });
  withDetailDocument(true, () => {
    state.activeIdx = -1;
    assert.equal(refreshPlaceDetail(), false);
  });
});

test('coordinated fit delegates pending-map behavior to map.js', () => {
  const previousDocument = globalThis.document;
  const elements = {
    search: { value: '' },
    'cat-filter': { value: '' },
    'label-filter': { value: '' },
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
