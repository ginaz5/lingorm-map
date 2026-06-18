import { lang, setLang, t } from './i18n.js';
import { state } from './state.js';
import {
  updateLangUI, buildCatFilter, buildCatDropdown,
  applyFilters, buildPopupContent,
} from './render.js';

// ═══════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════
export const THEME_ICONS = { light: '☀️', dark: '🌙' };

export function getEffectiveTheme() {
  return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
}

// ═══════════════════════════════════════════════════
// MOBILE TABS
// ═══════════════════════════════════════════════════
export function switchTab(tab) {
  const isMap = tab === 'map';
  document.getElementById('panel').setAttribute('data-mobile-tab', isMap ? 'map' : 'list');
  document.getElementById('map-wrap').setAttribute('data-mobile-tab', isMap ? 'map' : 'list');
  document.getElementById('tab-map').classList.toggle('active', isMap);
  document.getElementById('tab-list').classList.toggle('active', !isMap);
  if (isMap && state.map) state.map.getViewPort().resize();
}

// ═══════════════════════════════════════════════════
// SNACKBAR
// ═══════════════════════════════════════════════════
export function showSnackbar(msg, duration = 4000) {
  const el = document.getElementById('snackbar');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(state.snackTimer);
  state.snackTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ═══════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════
export function openNavigation(i) {
  const row = state.data[i];
  const name = lang === 'zh' ? row.nameZh : row.nameEn;
  const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
  const url = 'https://www.google.com/maps/dir/?api=1'
    + '&destination=' + lat + ',' + lng
    + '&destination_place_name=' + encodeURIComponent(name)
    + '&travelmode=transit';
  window.open(url, '_blank');
}

// ═══════════════════════════════════════════════════
// USER LOCATION
// ═══════════════════════════════════════════════════
export function locateMe() {
  if (!state.map) { return; }
  if (!navigator.geolocation) { alert(t('locate_err')); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      if (state.userLocationMarker) {
        state.map.removeObject(state.userLocationMarker);
        state.userLocationMarker = null;
      }
      const el = document.createElement('div');
      el.className = 'user-location-dot';
      const domIcon = new H.map.DomIcon(el);
      state.userLocationMarker = new H.map.DomMarker({ lat, lng }, { icon: domIcon, zIndex: 999 });
      state.map.addObject(state.userLocationMarker);
      state.map.setCenter({ lat, lng });
      showSnackbar(t('locate_snack'));
    },
    err => {
      if (err.code === 1) alert(t('locate_deny'));
      else alert(t('locate_err'));
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// ═══════════════════════════════════════════════════
// i18n TOGGLE
// ═══════════════════════════════════════════════════
export function toggleLang() {
  setLang(lang === 'zh' ? 'en' : 'zh');
  updateLangUI();
  buildCatFilter();
  buildCatDropdown();
  applyFilters();
  if (state.infoBubble && state.activeIdx >= 0) {
    state.infoBubble.setContent(buildPopupContent(state.activeIdx));
  }
}
