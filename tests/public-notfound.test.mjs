import assert from 'node:assert/strict';
import test from 'node:test';

function makeLocation(status, name = status) {
  return {
    nameEn: name,
    nameZh: name,
    alt: '',
    notesEn: '',
    notesZh: '',
    catEn: 'Cafe',
    catZh: '咖啡廳',
    icon: '☕',
    status,
    lat: '13.7',
    lng: '100.5',
    src: '',
    sourceUrl: '',
    dup: '',
    approx: '',
  };
}

test('public filters and list exclude Could Not Find while data remains loaded', async () => {
  const { state } = await import('../src/state.js');
  const { applyFilters, buildStatusFilter } = await import('../src/render.js');

  const elements = {
    search: { value: '' },
    'cat-filter': { value: '' },
    'status-filter': { value: '', innerHTML: '' },
    'loc-list': { innerHTML: '' },
    'result-info': { textContent: '' },
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => elements[id],
  };

  try {
    state.isLoading = false;
    state.data = [
      makeLocation('Verified', 'Visible verified'),
      makeLocation('Needs Review', 'Visible review'),
      makeLocation('Could Not Find', 'Hidden not found'),
    ];

    buildStatusFilter();
    applyFilters();

    assert.deepEqual(state.visIdx, [0, 1]);
    assert.equal(elements['result-info'].textContent, '顯示 2 / 2 個地點');
    assert.doesNotMatch(elements['status-filter'].innerHTML, /Could Not Find|找不到/);
    assert.doesNotMatch(elements['loc-list'].innerHTML, /Hidden not found|找不到/);
    assert.equal(state.data[2].status, 'Could Not Find');
  } finally {
    globalThis.document = previousDocument;
    state.data = [];
    state.visIdx = [];
    state.isLoading = true;
  }
});

test('map markers skip Could Not Find locations', async () => {
  const { state } = await import('../src/state.js');
  const { buildMarkers } = await import('../src/map.js');

  const createdMarkers = [];
  const previousDocument = globalThis.document;
  const previousGoogle = globalThis.google;
  globalThis.document = {
    createElement: () => ({ className: '', textContent: '' }),
  };
  globalThis.google = {
    maps: {
      marker: {
        AdvancedMarkerElement: class {
          constructor(options) {
            Object.assign(this, options);
            createdMarkers.push(this);
          }

          addListener() {}
        },
      },
    },
  };

  try {
    state.map = {};
    state.infoWindow = { setContent() {}, open() {} };
    state.markers = [];
    state.data = [
      makeLocation('Verified', 'Visible verified'),
      makeLocation('Could Not Find', 'Hidden not found'),
    ];

    buildMarkers();

    assert.equal(createdMarkers.length, 1);
    assert.ok(state.markers[0]);
    assert.equal(state.markers[1], undefined);
  } finally {
    globalThis.document = previousDocument;
    globalThis.google = previousGoogle;
    state.map = null;
    state.infoWindow = null;
    state.markers = [];
    state.data = [];
  }
});
