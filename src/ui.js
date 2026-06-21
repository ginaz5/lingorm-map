import { lang, setLang, t } from './i18n.js';
import { state } from './state.js';
import {
  updateLangUI, buildCatFilter, buildCatDropdown,
  applyFilters, buildPopupContent,
} from './render.js';
import { updateWhatsNewLangUI } from './whats-new.js';

/** @param {string} id @returns {HTMLElement} */
function requiredElement(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el;
}

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
/** @param {'map'|'list'} tab */
export function switchTab(tab) {
  const isMap = tab === 'map';
  requiredElement('panel').setAttribute('data-mobile-tab', isMap ? 'map' : 'list');
  requiredElement('map-wrap').setAttribute('data-mobile-tab', isMap ? 'map' : 'list');
  requiredElement('tab-map').classList.toggle('active', isMap);
  requiredElement('tab-list').classList.toggle('active', !isMap);
  if (isMap && state.map) {
    if (state.provider === 'google') google.maps.event.trigger(state.map, 'resize');
    else state.map.getViewPort().resize();
  }
}

// ═══════════════════════════════════════════════════
// SNACKBAR
// ═══════════════════════════════════════════════════
/** @param {string} msg @param {number} [duration] */
export function showSnackbar(msg, duration = 4000) {
  const el = requiredElement('snackbar');
  el.textContent = msg; el.classList.add('show');
  if (state.snackTimer !== null) clearTimeout(state.snackTimer);
  state.snackTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ═══════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════
/** @param {number} i */
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

/** @param {number} i */
export function openInGoogleMaps(i) {
  const row = state.data[i];
  let url;
  if (row.maps) {
    url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(row.maps);
  } else {
    const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
    url = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
  }
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
      // Remove existing user marker
      if (state.userLocationMarker) {
        if (state.provider === 'google') state.userLocationMarker.map = null;
        else state.map.removeObject(state.userLocationMarker);
        state.userLocationMarker = null;
      }
      const el = document.createElement('div');
      el.className = 'user-location-dot';
      if (state.provider === 'google') {
        state.userLocationMarker = new google.maps.marker.AdvancedMarkerElement({
          map: state.map, position: { lat, lng }, content: el, zIndex: 999,
        });
        state.map.panTo({ lat, lng });
      } else {
        const domIcon = new H.map.DomIcon(el);
        state.userLocationMarker = new H.map.DomMarker({ lat, lng }, { icon: domIcon, zIndex: 999 });
        state.map.addObject(state.userLocationMarker);
        state.map.setCenter({ lat, lng });
      }
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
  updateWhatsNewLangUI();
  buildCatFilter();
  buildCatDropdown();
  applyFilters();
  if (state.activeIdx >= 0) {
    const html = buildPopupContent(state.activeIdx);
    if (state.provider === 'google' && state.infoWindow) state.infoWindow.setContent(html);
    else if (state.provider === 'here' && state.infoBubble) state.infoBubble.setContent(html);
  }
}
