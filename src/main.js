import { setLang, t } from './core/i18n.js';
import { state } from './core/state.js';
import {
  updateLangUI, buildCatFilter, buildTypeFilter,
  applyFilters, activateCard, isPublicLocation,
} from './ui/render.js';
import {
  getEffectiveTheme,
  showSnackbar, locateMe, openNavigation, openInGoogleMaps, sharePlace,
} from './ui/ui.js';
import {
  openIssueModal, closeIssueModal, submitIssueReport,
  loadLocations,
} from './features/forms.js';
import {
  loadMapScript,
  updateMapTheme,
  buildMarkers,
  clearActiveLocation,
  fitMapToVisibleLocations,
} from './map/map.js';
import {
  applyFiltersAndSyncMap,
  showListFromTop,
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
  trackHomeReset,
  trackSearchComplete,
  trackSheetView,
} from './services/analytics.js';
import {
  closeDestinationFilter,
  initDestinationFilter,
  reconcileDestinationFilter,
  renderDestinationFilter,
  saveDestinationFilter,
} from './features/destination-filter.js';
import { initFilterSheet } from './features/filter-sheet.js';
import { initHomeReset } from './features/home-reset.js';
import { initCollectionInfo } from './features/collection-info.js';
import { initFanResources } from './features/fan-resources.js';
import { initExchangeRates, syncExchangeControls } from './features/exchange-rates.js';
import { initBranchQueries } from './features/exchange-rates-1965-branch.js';
import { initFilterChips } from './features/filter-chips.js';
import { initInstallApp } from './features/install-app.js';
import { initBottomSheet, setSheetSnap } from './ui/bottom-sheet.js';
import { initSidePanel } from './ui/side-panel.js';
import { initSideMenu } from './ui/side-menu.js';
import {
  initPlaceDetail,
  isPlaceDetailOpen,
  refreshPlaceDetail,
} from './ui/place-detail.js';
import { isMobileLayout } from './ui/layout.js';
import { resizeMap, shiftCenterByPixels } from './map/viewport.js';

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
  openPlaceFromUrl();
}

// ═══════════════════════════════════════════════════
// SHARED PLACE LINK — ?place=<slug>
// ═══════════════════════════════════════════════════
let placeLinkHandled = false;

/** Open a shared place once, after the first snapshot load, then drop the parameter. */
function openPlaceFromUrl() {
  if (placeLinkHandled || state.isLoading) return;
  placeLinkHandled = true;
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('place');
  if (slug === null) return;
  params.delete('place');
  const query = params.toString();
  window.history.replaceState(window.history.state, '',
    `${query ? `?${query}` : window.location.pathname}${window.location.hash}`);
  const index = state.data.findIndex(row => row.id === slug && isPublicLocation(row));
  if (index >= 0) activateCard(index, { source: 'shared_link' });
}

// ═══════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════
function cycleTheme() {
  const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme();
}

const THEME_COLORS = Object.freeze({ light: '#ffffff', dark: '#111214' });

function applyTheme() {
  const theme = getEffectiveTheme();
  document.documentElement.dataset.theme = theme;

  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) themeBtn.setAttribute('aria-pressed', String(theme === 'dark'));
  // The value reads through data-i18n so a language switch relabels it too.
  const themeValue = document.getElementById('theme-btn-value');
  if (themeValue) {
    themeValue.dataset.i18n = theme === 'dark' ? 'theme_dark' : 'theme_light';
    themeValue.textContent = t(themeValue.dataset.i18n);
  }
  // Browser / installed-app chrome follows the in-app theme, not the OS one.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);

  updateMapTheme();
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
  searchAnalyticsTimer = setTimeout(() => {
    trackSearchComplete(queryLength, state.visIdx.length);
    searchAnalyticsTimer = null;
  }, 700);
}

/** Empty the search box without a rebuild, dropping any pending search event. */
function clearSearch() {
  if (searchAnalyticsTimer !== null) clearTimeout(searchAnalyticsTimer);
  searchAnalyticsTimer = null;
  /** @type {HTMLInputElement} */ (document.getElementById('search')).value = '';
  syncSearchClear();
}

/** The clear (×) button shows only while the search box has text. */
function syncSearchClear() {
  const input = /** @type {HTMLInputElement} */ (document.getElementById('search'));
  const clearBtn = document.getElementById('search-clear-btn');
  if (clearBtn) clearBtn.hidden = input.value.length === 0;
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
// (inside JS template literals in renderList / buildPlaceDetailContent)
// ═══════════════════════════════════════════════════
window.activateCard = activateCard;
window.openNavigation = openNavigation;
window.openInGoogleMaps = openInGoogleMaps;
window.sharePlace = sharePlace;
window.toggleFavorite = handleFavoriteClick;


// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
// Restore language preference
setLang(localStorage.getItem('lang') || 'zh');

// Restore favorites from URL or localStorage
loadFavorites();
/** @param {{filterValue: string, filterAction: 'select'|'deselect'|'clear'}} change */
function handleDestinationChange(change) {
  applyFiltersAndSyncMap({ fitMap: true });
  trackFilterApply(
    'destination',
    change.filterValue,
    state.visIdx.length,
    change.filterAction,
    state.selectedDestinations.size,
  );
}

/**
 * @param {'category'|'type'} filterType
 * @param {{silent?: boolean}} [options] silent skips the rebuild and analytics
 */
function clearSelectFilter(filterType, { silent = false } = {}) {
  const select = /** @type {HTMLSelectElement|null} */ (
    document.getElementById(filterType === 'category' ? 'cat-filter' : 'label-filter')
  );
  if (!select || !select.value) return;
  select.value = '';
  if (!silent) handleSelectFilter(filterType, select);
}

/**
 * @param {string} [key] Remove one destination, or all when omitted.
 * @param {{silent?: boolean}} [options] silent skips the rebuild and analytics
 */
function clearDestinationFilter(key, { silent = false } = {}) {
  if (key === undefined) {
    if (state.selectedDestinations.size === 0) return;
    state.selectedDestinations.clear();
  } else if (!state.selectedDestinations.delete(key)) {
    return;
  }
  saveDestinationFilter();
  renderDestinationFilter();
  if (silent) return;
  handleDestinationChange(key === undefined
    ? { filterValue: 'all', filterAction: 'clear' }
    : { filterValue: `destination:${key}`, filterAction: 'deselect' });
}

function clearAllFilters() {
  clearSelectFilter('category');
  clearSelectFilter('type');
  clearDestinationFilter();
}

/** Home reset: every narrowing control back to default, without rebuilding. */
function clearAllFiltersSilently() {
  const silent = { silent: true };
  clearSelectFilter('category', silent);
  clearSelectFilter('type', silent);
  clearDestinationFilter(undefined, silent);
  setFavoritesFilter(false, silent);
  state.exchangeSort = 'default';
  syncExchangeControls();
}

/**
 * Single owner of the favorites-only control, shared by its button and the
 * header reset, so the class, aria-pressed, icon and analytics stay in step.
 * @param {boolean} on
 * @param {{silent?: boolean}} [options] silent skips the rebuild and analytics
 */
function setFavoritesFilter(on, { silent = false } = {}) {
  if (state.favFilterOn === on) return;
  state.favFilterOn = on;
  const favBtn = document.getElementById('fav-filter-btn');
  favBtn.classList.toggle('active', on);
  favBtn.setAttribute('aria-pressed', String(on));
  favBtn.innerHTML = heartSVG(on);
  if (silent) return;
  applyFiltersAndSyncMap();
  trackFilterApply(
    'favorites',
    on ? 'on' : 'off',
    state.visIdx.length,
    on ? 'enable' : 'disable',
    on ? state.favorites.size : 0,
  );
}

initDestinationFilter(handleDestinationChange);
const filterSheet = initFilterSheet({
  beforeOpen: closeDestinationFilter,
  onClearAll: clearAllFilters,
});
initFilterChips({
  onDestinationClick: () => {
    const destChip = document.getElementById('dest-chip');
    filterSheet?.open(destChip ?? undefined);
    const destButton = document.getElementById('dest-filter-btn');
    if (destButton?.getAttribute('aria-expanded') !== 'true') destButton?.click();
    destButton?.scrollIntoView({ block: 'nearest' });
  },
});
initBottomSheet({
  onSnapChange: (snap, source) => {
    if (source === 'drag' || source === 'handle') trackSheetView(snap, source);
  },
});
// The map sits beside the open desktop panel, so toggling it resizes the map.
// Shift the centre by half the panel first so the map content stays put.
initSidePanel({
  beforeToggle: nextCollapsed => {
    if (isMobileLayout()) return;
    const half = (document.getElementById('panel')?.offsetWidth ?? 0) / 2;
    shiftCenterByPixels(nextCollapsed ? -half : half);
  },
  onToggle: () => {
    if (!isMobileLayout()) requestAnimationFrame(resizeMap);
  },
});
initPlaceDetail({ onClose: clearActiveLocation });
const sideMenu = initSideMenu();
initHomeReset({
  clearSearch,
  clearFilters: clearAllFiltersSilently,
  clearActiveLocation,
  showListFromTop,
  applyFilters: () => applyFiltersAndSyncMap({ fitMap: true }),
  trackReset: () => trackHomeReset(state.visIdx.length),
});
initCollectionInfo();
const fanResources = initFanResources();
initInstallApp({
  showHint: message => showSnackbar(message, 9000),
  beforeOpen: () => sideMenu?.close(),
});
/** @param {{sortChanged?: boolean}} change */
const handleExchangeChange = change => {
  applyFiltersAndSyncMap({ exchangeSortChanged: change.sortChanged });
  refreshPlaceDetail();
};
initExchangeRates(handleExchangeChange);
initBranchQueries(() => {
  syncExchangeControls();
  handleExchangeChange({});
});

// Static event listeners
document.getElementById('fav-filter-btn').addEventListener('click', event => {
  setFavoritesFilter(!state.favFilterOn);
  releasePointerFocus(event);
});
const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('search'));
searchInput.addEventListener('input', () => {
  syncSearchClear();
  handleSearchInput();
});
// Searching works like a maps app: typing shows the results list over the
// map (full sheet on mobile), and submitting returns to the half sheet.
searchInput.addEventListener('focus', () => {
  if (isPlaceDetailOpen()) clearActiveLocation();
  if (isMobileLayout()) setSheetSnap('full');
});
searchInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  searchInput.blur();
  if (isMobileLayout()) setSheetSnap('half');
});
document.getElementById('search-clear-btn')?.addEventListener('click', () => {
  clearSearch();
  applyFiltersAndSyncMap();
  searchInput.focus();
});
document.getElementById('cat-filter').addEventListener('change', event => {
  handleSelectFilter('category', /** @type {HTMLSelectElement} */ (event.currentTarget));
});
document.getElementById('label-filter').addEventListener('change', event => {
  handleSelectFilter('type', /** @type {HTMLSelectElement} */ (event.currentTarget));
});
document.getElementById('locate-btn').addEventListener('click', locateMe);

// Side menu items. Language and theme apply in place (the menu stays open to
// show the change); the others hand focus to a dialog or reset the view.
document.getElementById('lang-btn').addEventListener('click', toggleLang);
document.getElementById('theme-btn')?.addEventListener('click', cycleTheme);
document.getElementById('issue-btn').addEventListener('click', () => {
  if (sideMenu) sideMenu.closeThen(openIssueModal);
  else openIssueModal();
});
document.getElementById('fan-resources-btn')?.addEventListener('click', () => {
  const open = () => fanResources?.open(document.getElementById('menu-btn'));
  if (sideMenu) sideMenu.closeThen(open);
  else open();
});
document.getElementById('home-btn')?.addEventListener('click', () => sideMenu?.close());

// Escape closes an open place when no dialog or modal is in front of it.
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented || !isPlaceDetailOpen()) return;
  if (document.querySelector('dialog[open], .modal-overlay.open')) return;
  clearActiveLocation();
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
  resizeMap();
  if (state.pendingDestinationFit) fitMapToVisibleLocations();
});

// ─── Boot sequence ───────────────────────────────
applyTheme();
updateLangUI();
buildCatFilter();
buildTypeFilter();
applyFilters();       // render initial (loading) state
loadLocations(rebuild);  // loads the location snapshot; rebuild() triggers buildMarkers + renderList
loadMapScript(); // tries Google Maps first, falls back to HERE if unavailable
checkWhatsNew(); // show What's New modal if there are updates since last visit
