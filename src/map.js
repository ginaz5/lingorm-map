import { state } from './state.js';
import { getEffectiveTheme } from './ui.js';
import { buildPopupContent, activateCard, getBadgeClass, isPublicLocation } from './render.js';

/** @typedef {'google'|'here'} ActiveMapProvider */
/**
 * @typedef {Object} MapConfig
 * @property {string} [googleMapsKey]
 * @property {string} [googleMapId]
 * @property {string} hereApiKey
 */

/** @param {string} id @returns {HTMLElement} */
function requiredElement(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el;
}

// ═══════════════════════════════════════════════════
// PROVIDER BADGE
// ═══════════════════════════════════════════════════
/** @param {ActiveMapProvider} provider */
export function updateProviderBadge(provider) {
  const dot = document.getElementById('provider-dot');
  const label = document.getElementById('provider-label');
  if (!dot || !label) return;
  if (provider === 'google') {
    dot.style.background = '#4285F4';
    label.textContent = 'Google Maps';
  } else {
    dot.style.background = '#00AFAA';
    label.textContent = 'HERE Maps';
  }
}

// ═══════════════════════════════════════════════════
// MAP THEME
// ═══════════════════════════════════════════════════
export function updateMapTheme() {
  if (!state.map) return;
  if (state.provider === 'google') {
    state.map.setOptions({ colorScheme: getEffectiveTheme() === 'dark' ? 'DARK' : 'LIGHT' });
  } else if (state.provider === 'here' && state.hereLayers) {
    state.map.setBaseLayer(getHereBaseLayer(state.hereLayers, getEffectiveTheme()));
  }
}

/** @param {any} layers @param {'light'|'dark'} theme @returns {any} */
export function getHereBaseLayer(layers, theme) {
  const n = layers?.vector?.normal;
  return theme === 'dark' ? (n?.mapnight || n?.map) : n?.map;
}

// ═══════════════════════════════════════════════════
// MARKERS
// ═══════════════════════════════════════════════════
/** @param {string} status @param {string} icon @returns {HTMLDivElement} */
export function makeMarkerContent(status, icon) {
  const el = document.createElement('div');
  el.className = `marker-dot ${getBadgeClass(status).replace('b-', 'marker-')}`;
  el.textContent = icon || '📍';
  return el;
}

export function buildMarkers() {
  if (!state.map) return;

  // Remove old markers
  state.markers.forEach(m => {
    if (!m) return;
    if (state.provider === 'google') m.map = null;
    else state.map.removeObject(m);
  });
  state.markers.length = 0;

  state.data.forEach((row, i) => {
    const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
    if (!isPublicLocation(row)) return;
    if (!lat || !lng) return;
    const el = makeMarkerContent(row.status, row.icon);

    if (state.provider === 'google') {
      const m = new google.maps.marker.AdvancedMarkerElement({
        map: state.map, position: { lat, lng }, content: el,
      });
      m.addListener('click', () => {
        state.infoWindow.setContent(buildPopupContent(i));
        state.infoWindow.open({ anchor: m, map: state.map });
        activateCard(i);
      });
      state.markers[i] = m;
    } else {
      const domIcon = new H.map.DomIcon(el);
      const m = new H.map.DomMarker({ lat, lng }, { icon: domIcon });
      m.addEventListener('tap', () => {
        if (state.infoBubble) {
          state.hereUi.removeBubble(state.infoBubble);
          state.infoBubble = null;
        }
        state.infoBubble = new H.ui.InfoBubble({ lat, lng }, { content: buildPopupContent(i) });
        state.hereUi.addBubble(state.infoBubble);
        activateCard(i);
      });
      state.map.addObject(m);
      state.markers[i] = m;
    }
  });
}

// ═══════════════════════════════════════════════════
// SCRIPT LOADER
// ═══════════════════════════════════════════════════
/** @param {string} src @returns {Promise<void>} */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

async function loadHereScripts() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://js.api.here.com/v3/3.1/mapsjs-ui.css';
  document.head.appendChild(link);
  await loadScript('https://js.api.here.com/v3/3.1/mapsjs-core.js');
  await loadScript('https://js.api.here.com/v3/3.1/mapsjs-service.js');
  await loadScript('https://js.api.here.com/v3/3.1/mapsjs-ui.js');
  await loadScript('https://js.api.here.com/v3/3.1/mapsjs-mapevents.js');
}

// ═══════════════════════════════════════════════════
// GOOGLE MAPS INIT
// ═══════════════════════════════════════════════════
/** @param {MapConfig} cfg */
function initWithGoogle(cfg) {
  state.provider = 'google';
  requiredElement('map-loading').classList.add('is-hidden');

  state.map = new google.maps.Map(requiredElement('map'), {
    center: { lat: 13.82, lng: 100.52 }, zoom: 11,
    mapId: cfg.googleMapId,
    colorScheme: getEffectiveTheme() === 'dark' ? 'DARK' : 'LIGHT',
    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
  });
  state.infoWindow = new google.maps.InfoWindow();

  // Watch for Google quota-exceeded error overlay
  const mapEl = requiredElement('map');
  const observer = new MutationObserver(() => {
    if (mapEl.querySelector('.gm-err-container, .gm-style-pbc')) {
      observer.disconnect();
      state.googleErrorObserver = null;
      fallbackToHere(cfg);
    }
  });
  state.googleErrorObserver = observer;
  observer.observe(mapEl, { childList: true, subtree: true });

  updateProviderBadge('google');
  buildMarkers();
}

// ═══════════════════════════════════════════════════
// HERE MAPS INIT
// ═══════════════════════════════════════════════════
/** @param {string} apiKey */
function initWithHere(apiKey) {
  state.provider = 'here';
  const loadingEl = requiredElement('map-loading');
  const msgEl = document.getElementById('map-loading-msg');
  loadingEl.classList.add('is-hidden');
  if (msgEl) msgEl.textContent = '';

  const platform = new H.service.Platform({ apikey: apiKey });
  const layers = platform.createDefaultLayers();
  state.hereLayers = layers;

  state.map = new H.Map(
    requiredElement('map'),
    getHereBaseLayer(layers, getEffectiveTheme()),
    { zoom: 11, center: { lat: 13.82, lng: 100.52 } }
  );
  new H.mapevents.Behavior(new H.mapevents.MapEvents(state.map));
  state.hereUi = H.ui.UI.createDefault(state.map, layers);

  updateProviderBadge('here');
  buildMarkers();
}

// ═══════════════════════════════════════════════════
// FALLBACK: Google → HERE
// ═══════════════════════════════════════════════════
/** @param {MapConfig} cfg @returns {Promise<void>} */
async function fallbackToHere(cfg) {
  // Tear down Google state
  if (state.googleErrorObserver) {
    state.googleErrorObserver.disconnect();
    state.googleErrorObserver = null;
  }
  state.markers.forEach(m => { if (m) m.map = null; });
  state.markers.length = 0;
  if (state.infoWindow) { state.infoWindow.close(); state.infoWindow = null; }
  if (state.userLocationMarker) { state.userLocationMarker.map = null; state.userLocationMarker = null; }
  state.map = null;
  state.provider = null;

  // Clear map DOM
  const mapEl = requiredElement('map');
  mapEl.innerHTML = '';

  // Show loading with message (Option B: spinner + 一行小字)
  const loadingEl = requiredElement('map-loading');
  const msgEl = document.getElementById('map-loading-msg');
  if (msgEl) msgEl.textContent = '地圖載入中，請稍候⋯';
  loadingEl.classList.remove('is-hidden');

  try {
    await loadHereScripts();
    initWithHere(cfg.hereApiKey);
  } catch (e) {
    console.error('HERE Maps fallback failed', e);
    loadingEl.classList.add('is-hidden');
  }
}

// ═══════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════
export async function loadMapScript() {
  try {
    const resp = await fetch('/api/config');
    if (!resp.ok) throw new Error(String(resp.status));
    const cfg = /** @type {MapConfig} */ (await resp.json());

    if (cfg.googleMapsKey && cfg.googleMapId) {
      // Set up auth-failure fallback before injecting script
      window.gm_authFailure = () => {
        if (state.provider !== 'google') return;
        if (state.googleErrorObserver) {
          state.googleErrorObserver.disconnect();
          state.googleErrorObserver = null;
        }
        fallbackToHere(cfg);
      };

      window.initMapCallback = () => {
        initWithGoogle(cfg);
        updateMapTheme();
      };

      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://maps.googleapis.com/maps/api/js?key='
        + encodeURIComponent(cfg.googleMapsKey)
        + '&map_ids=' + encodeURIComponent(cfg.googleMapId)
        + '&libraries=marker&callback=initMapCallback&loading=async';
      document.body.appendChild(script);
    } else {
      // No Google key — load HERE directly
      await loadHereScripts();
      initWithHere(cfg.hereApiKey);
    }
  } catch (e) {
    console.error('Map config failed', e);
    requiredElement('map-loading').classList.add('is-hidden');
  }
}

// Keep named export for backward-compat (main.js still imports initMap for applyTheme guard)
export { initWithHere as initMap };
