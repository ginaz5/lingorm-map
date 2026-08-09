import {
  COUNTRIES,
  DESTINATIONS,
  DESTINATION_KEYS,
  countryLabel,
  destinationLabel,
} from '../data/destinations.js';
import { lang, t } from '../core/i18n.js';
import { state } from '../core/state.js';

export const DESTINATION_FILTER_STORAGE_KEY = 'destinationFilters';

/** @param {string} id @returns {HTMLElement} */
function requiredElement(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el;
}

/** @returns {Set<string>} */
function availableDestinationKeys() {
  return new Set(
    state.data
      .filter(row => row.status === 'Published' && row.destinationKey)
      .map(row => row.destinationKey)
  );
}

/**
 * @param {string} countryCode
 * @param {Set<string>} availableKeys
 * @returns {{ checked: boolean, indeterminate: boolean }}
 */
export function countrySelectionState(countryCode, availableKeys) {
  const keys = DESTINATIONS
    .filter(destination =>
      destination.countryCode === countryCode &&
      availableKeys.has(destination.key)
    )
    .map(destination => destination.key);
  const selected = keys.filter(key => state.selectedDestinations.has(key)).length;
  return {
    checked: keys.length > 0 && selected === keys.length,
    indeterminate: selected > 0 && selected < keys.length,
  };
}

/**
 * @param {string} countryCode
 * @param {Set<string>} availableKeys
 */
export function toggleCountryDestinations(countryCode, availableKeys) {
  const keys = DESTINATIONS
    .filter(destination =>
      destination.countryCode === countryCode &&
      availableKeys.has(destination.key)
    )
    .map(destination => destination.key);
  const allSelected = keys.every(key => state.selectedDestinations.has(key));
  keys.forEach(key => {
    if (allSelected) state.selectedDestinations.delete(key);
    else state.selectedDestinations.add(key);
  });
}

export function loadDestinationFilter() {
  const knownKeys = new Set(DESTINATION_KEYS);
  try {
    const parsed = JSON.parse(localStorage.getItem(DESTINATION_FILTER_STORAGE_KEY) || '[]');
    state.selectedDestinations = new Set(
      Array.isArray(parsed)
        ? parsed.filter(key => typeof key === 'string' && knownKeys.has(key))
        : []
    );
  } catch (_) {
    state.selectedDestinations = new Set();
  }
  state.pendingDestinationFit = state.selectedDestinations.size > 0;
}

export function saveDestinationFilter() {
  try {
    localStorage.setItem(
      DESTINATION_FILTER_STORAGE_KEY,
      JSON.stringify([...state.selectedDestinations].sort())
    );
  } catch (_) {
    // Filtering remains usable when storage is unavailable.
  }
}

/**
 * Remove saved selections that are no longer present in the loaded public
 * snapshot. Keep selections untouched when no public data is available, since
 * that can indicate a transient loading failure rather than removed content.
 * @returns {boolean} whether the saved selection changed
 */
export function reconcileDestinationFilter() {
  const availableKeys = availableDestinationKeys();
  if (availableKeys.size === 0) return false;

  const availableSelection = new Set(
    [...state.selectedDestinations].filter(key => availableKeys.has(key))
  );
  if (availableSelection.size === state.selectedDestinations.size) return false;

  state.selectedDestinations = availableSelection;
  state.pendingDestinationFit = availableSelection.size > 0;
  saveDestinationFilter();
  return true;
}

export function closeDestinationFilter() {
  const button = document.getElementById('dest-filter-btn');
  const menu = document.getElementById('dest-filter-menu');
  if (!button || !menu) return;
  button.setAttribute('aria-expanded', 'false');
  menu.hidden = true;
}

export function renderDestinationFilter() {
  const buttonLabel = requiredElement('dest-filter-label');
  const selectedCount = state.selectedDestinations.size;
  buttonLabel.textContent = selectedCount
    ? t('dest_filter_count', selectedCount)
    : t('all_destinations');

  const groups = requiredElement('dest-filter-groups');
  const availableKeys = availableDestinationKeys();
  const countriesHtml = COUNTRIES.map(country => {
    const destinations = DESTINATIONS.filter(destination =>
      destination.countryCode === country.code &&
      availableKeys.has(destination.key)
    );
    if (!destinations.length) return '';
    return `<fieldset class="dest-country-group">
      <legend class="sr-only">${countryLabel(country, lang)}</legend>
      <label class="dest-option dest-country-option">
        <input type="checkbox" data-country-code="${country.code}">
        <span class="dest-check" aria-hidden="true"></span>
        <span class="dest-flag" aria-hidden="true">${country.flag}</span>
        <span>${countryLabel(country, lang)}</span>
      </label>
      <div class="dest-country-children">
        ${destinations.map(destination => `<label class="dest-option">
          <input type="checkbox" value="${destination.key}"
            ${state.selectedDestinations.has(destination.key) ? 'checked' : ''}>
          <span class="dest-check" aria-hidden="true"></span>
          <span>${destinationLabel(destination, lang)}</span>
        </label>`).join('')}
      </div>
    </fieldset>`;
  }).join('');

  groups.innerHTML = countriesHtml;

  const allInput = /** @type {HTMLInputElement} */ (requiredElement('dest-filter-all'));
  allInput.checked = selectedCount === 0;

  groups.querySelectorAll('input[data-country-code]').forEach(rawInput => {
    const input = /** @type {HTMLInputElement} */ (rawInput);
    const countryCode = input.dataset.countryCode || '';
    const selection = countrySelectionState(countryCode, availableKeys);
    input.checked = selection.checked;
    input.indeterminate = selection.indeterminate;
  });
}

/**
 * Keep the destination menu inside the visible list panel so its own scroll
 * area can reach the final option above the mobile tab bar.
 * @param {HTMLElement} button
 * @param {HTMLElement} menu
 * @param {number} panelBottom
 * @returns {number}
 */
export function fitDestinationMenuHeight(button, menu, panelBottom) {
  const menuTop = button.getBoundingClientRect().bottom + 6;
  const availableHeight = Math.max(0, Math.floor(panelBottom - menuTop - 8));
  const maxHeight = Math.min(460, availableHeight);
  menu.style.maxHeight = `${maxHeight}px`;
  return maxHeight;
}

/**
 * @param {(change: {filterValue: string, filterAction: 'select'|'deselect'|'clear'}) => void} onSelectionChange
 */
export function initDestinationFilter(onSelectionChange) {
  loadDestinationFilter();
  renderDestinationFilter();

  const button = requiredElement('dest-filter-btn');
  const menu = requiredElement('dest-filter-menu');
  const groups = requiredElement('dest-filter-groups');
  const allInput = /** @type {HTMLInputElement} */ (requiredElement('dest-filter-all'));
  const clearButton = requiredElement('dest-filter-clear');

  function fitOpenMenu() {
    const panel = requiredElement('panel');
    fitDestinationMenuHeight(button, menu, panel.getBoundingClientRect().bottom);
  }

  button.addEventListener('click', event => {
    event.stopPropagation();
    const willOpen = menu.hidden;
    if (willOpen) fitOpenMenu();
    menu.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
  });
  menu.addEventListener('click', event => event.stopPropagation());

  allInput.addEventListener('change', () => {
    state.selectedDestinations.clear();
    saveDestinationFilter();
    renderDestinationFilter();
    onSelectionChange({ filterValue: 'all', filterAction: 'clear' });
  });

  clearButton.addEventListener('click', () => {
    state.selectedDestinations.clear();
    saveDestinationFilter();
    renderDestinationFilter();
    onSelectionChange({ filterValue: 'all', filterAction: 'clear' });
  });

  groups.addEventListener('change', event => {
    const input = /** @type {HTMLInputElement|null} */ (
      event.target instanceof HTMLInputElement ? event.target : null
    );
    if (!input) return;
    const availableKeys = availableDestinationKeys();
    const countryCode = input.dataset.countryCode;
    let filterValue = '';
    if (countryCode) {
      toggleCountryDestinations(countryCode, availableKeys);
      filterValue = `country:${countryCode}`;
    } else if (input.value) {
      if (input.checked) state.selectedDestinations.add(input.value);
      else state.selectedDestinations.delete(input.value);
      filterValue = `destination:${input.value}`;
    }
    saveDestinationFilter();
    renderDestinationFilter();
    onSelectionChange({
      filterValue,
      filterAction: input.checked ? 'select' : 'deselect',
    });
  });

  document.addEventListener('click', closeDestinationFilter);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || menu.hidden) return;
    closeDestinationFilter();
    button.focus();
  });
  window.addEventListener('resize', () => {
    if (!menu.hidden) fitOpenMenu();
  });
}
