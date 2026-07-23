import { lang, setLang } from '../core/i18n.js';
import {
  applyFilters,
  buildCatFilter,
  updateLangUI,
} from '../ui/render.js';
import {
  fitMapToVisibleLocations,
  refreshActivePopup,
  syncVisibleMarkers,
} from '../map/map.js';
import { renderDestinationFilter } from '../features/destination-filter.js';
import { updateWhatsNewLangUI } from '../features/whats-new.js';

/**
 * Apply list filters, synchronize provider markers, and optionally fit the
 * active map to the resulting locations.
 * @param {{ fitMap?: boolean }} [options]
 */
export function applyFiltersAndSyncMap(options = {}) {
  applyFilters();
  syncVisibleMarkers();
  if (options.fitMap) fitMapToVisibleLocations();
}

export function toggleLang() {
  setLang(lang === 'zh' ? 'en' : 'zh');
  updateLangUI();
  updateWhatsNewLangUI();
  buildCatFilter();
  renderDestinationFilter();
  applyFiltersAndSyncMap();
  refreshActivePopup();
}
