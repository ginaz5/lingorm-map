import { lang, setLang, t } from './i18n.js';
import { state } from './state.js';
import {
  updateLangUI, buildCatFilter, buildCatDropdown, buildStatusFilter,
  applyFilters, activateCard, buildPopupContent,
} from './render.js';
import {
  THEME_ICONS, getEffectiveTheme, switchTab,
  showSnackbar, locateMe, openNavigation, toggleLang,
} from './ui.js';
import {
  openEditModal, closeEditModal, submitEdit,
  openAddModal, closeAddModal, submitAdd,
  checkAdminHash, closeAdminAuth, verifyAdminPassword,
  openSheetModal, closeSheetModal, saveSheet, tryLoadSheet,
  showAddSuccess,
} from './forms.js';
import { showPendingBanner } from './submit.js';
import { initMap, loadGoogleMapsScript, updateMapTheme, buildMarkers } from './map.js';

// ═══════════════════════════════════════════════════
// REBUILD — called after data loads or changes
// ═══════════════════════════════════════════════════
function rebuild() {
  if (state.map) buildMarkers();
  buildCatFilter();
  applyFilters();
}

// ═══════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════
function cycleTheme() {
  const cur = localStorage.getItem('theme') || 'auto';
  localStorage.setItem('theme', cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto');
  applyTheme();
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', getEffectiveTheme());
  document.getElementById('theme-btn').textContent = THEME_ICONS[localStorage.getItem('theme') || 'auto'];
  updateMapTheme();
}

// ═══════════════════════════════════════════════════
// EXPOSE FUNCTIONS USED IN TEMPLATE onclick STRINGS
// (inside JS template literals in renderList / buildPopupContent)
// ═══════════════════════════════════════════════════
window.activateCard = activateCard;
window.openEditModal = openEditModal;
window.openNavigation = openNavigation;

// Called by the Google Maps script loader via callback=initMapCallback
window.initMapCallback = () => {
  initMap();
  // Now that map is ready, apply theme colorScheme
  updateMapTheme();
};

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
// Restore language preference
setLang(localStorage.getItem('lang') || 'zh');

// Static event listeners
document.getElementById('add-btn').addEventListener('click', openAddModal);
document.getElementById('locate-btn').addEventListener('click', locateMe);
document.getElementById('lang-btn').addEventListener('click', toggleLang);
document.getElementById('theme-btn').addEventListener('click', cycleTheme);

// Mobile tabs
document.getElementById('tab-map').addEventListener('click', () => switchTab('map'));
document.getElementById('tab-list').addEventListener('click', () => switchTab('list'));

// Modal backdrops (click outside = close)
document.getElementById('edit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEditModal(); });
document.getElementById('add-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAddModal(); });
document.getElementById('admin-auth-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAdminAuth(); });
document.getElementById('sheet-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeSheetModal(); });

// Edit modal
document.querySelector('#edit-modal .modal-close').addEventListener('click', closeEditModal);
document.querySelector('#edit-modal .btn-ghost').addEventListener('click', closeEditModal);
document.getElementById('edit-submit-btn').addEventListener('click', submitEdit);

// Add modal
document.querySelector('#add-modal .modal-close').addEventListener('click', closeAddModal);
document.getElementById('add-cancel-btn').addEventListener('click', closeAddModal);
document.getElementById('add-submit-btn').addEventListener('click', submitAdd);
document.getElementById('add-done-btn').addEventListener('click', closeAddModal);

// Admin auth modal
document.querySelector('#admin-auth-modal .modal-close').addEventListener('click', closeAdminAuth);
document.querySelector('#admin-auth-modal .btn-ghost').addEventListener('click', closeAdminAuth);
document.querySelector('#admin-auth-modal .btn-primary').addEventListener('click', verifyAdminPassword);
document.getElementById('admin-pwd').addEventListener('keydown', e => { if (e.key === 'Enter') verifyAdminPassword(); });

// Sheet modal
document.querySelector('#sheet-modal .modal-close').addEventListener('click', closeSheetModal);
document.querySelector('#sheet-modal .btn-ghost').addEventListener('click', closeSheetModal);
document.querySelector('#sheet-modal .btn-primary').addEventListener('click', () => saveSheet(rebuild));

// System media query: re-apply theme when OS dark mode changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((localStorage.getItem('theme') || 'auto') === 'auto') applyTheme();
});

// Map resize on window resize
window.addEventListener('resize', () => { if (state.map) google.maps.event.trigger(state.map, 'resize'); });

// Admin hash in URL
window.addEventListener('hashchange', checkAdminHash);

// ─── Boot sequence ───────────────────────────────
applyTheme();
updateLangUI();
buildCatDropdown();
buildCatFilter();
buildStatusFilter();
applyFilters();       // render initial (loading) state
showPendingBanner();
tryLoadSheet(rebuild);  // loads data; rebuild() triggers buildMarkers + renderList
checkAdminHash();
loadGoogleMapsScript(); // loads Maps async; initMapCallback() called on completion
