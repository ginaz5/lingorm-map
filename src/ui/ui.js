import { lang, t } from '../core/i18n.js';
import { state } from '../core/state.js';
import { centerMapOn } from '../map/viewport.js';
import {
  trackLocateResult,
  trackLocationAction,
} from '../services/analytics.js';

/** @param {string} id @returns {HTMLElement} */
function requiredElement(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el;
}

// ═══════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════
/** @returns {'light'|'dark'} */
export function getEffectiveTheme() {
  try {
    return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
  } catch (_) {
    return 'light';
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
/** @param {number} i @param {'list_card'|'popup'|'unknown'} [source] */
export function openNavigation(i, source = 'unknown') {
  const row = state.data[i];
  const name = lang === 'zh' ? row.nameZh : row.nameEn;
  const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
  const url = 'https://www.google.com/maps/dir/?api=1'
    + '&destination=' + lat + ',' + lng
    + '&destination_place_name=' + encodeURIComponent(name)
    + '&travelmode=transit';
  trackLocationAction(row, 'directions', source);
  window.open(url, '_blank');
}

/**
 * Link that reopens this site on one place (read at boot by main.js).
 * @param {string} id location slug
 * @param {{ origin: string, pathname: string }} [location]
 */
export function placeShareUrl(id, location = window.location) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('place', id);
  return url.toString();
}

/**
 * Share a place with the native share sheet, or copy its link where the Web
 * Share API is unavailable (most desktop browsers).
 * @param {number} i
 * @param {'list_card'|'popup'|'unknown'} [source]
 */
export async function sharePlace(i, source = 'unknown') {
  const row = state.data[i];
  if (!row) return;
  const name = lang === 'zh' ? row.nameZh : row.nameEn;
  const url = placeShareUrl(row.id);
  trackLocationAction(row, 'share', source);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: `${name} · LingOrm Map`, url });
    } catch (_) {
      // Dismissing the share sheet rejects with AbortError; nothing to do.
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showSnackbar(t('share_copied'));
  } catch (_) {
    showSnackbar(url, 8000);
  }
}

/** @param {number} i @param {'list_card'|'popup'|'unknown'} [source] */
export function openInGoogleMaps(i, source = 'unknown') {
  const row = state.data[i];
  let url;
  if (row.maps && /^https?:\/\//i.test(row.maps)) {
    url = row.maps;
  } else if (row.maps) {
    url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(row.maps);
  } else {
    const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
    url = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
  }
  trackLocationAction(row, 'open_google_maps', source);
  window.open(url, '_blank');
}

// ═══════════════════════════════════════════════════
// USER LOCATION
// ═══════════════════════════════════════════════════
export function locateMe() {
  if (!state.map) {
    trackLocateResult('map_unavailable');
    return;
  }
  if (!navigator.geolocation) {
    trackLocateResult('unsupported');
    alert(t('locate_err'));
    return;
  }
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
      } else {
        const domIcon = new H.map.DomIcon(el);
        state.userLocationMarker = new H.map.DomMarker({ lat, lng }, { icon: domIcon, zIndex: 999 });
        state.map.addObject(state.userLocationMarker);
      }
      // Centre in the uncovered map area, above the bottom sheet.
      centerMapOn({ lat, lng });
      trackLocateResult('success');
      showSnackbar(t('locate_snack'));
    },
    err => {
      if (err.code === 1) {
        trackLocateResult('denied');
        alert(t('locate_deny'));
      } else {
        trackLocateResult(err.code === 3 ? 'timeout' : 'unavailable');
        alert(t('locate_err'));
      }
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}
