import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { state } from '../src/core/state.js';
import {
  initFilterSheet,
  listActiveFilters,
  renderActiveFilters,
} from '../src/features/filter-sheet.js';

function makeElement(documentRoot, tagName = 'div') {
  return Object.assign(new EventTarget(), {
    tagName,
    children: [],
    parent: null,
    hidden: false,
    textContent: '',
    value: '',
    type: '',
    className: '',
    dataset: {},
    visible: true,
    attributes: new Map(),
    classes: new Set(),
    classList: {
      toggle(name, force) {
        const owner = this.owner;
        const on = force ?? !owner.classes.has(name);
        if (on) owner.classes.add(name); else owner.classes.delete(name);
      },
    },
    setAttribute(name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name); },
    append(...nodes) {
      for (const node of nodes) {
        if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node);
        node.parent = this;
        this.children.push(node);
      }
    },
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    },
    querySelector(selector) {
      return selector === '.active-chip'
        ? this.children.find(child => child.className === 'active-chip') ?? null
        : null;
    },
    closest(selector) {
      return selector === '.active-chip' && this.className === 'active-chip' ? this : null;
    },
    getClientRects() { return this.visible ? [{}] : []; },
    focus() { documentRoot.activeElement = this; },
  });
}

function makeDocument(ids) {
  const elements = new Map();
  const documentRoot = {
    activeElement: null,
    getElementById: id => elements.get(id) ?? null,
    createElement: tagName => {
      const element = makeElement(documentRoot, tagName);
      element.classList.owner = element;
      return element;
    },
  };
  for (const id of ids) elements.set(id, documentRoot.createElement());
  return { documentRoot, elements };
}

const SUMMARY_IDS = [
  'cat-filter', 'label-filter', 'filter-count-badge', 'filter-open-btn', 'filter-sheet-done',
];

test('active filters follow control order and localize labels', () => {
  const input = { category: '餐廳', type: 'Admin Picks', destinations: ['chiang-mai', 'bangkok'] };
  assert.deepEqual(listActiveFilters(input, 'zh'), [
    { filter: 'category', value: '餐廳', label: '餐廳' },
    { filter: 'type', value: 'Admin Picks', label: '留友看' },
    { filter: 'destination', value: 'bangkok', label: '曼谷' },
    { filter: 'destination', value: 'chiang-mai', label: '清邁' },
  ]);
  assert.equal(listActiveFilters({ category: '', type: '', destinations: [] }, 'en').length, 0);
});

test('summary renders the Filters chip badge and result count from current controls', () => {
  const { documentRoot, elements } = makeDocument(SUMMARY_IDS);
  elements.get('cat-filter').value = '餐廳';
  state.selectedDestinations = new Set(['bangkok']);
  state.visIdx = [1, 2, 3];
  state.isLoading = false;

  renderActiveFilters(documentRoot);

  const badge = elements.get('filter-count-badge');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '2');
  assert.ok(elements.get('filter-open-btn').classes.has('is-active'));
  assert.equal(elements.get('filter-sheet-done').textContent, '顯示 3 個地點');

  elements.get('cat-filter').value = '';
  state.selectedDestinations = new Set();
  renderActiveFilters(documentRoot);
  assert.equal(badge.hidden, true);
  assert.equal(elements.get('filter-open-btn').classes.has('is-active'), false);
});

test('summary rendering is a no-op when filter controls are absent', () => {
  const { documentRoot } = makeDocument([]);
  assert.doesNotThrow(() => renderActiveFilters(documentRoot));
});

function makeSheet() {
  const { documentRoot, elements } = makeDocument([
    ...SUMMARY_IDS, 'filter-sheet', 'filter-sheet-body', 'filter-controls',
    'filter-sheet-reset', 'dest-chip',
  ]);
  const dialog = Object.assign(elements.get('filter-sheet'), {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; this.dispatchEvent(new Event('close')); },
    getBoundingClientRect: () => ({ left: 0, top: 300, right: 375, bottom: 800 }),
  });
  elements.get('filter-sheet-body').append(elements.get('filter-controls'));
  const calls = [];
  const controller = initFilterSheet({
    documentRoot,
    beforeOpen: () => calls.push(['beforeOpen']),
    onClearAll: () => calls.push(['clearAll']),
  });
  return { documentRoot, elements, dialog, controller, calls };
}

test('the Filters chip opens the sheet and Done restores focus to it', () => {
  const { documentRoot, elements, dialog, calls } = makeSheet();
  const trigger = elements.get('filter-open-btn');
  const controls = elements.get('filter-controls');

  trigger.dispatchEvent(new Event('click'));
  assert.equal(dialog.open, true);
  assert.equal(controls.parent, elements.get('filter-sheet-body'));
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(calls, [['beforeOpen']]);

  elements.get('filter-sheet-done').dispatchEvent(new Event('click'));
  assert.equal(dialog.open, false);
  assert.equal(controls.parent, elements.get('filter-sheet-body'));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(documentRoot.activeElement, trigger);
});

test('a sheet opened from another chip returns focus to that chip', () => {
  const { documentRoot, elements, dialog, controller } = makeSheet();
  const destChip = elements.get('dest-chip');
  controller.open(destChip);
  assert.equal(dialog.open, true);
  dialog.close();
  assert.equal(documentRoot.activeElement, destChip);

  destChip.visible = false;
  controller.open(destChip);
  dialog.close();
  assert.equal(documentRoot.activeElement, elements.get('filter-open-btn'));
});

test('only a backdrop gesture outside the sheet dismisses it', () => {
  const { dialog, controller } = makeSheet();
  const pointer = (type, y) => Object.assign(new Event(type), { clientX: 100, clientY: y });
  controller.open();
  for (const event of [pointer('pointerdown', 400), pointer('click', 400)]) {
    Object.defineProperty(event, 'target', { value: dialog });
    dialog.dispatchEvent(event);
  }
  assert.equal(dialog.open, true);
  for (const event of [pointer('pointerdown', 100), pointer('click', 100)]) {
    Object.defineProperty(event, 'target', { value: dialog });
    dialog.dispatchEvent(event);
  }
  assert.equal(dialog.open, false);
});

test('the sheet reset delegates clearing to the caller', () => {
  const { elements, calls } = makeSheet();
  elements.get('filter-sheet-reset').dispatchEvent(new Event('click'));
  assert.deepEqual(calls, [['clearAll']]);
});

test('init returns null when the sheet markup is missing', () => {
  const { documentRoot } = makeDocument([]);
  assert.equal(initFilterSheet({ documentRoot, onClearAll() {} }), null);
});

test('markup keeps the controls inside the sheet and the Filters chip in the chip row', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const chipRow = html.match(/<div class="chip-row" id="chip-row">[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
  const searchBar = html.match(/<div class="search-bar" role="search">[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.match(searchBar, /id="search"/);
  assert.match(searchBar, /id="fav-filter-btn"/);
  assert.match(chipRow, /id="filter-open-btn"[^>]*aria-controls="filter-sheet"/);
  assert.match(chipRow, /id="dest-chip"[^>]*aria-controls="filter-sheet"/);
  assert.match(chipRow, /id="filter-chips"/);
  assert.equal(html.match(/id="filter-controls"/g)?.length, 1);
  const sheet = html.match(/<dialog class="filter-sheet" id="filter-sheet"[\s\S]*?<\/dialog>/)?.[0] ?? '';
  assert.ok(sheet.indexOf('id="filter-sheet-body"') < sheet.indexOf('id="filter-controls"'));
  assert.ok(sheet.indexOf('id="filter-controls"') < sheet.indexOf('id="cat-filter"'));
  assert.doesNotMatch(html, /filter-controls-slot|active-chips/);
});

test('filter sheet is a centered dialog on desktop and a bottom sheet on mobile', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.filter-sheet\{width:min\(440px,calc\(100vw - 32px\)\);[^}]*margin:auto;/);
  assert.match(css, /@media\(max-width:700px\)\{\s*\.filter-sheet\{position:fixed;inset:auto 0 0;/);
  // Destination keeps its toggle in the sheet and expands in place instead of floating.
  assert.doesNotMatch(css, /\.filter-sheet \.dest-filter-menu\[hidden\]/);
  assert.doesNotMatch(css, /\.filter-sheet \.dest-filter-btn\{display:none\}/);
  assert.match(css, /\.filter-sheet \.dest-filter-menu\{position:static;[^}]*max-height:none!important/);
});
