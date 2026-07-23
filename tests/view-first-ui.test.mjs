import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { makeMarkerContent } from '../src/map/map.js';
import { buildPopupContent, renderList } from '../src/ui/render.js';
import { state } from '../src/core/state.js';

const REMOVED_UI_TOKENS = [
  'add-btn',
  'add-modal',
  'edit-modal',
  'status-filter',
  'pending-banner',
  'name="suggest-edit"',
  'name="add-location"',
  'leg_verified',
  'leg_review',
];

function makeLocation() {
  return {
    id: 'sample-cafe',
    nameEn: 'Sample Cafe',
    nameZh: '範例咖啡廳',
    alt: 'ร้านตัวอย่าง',
    notesEn: 'Sample notes',
    notesZh: '範例說明',
    catEn: 'Cafe',
    catZh: '咖啡廳',
    icon: '☕',
    status: 'Needs Review',
    lat: '13.7',
    lng: '100.5',
    maps: 'https://maps.example/sample',
    src: 'Threads',
    sourceUrl: 'https://threads.example/sample',
    approx: '',
  };
}

test('index exposes only the view-first controls and issue report form', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  for (const token of REMOVED_UI_TOKENS) {
    assert.doesNotMatch(html, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(html, /id="issue-btn"/);
  assert.match(html, /id="issue-modal"/);
  assert.match(html, /name="issue-report"/);
});

test('list and popup do not expose status, edit actions, or duplicate badges', () => {
  const elements = { 'loc-list': { innerHTML: '' } };
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => elements[id] ?? null };

  try {
    state.isLoading = false;
    state.data = [makeLocation()];
    state.visIdx = [0];
    state.favorites = new Set();

    renderList();
    const listHtml = elements['loc-list'].innerHTML;
    const popupHtml = buildPopupContent(0);

    for (const html of [listHtml, popupHtml]) {
      assert.doesNotMatch(html, /Needs Review|待確認|b-verified|b-review|b-notfound/);
      assert.doesNotMatch(html, /card-edit-btn|openEditModal|b-dup/);
    }
    assert.match(listHtml, /Sample Cafe|範例咖啡廳/);
    assert.match(popupHtml, /Sample Cafe|範例咖啡廳/);
  } finally {
    globalThis.document = previousDocument;
    state.data = [];
    state.visIdx = [];
    state.favorites = new Set();
    state.isLoading = true;
  }
});

test('markers use one status-independent marker class', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ className: '', textContent: '' }),
  };

  try {
    const marker = makeMarkerContent('☕');
    assert.equal(marker.className, 'marker-dot');
    assert.equal(marker.textContent, '☕');
  } finally {
    globalThis.document = previousDocument;
  }
});
