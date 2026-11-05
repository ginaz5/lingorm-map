import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { state } from '../src/core/state.js';
import { initFilterChips, listFilterChips, renderFilterChips } from '../src/features/filter-chips.js';
import { element } from './helpers/map-first-dom.mjs';

const row = (catEn, catZh, type, icon) => ({
  catEn, catZh, type, icon, status: 'Published', id: `${catEn}-${type}-${icon}`,
  nameEn: '', nameZh: '', lat: '13.7', lng: '100.5',
});
const ROWS = [
  row('Cafe', '咖啡廳', 'LingOrm', '☕'),
  row('Cafe', '咖啡廳', 'JKR Picks', '🧋'),
  row('Cafe', '咖啡廳', 'LingOrm', '☕'),
  row('Restaurant', '餐廳', 'LingOrm', '🍜'),
  row('Currency Exchange', '換匯', 'Currency Exchange', '💱'),
  row('', '', '', '📍'),
];

const previousState = { ...state };
afterEach(() => Object.assign(state, previousState));

test('collections come first in canonical order, then categories by size', () => {
  const chips = listFilterChips(ROWS, 'zh', { category: '餐廳', type: '' });
  assert.deepEqual(chips.map(chip => [chip.filter, chip.value, chip.label, chip.count]), [
    ['type', 'LingOrm', 'LingOrm', 3],
    ['type', 'JKR Picks', 'JKR 推薦', 1],
    // The "Currency Exchange" collection repeats the 換匯 category label, so
    // only the category chip is shown.
    ['category', '咖啡廳', '咖啡廳', 3],
    ['category', '換匯', '換匯', 1],
    ['category', '餐廳', '餐廳', 1],
  ]);
  assert.equal(chips.find(chip => chip.value === '咖啡廳')?.icon, '☕', 'most common icon');
  assert.deepEqual(chips.filter(chip => chip.selected).map(chip => chip.value), ['餐廳']);
});

test('category chip values follow the UI language like the category select', () => {
  const chips = listFilterChips(ROWS, 'en', { category: '', type: 'JKR Picks' });
  assert.ok(chips.some(chip => chip.filter === 'category' && chip.value === 'Cafe'));
  assert.deepEqual(chips.filter(chip => chip.selected).map(chip => chip.value), ['JKR Picks']);
});

function makeChipDocument() {
  const nodes = [];
  const container = element({
    childElementCount: 0,
    replaceChildren(...children) { nodes.splice(0, nodes.length, ...children); this.childElementCount = children.length; },
    contains: node => nodes.includes(node),
  });
  const elements = {
    'filter-chips': container,
    'cat-filter': element({ value: '' }),
    'label-filter': element({ value: '' }),
    'dest-chip': element(),
    'dest-chip-label': element(),
  };
  const documentRoot = {
    activeElement: null,
    getElementById: id => elements[id] ?? null,
    createElement: () => {
      const child = element({ children: [], append(...items) { this.children.push(...items); } });
      child.focus = () => { documentRoot.activeElement = child; };
      return child;
    },
  };
  return { documentRoot, elements, nodes };
}

test('chips mirror the selects and a tap toggles the select through a change event', () => {
  const { documentRoot, elements, nodes } = makeChipDocument();
  state.data = ROWS;
  state.selectedDestinations = new Set(['bangkok', 'pattaya']);
  initFilterChips({ documentRoot });
  renderFilterChips(documentRoot);

  const chips = nodes.filter(node => node.dataset.filter);
  assert.equal(nodes.filter(node => node.className === 'chip-divider').length, 1);
  assert.equal(elements['dest-chip-label'].textContent, '目的地（2）');
  assert.ok(elements['dest-chip'].classList.contains('is-selected'));

  const changes = [];
  elements['cat-filter'].addEventListener('change', () => changes.push(elements['cat-filter'].value));
  const cafe = chips.find(chip => chip.dataset.value === '咖啡廳');
  const tap = target => {
    const click = new Event('click');
    Object.defineProperty(click, 'target', { value: { closest: () => target } });
    elements['filter-chips'].dispatchEvent(click);
  };
  tap(cafe);
  assert.deepEqual(changes, ['咖啡廳']);

  // Re-render shows it selected; tapping a selected chip clears the filter.
  renderFilterChips(documentRoot);
  const selected = nodes.find(node => node.dataset.value === '咖啡廳');
  assert.equal(selected.getAttribute('aria-pressed'), 'true');
  tap(selected);
  assert.deepEqual(changes, ['咖啡廳', '']);
});

test('rendering is a no-op without the chip row markup', () => {
  assert.doesNotThrow(() => renderFilterChips({ getElementById: () => null }));
  assert.equal(initFilterChips({ documentRoot: { getElementById: () => null } }), null);
});

test('the destination chip keeps its click from the outside-click closer', () => {
  const { documentRoot, elements } = makeChipDocument();
  let opened = 0;
  initFilterChips({ documentRoot, onDestinationClick: () => { opened += 1; } });
  const click = new Event('click', { bubbles: true });
  elements['dest-chip'].dispatchEvent(click);
  assert.equal(opened, 1);
  // A bubbling click reaching document would run closeDestinationFilter and
  // close the list this chip just opened.
  assert.equal(click.cancelBubble, true);
});
