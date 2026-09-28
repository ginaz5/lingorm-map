import { lang, t } from '../core/i18n.js';
import { state } from '../core/state.js';
import { DESTINATIONS, destinationLabel } from '../data/destinations.js';
import { locationTypeLabel } from '../data/location-types.js';

/** @typedef {'zh'|'en'} Language */
/** @typedef {{ filter: 'category'|'type'|'destination', value: string, label: string }} ActiveFilter */

/**
 * List the sheet-owned filters that are currently narrowing results, in the
 * same order the controls appear. Search and favorites stay visible in the
 * search row, so they are intentionally not repeated as chips.
 * @param {{ category: string, type: string, destinations: Iterable<string> }} input
 * @param {Language} language
 * @returns {ActiveFilter[]}
 */
export function listActiveFilters({ category, type, destinations }, language) {
  /** @type {ActiveFilter[]} */
  const filters = [];
  if (category) filters.push({ filter: 'category', value: category, label: category });
  if (type) filters.push({ filter: 'type', value: type, label: locationTypeLabel(type, language) });
  const selected = new Set(destinations);
  for (const destination of DESTINATIONS) {
    if (selected.has(destination.key)) {
      filters.push({
        filter: 'destination',
        value: destination.key,
        label: destinationLabel(destination, language),
      });
    }
  }
  return filters;
}

/** @param {Document} documentRoot @param {string} id @returns {HTMLSelectElement|null} */
function selectById(documentRoot, id) {
  return /** @type {HTMLSelectElement|null} */ (documentRoot.getElementById(id) ?? null);
}

/**
 * @param {Document} documentRoot
 * @param {ActiveFilter} filter
 * @returns {HTMLButtonElement}
 */
function createChip(documentRoot, filter) {
  const chip = documentRoot.createElement('button');
  chip.type = 'button';
  chip.className = 'active-chip';
  chip.dataset.filter = filter.filter;
  chip.dataset.value = filter.value;
  chip.setAttribute('aria-label', t('remove_filter', filter.label));
  const label = documentRoot.createElement('span');
  label.textContent = filter.label;
  const icon = documentRoot.createElement('span');
  icon.className = 'active-chip-x';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '×';
  chip.append(label, icon);
  return chip;
}

/**
 * Sync the mobile filter summary (badge, chips, sheet footer) with the
 * current controls. Safe to call when the mobile elements are absent.
 * @param {Document} [documentRoot]
 */
export function renderActiveFilters(documentRoot = document) {
  const category = selectById(documentRoot, 'cat-filter');
  const type = selectById(documentRoot, 'label-filter');
  if (!category || !type) return;

  const filters = listActiveFilters({
    category: category.value || '',
    type: type.value || '',
    destinations: state.selectedDestinations,
  }, lang);
  const count = filters.length;

  const badge = documentRoot.getElementById('filter-count-badge');
  if (badge) {
    badge.hidden = count === 0;
    badge.textContent = count ? String(count) : '';
  }
  documentRoot.getElementById('filter-open-btn')?.classList.toggle('is-active', count > 0);

  const chips = documentRoot.getElementById('active-chips');
  const list = documentRoot.getElementById('active-chips-list');
  if (chips && list) {
    chips.hidden = count === 0;
    list.replaceChildren(...filters.map(filter => createChip(documentRoot, filter)));
  }

  const done = documentRoot.getElementById('filter-sheet-done');
  if (done) {
    done.textContent = state.isLoading ? t('filter_done') : t('show_results', state.visIdx.length);
  }
}

/**
 * Mobile filter sheet. The single #filter-controls node moves into the dialog
 * while it is open and back to its inline slot on close, so existing control
 * IDs and listeners keep working without a duplicated DOM.
 * @param {{
 *   onRemove: (filter: Pick<ActiveFilter, 'filter'|'value'>) => void,
 *   onClearAll: () => void,
 *   beforeOpen?: () => void,
 *   documentRoot?: Document,
 *   mobileQuery?: MediaQueryList|null,
 * }} options
 */
export function initFilterSheet({
  onRemove,
  onClearAll,
  beforeOpen,
  documentRoot = document,
  mobileQuery,
}) {
  // Resolve the default here, not in the parameter list: esbuild lowers `?.`
  // for the chrome87 build target, and lowering inside a parameter default
  // emits a temp var scoped to a nested IIFE -> "r is not defined" at runtime.
  const mediaQuery = mobileQuery === undefined
    ? documentRoot.defaultView?.matchMedia?.('(max-width: 700px)') ?? null
    : mobileQuery;
  const dialogElement = /** @type {HTMLDialogElement|null} */ (documentRoot.getElementById('filter-sheet'));
  const triggerElement = documentRoot.getElementById('filter-open-btn');
  const bodyElement = documentRoot.getElementById('filter-sheet-body');
  const slotElement = documentRoot.getElementById('filter-controls-slot');
  const controlsElement = documentRoot.getElementById('filter-controls');
  if (!dialogElement || !triggerElement || !bodyElement || !slotElement || !controlsElement) return null;
  const dialog = dialogElement;
  const trigger = triggerElement;
  const body = bodyElement;
  const slot = slotElement;
  const controls = controlsElement;
  const chipsList = documentRoot.getElementById('active-chips-list');
  let startedOnBackdrop = false;

  function open() {
    if (dialog.open) return;
    beforeOpen?.();
    body.append(controls);
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  /** @param {MouseEvent} event */
  function isBackdrop(event) {
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom;
  }

  trigger.addEventListener('click', open);
  documentRoot.getElementById('filter-sheet-done')?.addEventListener('click', close);
  documentRoot.getElementById('filter-sheet-reset')?.addEventListener('click', onClearAll);
  documentRoot.getElementById('active-chips-clear')?.addEventListener('click', () => {
    onClearAll();
    trigger.focus();
  });

  chipsList?.addEventListener('click', event => {
    const target = /** @type {Element|null} */ (event.target);
    const chip = /** @type {HTMLElement|null} */ (
      typeof target?.closest === 'function' ? target.closest('.active-chip') : null
    );
    const filter = chip?.dataset.filter;
    const value = chip?.dataset.value;
    if (!filter || value === undefined) return;
    if (filter !== 'category' && filter !== 'type' && filter !== 'destination') return;
    onRemove({ filter, value });
    // The clicked chip was re-rendered away; keep keyboard focus in the row.
    const next = /** @type {HTMLElement|null} */ (chipsList.querySelector('.active-chip'));
    (next ?? trigger).focus();
  });

  dialog.addEventListener('pointerdown', event => { startedOnBackdrop = isBackdrop(event); });
  dialog.addEventListener('click', event => {
    if (startedOnBackdrop && isBackdrop(event)) close();
    startedOnBackdrop = false;
  });
  // Native Escape dismissal also fires close.
  dialog.addEventListener('close', () => {
    slot.append(controls);
    trigger.setAttribute('aria-expanded', 'false');
    if (trigger.getClientRects().length > 0) trigger.focus();
  });

  // Rotating or resizing into the desktop layout returns controls inline.
  mediaQuery?.addEventListener?.('change', event => {
    if (!event.matches) close();
  });

  return { open, close };
}
