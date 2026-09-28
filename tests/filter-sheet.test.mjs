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
  'cat-filter', 'label-filter', 'filter-count-badge', 'filter-open-btn',
  'active-chips', 'active-chips-list', 'filter-sheet-done',
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

test('summary renders badge, chips, and result count from current controls', () => {
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
  assert.equal(elements.get('active-chips').hidden, false);
  const chips = elements.get('active-chips-list').children;
  assert.deepEqual(chips.map(chip => [chip.dataset.filter, chip.dataset.value]), [
    ['category', '餐廳'], ['destination', 'bangkok'],
  ]);
  assert.equal(chips[0].getAttribute('aria-label'), '移除篩選：餐廳');
  assert.equal(elements.get('filter-sheet-done').textContent, '顯示 3 個地點');

  elements.get('cat-filter').value = '';
  state.selectedDestinations = new Set();
  renderActiveFilters(documentRoot);
  assert.equal(badge.hidden, true);
  assert.equal(elements.get('active-chips').hidden, true);
  assert.equal(elements.get('active-chips-list').children.length, 0);
});

test('summary rendering is a no-op when filter controls are absent', () => {
  const { documentRoot } = makeDocument([]);
  assert.doesNotThrow(() => renderActiveFilters(documentRoot));
});

function makeSheet() {
  const { documentRoot, elements } = makeDocument([
    ...SUMMARY_IDS, 'filter-sheet', 'filter-sheet-body', 'filter-controls-slot',
    'filter-controls', 'filter-sheet-reset', 'active-chips-clear',
  ]);
  const dialog = Object.assign(elements.get('filter-sheet'), {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; this.dispatchEvent(new Event('close')); },
    getBoundingClientRect: () => ({ left: 0, top: 300, right: 375, bottom: 800 }),
  });
  elements.get('filter-controls-slot').append(elements.get('filter-controls'));
  const calls = [];
  const mobileQuery = new EventTarget();
  const controller = initFilterSheet({
    documentRoot,
    mobileQuery,
    beforeOpen: () => calls.push(['beforeOpen']),
    onRemove: filter => calls.push(['remove', filter]),
    onClearAll: () => calls.push(['clearAll']),
  });
  return { documentRoot, elements, dialog, controller, calls, mobileQuery };
}

test('opening moves the single controls node into the sheet and closing restores it', () => {
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
  assert.equal(controls.parent, elements.get('filter-controls-slot'));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(documentRoot.activeElement, trigger);
});

test('leaving the mobile breakpoint closes an open sheet', () => {
  const { elements, dialog, controller, mobileQuery } = makeSheet();
  controller.open();
  mobileQuery.dispatchEvent(Object.assign(new Event('change'), { matches: false }));
  assert.equal(dialog.open, false);
  assert.equal(elements.get('filter-controls').parent, elements.get('filter-controls-slot'));
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

test('chip and clear buttons delegate removal to the caller', () => {
  const { documentRoot, elements, calls } = makeSheet();
  const chip = documentRoot.createElement('button');
  chip.className = 'active-chip';
  chip.dataset.filter = 'destination';
  chip.dataset.value = 'bangkok';
  elements.get('active-chips-list').append(chip);

  const click = new Event('click');
  Object.defineProperty(click, 'target', { value: chip });
  elements.get('active-chips-list').dispatchEvent(click);
  elements.get('active-chips-clear').dispatchEvent(new Event('click'));
  elements.get('filter-sheet-reset').dispatchEvent(new Event('click'));

  assert.deepEqual(calls, [
    ['remove', { filter: 'destination', value: 'bangkok' }],
    ['clearAll'],
    ['clearAll'],
  ]);
});

test('init returns null when the sheet markup is missing', () => {
  const { documentRoot } = makeDocument([]);
  assert.equal(initFilterSheet({ documentRoot, onRemove() {}, onClearAll() {} }), null);
});

test('markup keeps one controls node inside the inline slot and a search-row trigger', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const searchRow = html.match(/<div class="search-row">[\s\S]*?<!-- Desktop renders/);
  assert.ok(searchRow, 'search row should precede the controls slot');
  assert.match(searchRow[0], /id="search"/);
  assert.match(searchRow[0], /id="filter-open-btn"[^>]*aria-controls="filter-sheet"/);
  assert.match(searchRow[0], /id="fav-filter-btn"/);
  assert.equal(html.match(/id="filter-controls"/g)?.length, 1);
  assert.ok(html.indexOf('id="filter-controls-slot"') < html.indexOf('id="filter-controls"'));
  assert.ok(html.indexOf('id="filter-controls"') < html.indexOf('id="cat-filter"'));
  assert.match(html, /<dialog class="filter-sheet" id="filter-sheet"/);
});

test('mobile sheet styles stay behind the 700px breakpoint', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.filter-open-btn,\.active-chips,\.filter-sheet\{display:none\}/);
  assert.match(css, /@media\(max-width:700px\)\{\s*\.filter-controls-slot\{display:none\}/);
  // Destination keeps its toggle in the sheet and expands in place instead of floating.
  assert.doesNotMatch(css, /\.filter-sheet \.dest-filter-menu\[hidden\]/);
  assert.doesNotMatch(css, /\.filter-sheet \.dest-filter-btn\{display:none\}/);
  assert.match(css, /\.filter-sheet \.dest-filter-menu\{position:static;[^}]*max-height:none!important/);
});
