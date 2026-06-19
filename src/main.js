import { lang, setLang, t } from './i18n.js';
import { state } from './state.js';
import {
  updateLangUI, buildCatFilter, buildCatDropdown, buildStatusFilter,
  applyFilters, activateCard, buildPopupContent,
} from './render.js';
import {
  THEME_ICONS, getEffectiveTheme, switchTab,
  showSnackbar, locateMe, openNavigation, openInGoogleMaps, toggleLang,
} from './ui.js';
import {
  openEditModal, closeEditModal, submitEdit,
  openAddModal, closeAddModal, submitAdd,
  openIssueModal, closeIssueModal, submitIssueReport,
  tryLoadSheet,
} from './forms.js';
import { showPendingBanner } from './submit.js';
import { initMap, loadMapScript, updateMapTheme, buildMarkers } from './map.js';

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
  const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme();
}

function applyTheme() {
  const theme = getEffectiveTheme();
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-btn').textContent = THEME_ICONS[theme];
  document.getElementById('mobile-theme-icon').textContent = THEME_ICONS[theme];
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
  else if (action === 'locate') locateMe();
  else if (action === 'lang') toggleLang();
  else if (action === 'theme') cycleTheme();
}

// ═══════════════════════════════════════════════════
// EXPOSE FUNCTIONS USED IN TEMPLATE onclick STRINGS
// (inside JS template literals in renderList / buildPopupContent)
// ═══════════════════════════════════════════════════
window.activateCard = activateCard;
window.openEditModal = openEditModal;
window.openNavigation = openNavigation;
window.openInGoogleMaps = openInGoogleMaps;
window.applyFilters = applyFilters;


// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
// Restore language preference
setLang(localStorage.getItem('lang') || 'zh');

// Static event listeners
document.getElementById('add-btn').addEventListener('click', openAddModal);
document.getElementById('issue-btn').addEventListener('click', openIssueModal);
document.getElementById('locate-btn').addEventListener('click', locateMe);
document.getElementById('lang-btn').addEventListener('click', toggleLang);
document.getElementById('theme-btn').addEventListener('click', cycleTheme);
document.getElementById('mobile-actions-btn').addEventListener('click', toggleMobileActions);
document.querySelectorAll('[data-mobile-action]').forEach(btn => {
  btn.addEventListener('click', runMobileAction);
});
document.addEventListener('click', closeMobileActions);
document.getElementById('mobile-actions-menu').addEventListener('click', e => e.stopPropagation());

// Mobile tabs
document.getElementById('tab-map').addEventListener('click', () => switchTab('map'));
document.getElementById('tab-list').addEventListener('click', () => switchTab('list'));

// Modal backdrops (click outside = close)
document.getElementById('edit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEditModal(); });
document.getElementById('add-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAddModal(); });
document.getElementById('issue-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeIssueModal(); });

// Edit modal
document.querySelector('#edit-modal .modal-close').addEventListener('click', closeEditModal);
document.querySelector('#edit-modal .btn-ghost').addEventListener('click', closeEditModal);
document.getElementById('edit-submit-btn').addEventListener('click', submitEdit);

// Add modal
document.querySelector('#add-modal .modal-close').addEventListener('click', closeAddModal);
document.getElementById('add-cancel-btn').addEventListener('click', closeAddModal);
document.getElementById('add-submit-btn').addEventListener('click', submitAdd);
document.getElementById('add-done-btn').addEventListener('click', closeAddModal);

// Issue report modal
document.querySelector('#issue-modal .modal-close').addEventListener('click', closeIssueModal);
document.getElementById('issue-cancel-btn').addEventListener('click', closeIssueModal);
document.getElementById('issue-submit-btn').addEventListener('click', submitIssueReport);

// Map resize on window resize
window.addEventListener('resize', () => {
  if (!state.map) return;
  if (state.provider === 'google') google.maps.event.trigger(state.map, 'resize');
  else state.map.getViewPort().resize();
});

// ─── Boot sequence ───────────────────────────────
applyTheme();
updateLangUI();
buildCatDropdown();
buildCatFilter();
buildStatusFilter();
applyFilters();       // render initial (loading) state
showPendingBanner();
tryLoadSheet(rebuild);  // loads data; rebuild() triggers buildMarkers + renderList
loadMapScript(); // tries Google Maps first, falls back to HERE if unavailable
