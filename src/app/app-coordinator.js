import { lang, setLang } from '../core/i18n.js';
import {
  applyFilters,
  buildCatFilter,
  buildTypeFilter,
  updateLangUI,
} from '../ui/render.js';
import {
  fitMapToVisibleLocations,
  refreshActivePopup,
  syncVisibleMarkers,
} from '../map/map.js';
import { renderDestinationFilter } from '../features/destination-filter.js';
import { updateWhatsNewLangUI } from '../features/whats-new.js';
import { trackLanguageChange } from '../services/analytics.js';
import { syncExchangeControls } from '../features/exchange-rates.js';
import { DENOMS } from '../data/exchange-rates.js';
import { state } from '../core/state.js';
import { switchTab } from '../ui/ui.js';

/**
 * Apply list filters, synchronize provider markers, and optionally fit the
 * active map to the resulting locations.
 * @param {{ fitMap?: boolean, exchangeSortChanged?: boolean }} [options]
 */
export function applyFiltersAndSyncMap(options = {}) {
  applyFilters();
  syncVisibleMarkers();
  if (options.fitMap) fitMapToVisibleLocations();
  if (options.exchangeSortChanged && DENOMS.includes(/** @type {any} */ (state.exchangeSort))) {
    switchTab('list');
    const list = document.getElementById('loc-list');
    if (list) list.scrollTop = 0;
  }
}

export function toggleLang() {
  const previousLang = lang;
  const nextLang = previousLang === 'zh' ? 'en' : 'zh';
  setLang(nextLang);
  updateLangUI();
  updateWhatsNewLangUI();
  syncExchangeControls();
  buildCatFilter();
  buildTypeFilter();
  renderDestinationFilter();
  applyFiltersAndSyncMap();
  refreshActivePopup();
  trackLanguageChange(previousLang, nextLang);
}
