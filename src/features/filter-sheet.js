import { lang, t } from '../core/i18n.js';
import { state } from '../core/state.js';
import { DESTINATIONS, destinationLabel } from '../data/destinations.js';
import { locationTypeLabel } from '../data/location-types.js';

/** @typedef {'zh'|'en'} Language */
/** @typedef {{ filter: 'category'|'type'|'destination', value: string, label: string }} ActiveFilter */

/**
 * List the sheet-owned filters that are currently narrowing results, in the
 * same order the controls appear. Search and favorites stay visible in the
 * search bar, so they are not counted on the Filters chip badge.
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
 * Sync the filter summary (count badge on the Filters chip, sheet footer)
 * with the current controls. Safe to call when the elements are absent.
 * @param {Document} [documentRoot]
 */
export function renderActiveFilters(documentRoot = document) {
  const category = selectById(documentRoot, 'cat-filter');
  const type = selectById(documentRoot, 'label-filter');
  if (!category || !type) return;

  const count = listActiveFilters({
    category: category.value || '',
    type: type.value || '',
    destinations: state.selectedDestinations,
  }, lang).length;

  const badge = documentRoot.getElementById('filter-count-badge');
  if (badge) {
    badge.hidden = count === 0;
    badge.textContent = count ? String(count) : '';
  }
  documentRoot.getElementById('filter-open-btn')?.classList.toggle('is-active', count > 0);

  const done = documentRoot.getElementById('filter-sheet-done');
  if (done) {
    done.textContent = state.isLoading ? t('filter_done') : t('show_results', state.visIdx.length);
  }
}

/**
 * The "all filters" sheet: a native modal <dialog> that holds the category,
 * collection, destination and exchange-sort controls. It is a bottom sheet
 * below 701px and a centered dialog above (styles.css); the controls never
 * move, so their IDs and listeners stay stable.
 * @param {{
 *   onClearAll: () => void,
 *   beforeOpen?: () => void,
 *   documentRoot?: Document,
 * }} options
 */
export function initFilterSheet({ onClearAll, beforeOpen, documentRoot = document }) {
  const dialogElement = /** @type {HTMLDialogElement|null} */ (documentRoot.getElementById('filter-sheet'));
  const triggerElement = documentRoot.getElementById('filter-open-btn');
  if (!dialogElement || !triggerElement) return null;
  const dialog = dialogElement;
  const trigger = triggerElement;
  /** @type {HTMLElement} */
  let returnFocus = trigger;
  let startedOnBackdrop = false;

  /** @param {HTMLElement} [from] element that gets focus back on close */
  function open(from = trigger) {
    if (dialog.open) return;
    beforeOpen?.();
    returnFocus = from;
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

  trigger.addEventListener('click', () => open(trigger));
  documentRoot.getElementById('filter-sheet-done')?.addEventListener('click', close);
  documentRoot.getElementById('filter-sheet-reset')?.addEventListener('click', onClearAll);

  dialog.addEventListener('pointerdown', event => { startedOnBackdrop = isBackdrop(event); });
  dialog.addEventListener('click', event => {
    if (startedOnBackdrop && isBackdrop(event)) close();
    startedOnBackdrop = false;
  });
  // Native Escape dismissal also fires close.
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    const target = returnFocus.getClientRects().length > 0 ? returnFocus : trigger;
    target.focus();
  });

  return { open, close };
}
