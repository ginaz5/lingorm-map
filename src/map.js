import { state } from './state.js';
import { getEffectiveTheme, switchTab } from './ui.js';
import { buildPopupContent, activateCard, getBadgeClass, isPublicLocation } from './render.js';

// ═══════════════════════════════════════════════════
// MAP THEME
// ═══════════════════════════════════════════════════
export function updateMapTheme() {
  if (!state.map) return;
  state.map.setOptions({ colorScheme: getEffectiveTheme() === 'dark' ? 'DARK' : 'LIGHT' });
}

// ═══════════════════════════════════════════════════
// MARKERS
// ═══════════════════════════════════════════════════
export function makeMarkerContent(status, icon) {
  const el = document.createElement('div');
  el.className = `marker-dot ${getBadgeClass(status).replace('b-', 'marker-')}`;
  el.textContent = icon || '📍';
  return el;
}

export function buildMarkers() {
  if (!state.map) return;
  state.markers.forEach(m => { if (m) m.map = null; });
  state.markers.length = 0;
  state.data.forEach((row, i) => {
    const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
    if (!isPublicLocation(row)) return;
    if (!lat || !lng) return;
    const m = new google.maps.marker.AdvancedMarkerElement({
      map: state.map, position: { lat, lng }, content: makeMarkerContent(row.status, row.icon),
    });
    m.addListener('click', () => {
      state.infoWindow.setContent(buildPopupContent(i));
      state.infoWindow.open({ anchor: m, map: state.map });
      activateCard(i);
      if (window.innerWidth <= 700) switchTab('list');
    });
    state.markers[i] = m;
  });
}

// ═══════════════════════════════════════════════════
// GOOGLE MAPS INIT
// ═══════════════════════════════════════════════════

// initMapCallback is assigned to window in main.js after all imports resolve
export function initMap() {
  document.getElementById('map-loading').classList.add('is-hidden');
  state.map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 13.82, lng: 100.52 }, zoom: 11,
    mapId: state.googleMapId,
    colorScheme: getEffectiveTheme() === 'dark' ? 'DARK' : 'LIGHT',
    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
  });
  state.infoWindow = new google.maps.InfoWindow();
  buildMarkers();
}

export async function loadGoogleMapsScript() {
  try {
    const resp = await fetch('/api/config'); if (!resp.ok) throw new Error(resp.status);
    const cfg = await resp.json();
    state.googleMapId = cfg.googleMapId;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://maps.googleapis.com/maps/api/js?key='
      + encodeURIComponent(cfg.googleMapsKey)
      + '&map_ids=' + encodeURIComponent(cfg.googleMapId)
      + '&libraries=marker&callback=initMapCallback&loading=async';
    document.body.appendChild(script);
  } catch (e) {
    console.error('Google Maps config failed', e);
    document.getElementById('map-loading').classList.add('is-hidden');
  }
}
