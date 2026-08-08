import { setLang, t } from './core/i18n.js';
import { state } from './core/state.js';
import {
  updateLangUI, buildCatFilter, buildTypeFilter,
  applyFilters, activateCard,
} from './ui/render.js';
import {
  getEffectiveTheme, switchTab,
  showSnackbar, locateMe, openNavigation, openInGoogleMaps,
} from './ui/ui.js';
import {
  openIssueModal, closeIssueModal, submitIssueReport,
  tryLoadSheet,
} from './features/forms.js';
import {
  initMap,
  loadMapScript,
  updateMapTheme,
  buildMarkers,
  fitMapToVisibleLocations,
} from './map/map.js';
import {
  applyFiltersAndSyncMap,
  toggleLang,
} from './app/app-coordinator.js';
import {
  loadFavorites,
  releasePointerFocus,
  toggleFavoriteWithNotice,
} from './features/favorites.js';
import { heartSVG } from './ui/render.js';
import { checkWhatsNew, closeWhatsNew } from './features/whats-new.js';
import {
  trackFavoriteToggle,
  trackFilterApply,
  trackSearchComplete,
  trackTabView,
} from './services/analytics.js';
import {
  initDestinationFilter,
  reconcileDestinationFilter,
  renderDestinationFilter,
} from './features/destination-filter.js';

// ═══════════════════════════════════════════════════
// REBUILD — called after data loads or changes
// ═══════════════════════════════════════════════════
function applyCoordinateJitter() {
  if (state.jitterApplied) return;
  state.jitterApplied = true;

  const coordMap = {};
  state.data.forEach(row => {
    if (!row.lat || !row.lng) return;
    const key = `${row.lat},${row.lng}`;
    if (!coordMap[key]) coordMap[key] = [];
    coordMap[key].push(row);
  });
  
  Object.values(coordMap).forEach(rows => {
    if (rows.length > 1) {
      const radius = 0.00008; // ~8 meters offset
      rows.forEach((row, idx) => {
        const angle = (idx / rows.length) * Math.PI * 2;
        const lat = parseFloat(row.lat) + radius * Math.cos(angle);
        const lng = parseFloat(row.lng) + radius * Math.sin(angle);
        row.lat = lat.toFixed(6);
        row.lng = lng.toFixed(6);
      });
    }
  });
}

function rebuild() {
  applyCoordinateJitter();
  buildCatFilter();
  buildTypeFilter();
  reconcileDestinationFilter();
  renderDestinationFilter();
  applyFilters();
  // Intentionally do not await: fitting reads only data/visIdx, not markers.
  if (state.map) void buildMarkers();
  if (state.selectedDestinations.size > 0) fitMapToVisibleLocations();
}

// ═══════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════
function cycleTheme() {
  const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme();
}

function applyTheme() {
  const theme = getEffectiveTheme();
  document.documentElement.dataset.theme = theme;

  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) themeBtn.setAttribute('aria-pressed', String(theme === 'dark'));

  updateMapTheme();
}

function closeMobileActions() {
  const btn = document.getElementById('mobile-actions-btn');
  const menu = document.getElementById('mobile-actions-menu');
  btn.setAttribute('aria-expanded', 'false');
  menu.hidden = true;
}

function toggleMobileActions(event) {
  event.stopPropagation();
  const btn = document.getElementById('mobile-actions-btn');
  const menu = document.getElementById('mobile-actions-menu');
  const isOpen = !menu.hidden;
  menu.hidden = isOpen;
  btn.setAttribute('aria-expanded', String(!isOpen));
}

function runMobileAction(event) {
  const action = event.currentTarget.dataset.mobileAction;
  closeMobileActions();
  if (action === 'issue') openIssueModal();
}

/**
 * @param {string} id
 * @param {Event & {detail?: number}} [event]
 * @param {'list_card'|'popup'|'unknown'} [source]
 */
function handleFavoriteClick(id, event, source = 'unknown') {
  toggleFavoriteWithNotice(id, event, () => {
    showSnackbar(t('favorite_storage_notice'), 6000);
  });
  const row = state.data.find(location => location.id === id);
  if (row) {
    trackFavoriteToggle(row, state.favorites.has(id) ? 'add' : 'remove', source);
  }
}

/** @param {string} value @returns {string} */
function canonicalCategory(value) {
  if (!value) return 'all';
  const row = state.data.find(location =>
    location.catEn === value || location.catZh === value
  );
  return row?.catEn || value;
}

/** @type {ReturnType<typeof setTimeout>|null} */
let searchAnalyticsTimer = null;

function handleSearchInput() {
  applyFiltersAndSyncMap();
  if (searchAnalyticsTimer !== null) clearTimeout(searchAnalyticsTimer);

  const queryLength = document.getElementById('search').value.trim().length;
  if (queryLength === 0 || state.isLoading) {
    searchAnalyticsTimer = null;
    return;
  }
  const resultCount = state.visIdx.length;
  searchAnalyticsTimer = setTimeout(() => {
    trackSearchComplete(queryLength, resultCount);
    searchAnalyticsTimer = null;
  }, 700);
}

/** @param {'category'|'type'} filterType @param {HTMLSelectElement} select */
function handleSelectFilter(filterType, select) {
  applyFiltersAndSyncMap();
  const value = filterType === 'category'
    ? canonicalCategory(select.value)
    : select.value || 'all';
  trackFilterApply(
    filterType,
    value,
    state.visIdx.length,
    value === 'all' ? 'clear' : 'set',
  );
}

// ═══════════════════════════════════════════════════
// EXPOSE FUNCTIONS USED IN TEMPLATE onclick STRINGS
// (inside JS template literals in renderList / buildPopupContent)
// ═══════════════════════════════════════════════════
window.activateCard = activateCard;
window.openNavigation = openNavigation;
window.openInGoogleMaps = openInGoogleMaps;
window.toggleFavorite = handleFavoriteClick;


// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
// Restore language preference
setLang(localStorage.getItem('lang') || 'zh');

// Restore favorites from URL or localStorage
loadFavorites();
initDestinationFilter(change => {
  applyFiltersAndSyncMap({ fitMap: true });
  trackFilterApply(
    'destination',
    change.filterValue,
    state.visIdx.length,
    change.filterAction,
    state.selectedDestinations.size,
  );
});

// Static event listeners
document.getElementById('fav-filter-btn').addEventListener('click', event => {
  state.favFilterOn = !state.favFilterOn;
  const favBtn = document.getElementById('fav-filter-btn');
  favBtn.classList.toggle('active', state.favFilterOn);
  favBtn.setAttribute('aria-pressed', String(state.favFilterOn));
  favBtn.innerHTML = heartSVG(state.favFilterOn);
  applyFiltersAndSyncMap();
  trackFilterApply(
    'favorites',
    state.favFilterOn ? 'on' : 'off',
    state.visIdx.length,
    state.favFilterOn ? 'enable' : 'disable',
    state.favFilterOn ? state.favorites.size : 0,
  );
  releasePointerFocus(event);
});
document.getElementById('search').addEventListener('input', handleSearchInput);
document.getElementById('cat-filter').addEventListener('change', event => {
  handleSelectFilter('category', /** @type {HTMLSelectElement} */ (event.currentTarget));
});
document.getElementById('type-filter').addEventListener('change', event => {
  handleSelectFilter('type', /** @type {HTMLSelectElement} */ (event.currentTarget));
});
document.getElementById('issue-btn').addEventListener('click', openIssueModal);
document.getElementById('locate-btn').addEventListener('click', locateMe);
document.getElementById('lang-btn').addEventListener('click', toggleLang);
document.getElementById('theme-btn')?.addEventListener('click', cycleTheme);
document.getElementById('mobile-actions-btn').addEventListener('click', toggleMobileActions);
document.querySelectorAll('[data-mobile-action]').forEach(btn => {
  btn.addEventListener('click', runMobileAction);
});
document.addEventListener('click', closeMobileActions);
document.getElementById('mobile-actions-menu').addEventListener('click', e => e.stopPropagation());

// Mobile tabs
document.getElementById('tab-map').addEventListener('click', () => {
  switchTab('map');
  trackTabView('map');
});
document.getElementById('tab-list').addEventListener('click', () => {
  switchTab('list');
  trackTabView('list');
});

// Modal backdrops (click outside = close)
document.getElementById('issue-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeIssueModal(); });

// Issue report modal
document.querySelector('#issue-modal .modal-close').addEventListener('click', closeIssueModal);
document.getElementById('issue-cancel-btn').addEventListener('click', closeIssueModal);
document.getElementById('issue-submit-btn').addEventListener('click', submitIssueReport);

// What's New modal
document.getElementById('whats-new-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeWhatsNew(); });
document.getElementById('wn-close-btn').addEventListener('click', closeWhatsNew);
document.getElementById('wn-got-it-btn').addEventListener('click', closeWhatsNew);

// Map resize on window resize
window.addEventListener('resize', () => {
  if (!state.map) return;
  if (state.provider === 'google') google.maps.event.trigger(state.map, 'resize');
  else state.map.getViewPort().resize();
});

// ─── Boot sequence ───────────────────────────────
applyTheme();
updateLangUI();
buildCatFilter();
buildTypeFilter();
applyFilters();       // render initial (loading) state
tryLoadSheet(rebuild);  // loads data; rebuild() triggers buildMarkers + renderList
loadMapScript(); // tries Google Maps first, falls back to HERE if unavailable
checkWhatsNew(); // show What's New modal if there are updates since last visit
