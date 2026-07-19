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

test('public filters and list use the Verified/Needs Review allowlist', async () => {
  const { state } = await import('../src/state.js');
  const { applyFilters } = await import('../src/render.js');

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
      makeLocation('Verified', 'Visible verified'),
      makeLocation('Needs Review', 'Visible review'),
      makeLocation('Draft', 'Hidden draft'),
      makeLocation('Verifying', 'Hidden verifying'),
      makeLocation('Could Not Find', 'Hidden not found'),
      makeLocation('Closed', 'Hidden closed'),
    ];

    applyFilters();

    assert.deepEqual(state.visIdx, [0, 1]);
    assert.equal(elements['result-info'].textContent, '顯示 2 / 2 個地點');
    for (const hiddenName of ['Hidden draft', 'Hidden verifying', 'Hidden not found', 'Hidden closed']) {
      assert.doesNotMatch(elements['loc-list'].innerHTML, new RegExp(hiddenName));
    }
    assert.equal(state.data[4].status, 'Could Not Find');
  } finally {
    globalThis.document = previousDocument;
    state.data = [];
    state.visIdx = [];
    state.isLoading = true;
  }
});

test('map markers use the same public status allowlist', async () => {
  const { state } = await import('../src/state.js');
  const { buildMarkers } = await import('../src/map.js');

  const createdMarkers = [];
  const previousDocument = globalThis.document;
  const previousHere = globalThis.H;
  globalThis.document = {
    createElement: () => ({ className: '', textContent: '' }),
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
          createdMarkers.push(this);
        }

        addEventListener() {}
      },
    },
  };

  try {
    state.map = { addObject() {}, removeObject() {} };
    state.markers = [];
    state.data = [
      makeLocation('Verified', 'Visible verified'),
      makeLocation('Needs Review', 'Visible review'),
      makeLocation('Draft', 'Hidden draft'),
      makeLocation('Verifying', 'Hidden verifying'),
      makeLocation('Could Not Find', 'Hidden not found'),
      makeLocation('Closed', 'Hidden closed'),
    ];

    buildMarkers();

    assert.equal(createdMarkers.length, 2);
    assert.ok(state.markers[0]);
    assert.ok(state.markers[1]);
    for (const index of [2, 3, 4, 5]) {
      assert.equal(state.markers[index], undefined);
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.H = previousHere;
    state.map = null;
    state.markers = [];
    state.data = [];
  }
});

test('activateCard centers HERE map and opens info bubble', async () => {
  const { state } = await import('../src/state.js');
  const { activateCard } = await import('../src/render.js');

  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousHere = globalThis.H;
  const centers = [];
  const zooms = [];
  const bubbles = [];
  const activeClassOps = [];
  const cardClassOps = [];

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
    state.data = [makeLocation('Verified', 'Visible verified')];
    state.map = {
      setCenter: (position) => centers.push(position),
      setZoom: (zoom) => zooms.push(zoom),
    };
    state.hereUi = {
      addBubble: (bubble) => bubbles.push(bubble),
      removeBubble: () => {},
    };
    state.infoBubble = null;
    state.markers = [{ id: 'marker-0' }];

    activateCard(0);

    assert.equal(state.activeIdx, 0);
    assert.deepEqual(centers, [{ lat: 13.7, lng: 100.5 }]);
    assert.deepEqual(zooms, [15]);
    assert.equal(bubbles.length, 1);
    assert.deepEqual(bubbles[0].position, { lat: 13.7, lng: 100.5 });
    assert.match(bubbles[0].options.content, /Visible verified/);
    assert.deepEqual(activeClassOps, [['remove', 'active']]);
    assert.deepEqual(cardClassOps, [['add', 'active']]);
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
