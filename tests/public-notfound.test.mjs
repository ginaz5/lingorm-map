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
    approx: '',
  };
}

test('public filters and list show only Published locations', async () => {
  const { state } = await import('../src/core/state.js');
  const { applyFilters } = await import('../src/ui/render.js');

  const elements = {
    search: { value: '' },
    'cat-filter': { value: '' },
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
      makeLocation('Published', 'Visible published'),
      makeLocation('Verified', 'Hidden verified'),
      makeLocation('Needs Review', 'Hidden review'),
      makeLocation('Draft', 'Hidden draft'),
      makeLocation('Verifying', 'Hidden verifying'),
      makeLocation('Could Not Find', 'Hidden not found'),
      makeLocation('Closed', 'Hidden closed'),
      makeLocation('Paused', 'Hidden paused'),
      makeLocation('Inactive', 'Hidden inactive'),
      makeLocation('Unexpected', 'Hidden unknown'),
    ];

    applyFilters();

    assert.deepEqual(state.visIdx, [0]);
    assert.equal(elements['result-info'].textContent, '顯示 1 / 1 個地點');
    for (const hiddenName of [
      'Hidden verified',
      'Hidden review',
      'Hidden draft',
      'Hidden verifying',
      'Hidden not found',
      'Hidden closed',
      'Hidden paused',
      'Hidden inactive',
      'Hidden unknown',
    ]) {
      assert.doesNotMatch(elements['loc-list'].innerHTML, new RegExp(hiddenName));
    }
    assert.equal(state.data[5].status, 'Could Not Find');
  } finally {
    globalThis.document = previousDocument;
    state.data = [];
    state.visIdx = [];
    state.isLoading = true;
  }
});

test('map markers use the same public status allowlist', async () => {
  const { state } = await import('../src/core/state.js');
  const { buildMarkers } = await import('../src/map/map.js');

  const createdDataPoints = [];
  const previousDocument = globalThis.document;
  const previousHere = globalThis.H;
  globalThis.document = {
    createElement: () => ({ className: '', textContent: '', style: {} }),
  };
  globalThis.H = {
    map: {
      DomIcon: class {
        constructor(element) {
          this.element = element;
        }
      },
      DomMarker: class {
        constructor(position, options) {
          this.position = position;
          this.options = options;
        }

        setData() {}
        addEventListener() {}
      },
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
    state.map = { addObject() {}, removeObject() {}, addLayer() {}, removeLayer() {} };
    state.provider = 'here';
    state.markers = [];
    state.markerClusterer = null;
    state.data = [
      makeLocation('Published', 'Visible published'),
      makeLocation('Verified', 'Hidden verified'),
      makeLocation('Needs Review', 'Hidden review'),
      makeLocation('Draft', 'Hidden draft'),
      makeLocation('Verifying', 'Hidden verifying'),
      makeLocation('Could Not Find', 'Hidden not found'),
      makeLocation('Closed', 'Hidden closed'),
      makeLocation('Paused', 'Hidden paused'),
      makeLocation('Inactive', 'Hidden inactive'),
      makeLocation('Unexpected', 'Hidden unknown'),
    ];
    state.visIdx = [0];

    await buildMarkers();

    assert.equal(createdDataPoints.length, 1);
  } finally {
    globalThis.document = previousDocument;
    globalThis.H = previousHere;
    state.map = null;
    state.provider = null;
    state.markers = [];
    state.markerClusterer = null;
    state.data = [];
    state.visIdx = [];
  }
});

test('activateCard centers HERE map and opens info bubble', async () => {
  const { state } = await import('../src/core/state.js');
  const { activateCard } = await import('../src/ui/render.js');

  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousHere = globalThis.H;
  const centers = [];
  const zooms = [];
  const bubbles = [];
  const activeClassOps = [];
  const cardClassOps = [];
  const markerClassOps = [];

  globalThis.document = {
    querySelectorAll: () => [
      { classList: { remove: (name) => activeClassOps.push(['remove', name]) } },
    ],
    getElementById: (id) => {
      if (id !== 'card-0') return null;
      return {
        classList: { add: (name) => cardClassOps.push(['add', name]) },
        scrollIntoView() {},
      };
    },
  };
  globalThis.window = { innerWidth: 1024 };
  globalThis.H = {
    ui: {
      InfoBubble: class {
        constructor(position, options) {
          this.position = position;
          this.options = options;
        }
      },
    },
  };

  try {
    state.activeIdx = -1;
    state.provider = 'here';
    state.data = [makeLocation('Published', 'Visible published')];
    state.map = {
      setCenter: (position) => centers.push(position),
      setZoom: (zoom) => zooms.push(zoom),
    };
    state.hereUi = {
      addBubble: (bubble) => bubbles.push(bubble),
      removeBubble: () => {},
    };
    state.infoBubble = null;
    state.markers = [{
      id: 'marker-0',
      __markerContent: {
        classList: { toggle: (name, active) => markerClassOps.push([name, active]) },
      },
    }];

    activateCard(0);

    assert.equal(state.activeIdx, 0);
    assert.deepEqual(centers, [{ lat: 13.7, lng: 100.5 }]);
    assert.deepEqual(zooms, [15]);
    assert.equal(bubbles.length, 1);
    assert.deepEqual(bubbles[0].position, { lat: 13.7, lng: 100.5 });
    assert.match(bubbles[0].options.content, /Visible published/);
    assert.deepEqual(activeClassOps, [['remove', 'active']]);
    assert.deepEqual(cardClassOps, [['add', 'active']]);
    assert.deepEqual(markerClassOps, [['active', true]]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.H = previousHere;
    state.activeIdx = -1;
    state.provider = null;
    state.data = [];
    state.map = null;
    state.hereUi = null;
    state.infoBubble = null;
    state.markers = [];
  }
});
