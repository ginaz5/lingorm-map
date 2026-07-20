import { state } from './state.js';
import { getEffectiveTheme } from './ui.js';
import { buildPopupContent, activateCard, isPublicLocation } from './render.js';
// MarkerClusterer is loaded lazily to avoid CJS/ESM issues in Node.js test env
/** @type {typeof import('@googlemaps/markerclusterer').MarkerClusterer|null} */
let _MarkerClusterer = null;
async function getMarkerClusterer() {
  if (!_MarkerClusterer) {
    const mod = await import('@googlemaps/markerclusterer');
    _MarkerClusterer = mod.MarkerClusterer || mod.default?.MarkerClusterer;
  }
  return _MarkerClusterer;
}

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
// MARKERS & CLUSTERING
// ═══════════════════════════════════════════════════
/** @param {string} icon @returns {HTMLDivElement} */
export function makeMarkerContent(icon) {
  const el = document.createElement('div');
  el.className = 'marker-dot';
  el.textContent = icon || '📍';
  return el;
}

/**
 * Custom renderer for Google MarkerClusterer.
 * Draws a circle with the cluster count.
 * @param {{ count: number, position: any }} param0
 * @returns {any}
 */
function clusterRenderer({ count, position }) {
  const size = count >= 100 ? 48 : count >= 10 ? 40 : 32;
  const el = document.createElement('div');
  el.className = 'marker-cluster';
  el.textContent = String(count);
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  return new google.maps.marker.AdvancedMarkerElement({
    position,
    content: el,
    zIndex: 1000 + count,
  });
}

/**
 * Custom theme for HERE Maps clustering.
 * Provides consistent visual style with Google clustering.
 * @returns {any}
 */
function makeHereClusterTheme() {
  return {
    getClusterPresentation: (/** @type {any} */ cluster) => {
      const weight = cluster.getWeight();
      const size = weight >= 100 ? 48 : weight >= 10 ? 40 : 32;
      const el = document.createElement('div');
      el.className = 'marker-cluster';
      el.textContent = String(weight);
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      const domIcon = new H.map.DomIcon(el);
      const marker = new H.map.DomMarker(cluster.getPosition(), {
        icon: domIcon,
        min: cluster.getMinZoom(),
        max: cluster.getMaxZoom(),
      });
      marker.setData(cluster);
      return marker;
    },
    getNoisePresentation: (/** @type {any} */ noisePoint) => {
      const data = noisePoint.getData();
      const el = makeMarkerContent(data?.icon || '📍');
      const domIcon = new H.map.DomIcon(el);
      const marker = new H.map.DomMarker(noisePoint.getPosition(), {
        icon: domIcon,
        min: noisePoint.getMinZoom(),
      });
      marker.setData(noisePoint.getData());
      return marker;
    },
  };
}

export async function buildMarkers() {
  if (!state.map) return;

  // --- Tear down old clustering & markers ---
  if (state.markerClusterer) {
    if (state.provider === 'google') {
      state.markerClusterer.clearMarkers();
    } else {
      state.map.removeLayer(state.markerClusterer);
    }
    state.markerClusterer = null;
  }
  // Remove leftover individual markers (safety net)
  state.markers.forEach(m => {
    if (!m) return;
    if (state.provider === 'google') m.map = null;
    else {
      try { state.map.removeObject(m); } catch (_) { /* already removed */ }
    }
  });
  state.markers.length = 0;

  // --- Build markers per provider ---
  if (state.provider === 'google') {
    /** @type {any[]} */
    const clusterMarkers = [];
    state.data.forEach((row, i) => {
      const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
      if (!isPublicLocation(row)) return;
      if (!lat || !lng) return;
      const el = makeMarkerContent(row.icon);
      // NOTE: do NOT set map here; MarkerClusterer will manage it
      const m = new google.maps.marker.AdvancedMarkerElement({
        position: { lat, lng }, content: el,
      });
      m.addListener('click', () => {
        state.infoWindow.setContent(buildPopupContent(i));
        state.infoWindow.open({ anchor: m, map: state.map });
        activateCard(i, { centerMap: false });
      });
      state.markers[i] = m;
      clusterMarkers.push(m);
    });

    // Create MarkerClusterer
    const MCtor = await getMarkerClusterer();
    state.markerClusterer = new MCtor({
      map: state.map,
      markers: clusterMarkers,
      renderer: { render: clusterRenderer },
    });

  } else {
    // HERE Maps clustering via H.clustering.Provider
    /** @type {any[]} */
    const dataPoints = [];
    state.data.forEach((row, i) => {
      const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
      if (!isPublicLocation(row)) return;
      if (!lat || !lng) return;
      dataPoints.push(new H.clustering.DataPoint(lat, lng, null, { index: i, icon: row.icon }));
    });

    const clusterProvider = new H.clustering.Provider(dataPoints, {
      clusteringOptions: {
        eps: 40,
        minWeight: 2,
      },
      theme: makeHereClusterTheme(),
    });

    // Handle tap on cluster or noise points
    clusterProvider.addEventListener('tap', (/** @type {any} */ evt) => {
      const target = evt.target;
      const data = target.getData();
      if (data && typeof data.getWeight === 'function') {
        // It's a cluster — zoom into its bounds
        const bbox = data.getBoundingBox();
        if (bbox) {
          state.map.getViewModel().setLookAtData({ bounds: bbox }, true);
        }
      } else {
        // It's a noise point (individual marker)
        const pointData = data;
        const i = pointData?.index;
        if (i != null) {
          const row = state.data[i];
          const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
          if (state.infoBubble) {
            state.hereUi.removeBubble(state.infoBubble);
            state.infoBubble = null;
          }
          state.infoBubble = new H.ui.InfoBubble({ lat, lng }, { content: buildPopupContent(i) });
          state.hereUi.addBubble(state.infoBubble);
          activateCard(i, { centerMap: false });
        }
      }
    });

    const clusterLayer = new H.map.layer.ObjectLayer(clusterProvider);
    state.map.addLayer(clusterLayer);
    state.markerClusterer = clusterLayer;
  }
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
  await loadScript('https://js.api.here.com/v3/3.1/mapsjs-clustering.js');
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
  if (state.markerClusterer) {
    state.markerClusterer.clearMarkers();
    state.markerClusterer = null;
  }
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
