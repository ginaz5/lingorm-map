// ═══════════════════════════════════════════════════
// FILTER CHIPS — one-tap collection and category filters
// ═══════════════════════════════════════════════════
// The chip row under the search bar mirrors the #label-filter (collection)
// and #cat-filter (category) selects in the filter sheet. The selects stay the
// single source of truth: a chip sets its select's value and dispatches a
// `change` event, so filtering and analytics run through the same listeners
// as the sheet. Chips are single-select per group, like the selects.

import { lang, t } from '../core/i18n.js';
import { state } from '../core/state.js';
import { LOCATION_TYPES, locationTypeLabel } from '../data/location-types.js';
import { isPublicLocation } from '../ui/render.js';

/** @typedef {import('../data/csv-parser.js').LocationRow} LocationRow */
/** @typedef {'type'|'category'} ChipFilter */
/**
 * @typedef {Object} FilterChip
 * @property {ChipFilter} filter
 * @property {string} value select option value
 * @property {string} label
 * @property {string} icon
 * @property {number} count
 * @property {boolean} selected
 */

const SELECT_IDS = Object.freeze({ type: 'label-filter', category: 'cat-filter' });

/**
 * Build the chip list: collections first (curated LingOrm groupings, in their
 * canonical order), then categories by size. A collection whose label repeats
 * a category label (e.g. currency exchange) is left to the category chip so
 * the row never shows two identical chips.
 * @param {readonly LocationRow[]} rows public rows only
 * @param {'zh'|'en'} language
 * @param {{ category: string, type: string }} selected current select values
 * @returns {FilterChip[]}
 */
export function listFilterChips(rows, language, selected) {
  /** @type {Map<string, { count: number, icons: Map<string, number> }>} */
  const categories = new Map();
  /** @type {Map<string, number>} */
  const types = new Map();
  for (const row of rows) {
    const category = language === 'zh' ? row.catZh : row.catEn;
    if (category) {
      const entry = categories.get(category) ?? { count: 0, icons: new Map() };
      entry.count += 1;
      if (row.icon) entry.icons.set(row.icon, (entry.icons.get(row.icon) ?? 0) + 1);
      categories.set(category, entry);
    }
    if (row.type) types.set(row.type, (types.get(row.type) ?? 0) + 1);
  }

  /** @type {FilterChip[]} */
  const categoryChips = [...categories.entries()]
    .sort(([leftLabel, left], [rightLabel, right]) =>
      right.count - left.count || leftLabel.localeCompare(rightLabel))
    .map(([label, entry]) => ({
      filter: /** @type {const} */ ('category'),
      value: label,
      label,
      icon: [...entry.icons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
      count: entry.count,
      selected: selected.category === label,
    }));
  const categoryLabels = new Set(categoryChips.map(chip => chip.label.toLowerCase()));

  /** @type {FilterChip[]} */
  const typeChips = LOCATION_TYPES
    .filter(type => types.has(type))
    .map(type => ({
      filter: /** @type {const} */ ('type'),
      value: type,
      label: locationTypeLabel(type, language),
      icon: '',
      count: types.get(type) ?? 0,
      selected: selected.type === type,
    }))
    .filter(chip => !categoryLabels.has(chip.label.toLowerCase()));

  return [...typeChips, ...categoryChips];
}

/** @param {Document} documentRoot @param {string} id @returns {HTMLSelectElement|null} */
function selectById(documentRoot, id) {
  return /** @type {HTMLSelectElement|null} */ (documentRoot.getElementById(id) ?? null);
}

/** @param {Document} documentRoot @param {FilterChip} chip */
function createChipButton(documentRoot, chip) {
  const button = documentRoot.createElement('button');
  button.type = 'button';
  button.className = `chip${chip.selected ? ' is-selected' : ''}`;
  button.dataset.filter = chip.filter;
  button.dataset.value = chip.value;
  button.setAttribute('aria-pressed', String(chip.selected));
  if (chip.icon) {
    const icon = documentRoot.createElement('span');
    icon.className = 'chip-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = chip.icon;
    button.append(icon);
  }
  const label = documentRoot.createElement('span');
  label.textContent = chip.label;
  button.append(label);
  return button;
}

let lastSignature = '';

/**
 * Sync the chip row (and the destination chip label) with the selects and
 * loaded data. Cheap to call on every filter pass: it skips unchanged rows.
 * @param {Document} [documentRoot]
 */
export function renderFilterChips(documentRoot = document) {
  const container = documentRoot.getElementById('filter-chips');
  const category = selectById(documentRoot, SELECT_IDS.category);
  const type = selectById(documentRoot, SELECT_IDS.type);
  if (!container || !category || !type) return;

  const destinationCount = state.selectedDestinations.size;
  const destinationLabel = documentRoot.getElementById('dest-chip-label');
  if (destinationLabel) {
    destinationLabel.textContent = destinationCount
      ? t('dest_filter_count', destinationCount)
      : t('dest_filter');
  }
  documentRoot.getElementById('dest-chip')?.classList.toggle('is-selected', destinationCount > 0);

  const chips = listFilterChips(state.data.filter(isPublicLocation), lang, {
    category: category.value || '',
    type: type.value || '',
  });
  const signature = JSON.stringify(chips);
  if (signature === lastSignature && container.childElementCount > 0) return;
  lastSignature = signature;

  // Keep keyboard focus on the same chip across the re-render.
  const focused = /** @type {HTMLElement|null} */ (documentRoot.activeElement);
  const focusKey = focused && container.contains(focused)
    ? `${focused.dataset.filter}|${focused.dataset.value}` : null;

  const buttons = chips.map(chip => createChipButton(documentRoot, chip));
  const firstCategory = chips.findIndex(chip => chip.filter === 'category');
  /** @type {HTMLElement[]} */
  const nodes = [...buttons];
  if (firstCategory > 0) {
    const divider = documentRoot.createElement('span');
    divider.className = 'chip-divider';
    divider.setAttribute('aria-hidden', 'true');
    nodes.splice(firstCategory, 0, divider);
  }
  container.replaceChildren(...nodes);

  if (focusKey) {
    buttons.find(button => `${button.dataset.filter}|${button.dataset.value}` === focusKey)?.focus();
  }
}

/**
 * @param {{ documentRoot?: Document, onDestinationClick?: () => void }} [options]
 */
export function initFilterChips({ documentRoot = document, onDestinationClick } = {}) {
  const container = documentRoot.getElementById('filter-chips');
  if (!container) return null;

  container.addEventListener('click', event => {
    const target = /** @type {Element|null} */ (event.target);
    const chip = /** @type {HTMLElement|null} */ (
      typeof target?.closest === 'function' ? target.closest('.chip[data-filter]') : null
    );
    const filter = chip?.dataset.filter;
    const value = chip?.dataset.value;
    if (!chip || value === undefined || (filter !== 'type' && filter !== 'category')) return;
    const select = selectById(documentRoot, SELECT_IDS[filter]);
    if (!select) return;
    select.value = chip.getAttribute('aria-pressed') === 'true' ? '' : value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  documentRoot.getElementById('dest-chip')?.addEventListener('click', event => {
    // The document-level outside-click listener in destination-filter.js
    // would otherwise close the menu this click is about to open.
    event.stopPropagation();
    onDestinationClick?.();
  });
  return { render: () => renderFilterChips(documentRoot) };
}
