import { state } from '../core/state.js';
import { getEffectiveTheme } from '../ui/ui.js';
import { buildPopupContent, activateCard, isPublicLocation } from '../ui/render.js';
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

/**
 * Fit the active map provider to every currently visible location.
 * A single result uses a useful place-level zoom; no results preserve the
 * current viewport.
 * @returns {boolean} whether the viewport changed
 */
export function fitMapToVisibleLocations() {
  if (!state.map) {
    state.pendingDestinationFit = true;
    return false;
  }

  const points = state.visIdx.flatMap(index => {
    const row = state.data[index];
    if (String(row?.lat ?? '').trim() === '' || String(row?.lng ?? '').trim() === '') {
      return [];
    }

    const lat = Number(row?.lat);
    const lng = Number(row?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng)
      ? [{ lat, lng }]
      : [];
  });
  state.pendingDestinationFit = false;
  if (!points.length) return false;

  if (points.length === 1) {
    state.map.setCenter(points[0]);
    state.map.setZoom(14);
    return true;
  }

  const lats = points.map(point => point.lat);
  const lngs = points.map(point => point.lng);
  const bounds = {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };

  if (state.provider === 'google') {
    state.map.fitBounds(bounds, 48);
  } else if (state.provider === 'here') {
    const rect = new H.geo.Rect(
      bounds.north,
      bounds.west,
      bounds.south,
      bounds.east
    );
    state.map.getViewModel().setLookAtData({
      bounds: rect,
      padding: { top: 48, right: 48, bottom: 48, left: 48 },
    }, true);
  }
  return true;
}

/**
 * Keep map markers aligned with the indexes selected by render.applyFilters().
 * Google can update its cluster incrementally, while HERE must rebuild its
 * clustering layer because it does not support partial add/remove operations.
 */
export function syncVisibleMarkers() {
  if (!state.map) return;

  const visibleIndexes = new Set(state.visIdx);
  if (state.provider === 'google' && state.markerClusterer) {
    /** @type {any[]} */
    const toAdd = [];
    /** @type {any[]} */
    const toRemove = [];
    const currentMarkers = state.markerClusterer.markers;
    state.markers.forEach((marker, index) => {
      if (!marker) return;
      const visible = visibleIndexes.has(index);
      const isInCluster = currentMarkers.includes(marker);
      if (visible && !isInCluster) toAdd.push(marker);
      else if (!visible && isInCluster) toRemove.push(marker);
    });
    if (toRemove.length) state.markerClusterer.removeMarkers(toRemove);
    if (toAdd.length) state.markerClusterer.addMarkers(toAdd);
  } else if (state.provider === 'here') {
    void buildMarkers();
  } else {
    state.markers.forEach((marker, index) => {
      if (!marker) return;
      const visible = visibleIndexes.has(index);
      if (state.provider === 'google') {
        marker.map = visible ? state.map : null;
      } else {
        marker.setVisibility(visible);
      }
    });
  }
}

/**
 * Re-render the currently open provider popup, for example after a language or
 * favorites change.
 * @returns {boolean} whether an active popup was updated
 */
export function refreshActivePopup() {
  if (state.activeIdx < 0) return false;

  const html = buildPopupContent(state.activeIdx);
  if (state.provider === 'google' && state.infoWindow) {
    state.infoWindow.setContent(html);
    return true;
  }
  if (state.provider === 'here' && state.infoBubble) {
    state.infoBubble.setContent(html);
    return true;
  }
  return false;
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
  const theme = getEffectiveTheme();
  if (state.provider === 'google') {
    if (state.mapTheme !== theme && state.mapConfig) reinitializeGoogleMap(theme);
  } else if (state.provider === 'here' && state.hereLayers) {
    state.map.setBaseLayer(getHereBaseLayer(state.hereLayers, theme));
    state.mapTheme = theme;
  }
}

/** @param {any} layers @param {'light'|'dark'} theme @returns {any} */
export function getHereBaseLayer(layers, theme) {
  const raster = layers?.raster?.normal;
  const vector = layers?.vector?.normal;
  if (theme === 'dark') {
    return raster?.mapnight || vector?.mapnight || raster?.map || vector?.map;
  }
  return raster?.map || vector?.map;
}

/** @param {'light'|'dark'} theme @returns {'LIGHT'|'DARK'} */
export function getGoogleColorScheme(theme) {
  return theme === 'dark' ? 'DARK' : 'LIGHT';
}

/**
 * UI locales supported by the HERE JS API 3.2 `H.ui.UI.createDefault`.
 * The `lg` tile parameter supports many more languages for map labels;
 * this table only governs which locale the default zoom/scale controls use.
 * @type {Record<string, string>}
 */
const HERE_UI_LOCALES = {
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fi: 'fi-FI',
  fr: 'fr-FR',
  it: 'it-IT',
  nl: 'nl-NL',
  pl: 'pl-PL',
  pt: 'pt-PT',
  ru: 'ru-RU',
  tr: 'tr-TR',
  zh: 'zh-CN',
};

/**
 * @param {string} language
 * @returns {{ base: string, region: string|undefined }|null}
 */
function parseBrowserLanguage(language) {
  try {
    const locale = new Intl.Locale(language.trim().replaceAll('_', '-'));
    const base = locale.language.toLowerCase();
    if (!/^[a-z]{2}$/.test(base)) return null;
    return { base, region: locale.region?.toUpperCase() };
  } catch {
    return null;
  }
}

/**
 * Convert the browser's ordered language preferences into the language values
 * supported by HERE map labels and default UI controls.
 *
 * `mapLanguage` comes from the user's top preferred language and is passed to
 * `createDefaultLayers({ lg })` — HERE's tile service supports a broad set of
 * languages here. `uiLocale` is the first language from the preference list
 * that appears in {@link HERE_UI_LOCALES} (a smaller set). The two values may
 * intentionally reference different base languages when the primary language
 * has map-label support but no matching UI locale.
 *
 * @param {readonly string[]} browserLanguages
 * @returns {{ mapLanguage: string, uiLocale: string }}
 */
export function getHereLanguagePreferences(browserLanguages = []) {
  const normalized = browserLanguages
    .filter(language => typeof language === 'string' && language.trim())
    .map(parseBrowserLanguage)
    .filter(language => language !== null);

  const mapLanguage = normalized[0]?.base || 'en';

  for (const { base, region } of normalized) {
    if (base === 'pt' && region === 'BR') {
      return { mapLanguage, uiLocale: 'pt-BR' };
    }
    if (HERE_UI_LOCALES[base]) {
      return { mapLanguage, uiLocale: HERE_UI_LOCALES[base] };
    }
  }

  return { mapLanguage, uiLocale: 'en-US' };
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
      if (data?.index === state.activeIdx) el.classList.add('active');
      const domIcon = new H.map.DomIcon(el);
      const marker = new H.map.DomMarker(noisePoint.getPosition(), {
        icon: domIcon,
        min: noisePoint.getMinZoom(),
      });
      marker.__markerContent = el;
      if (data?.index != null) state.markers[data.index] = marker;
      marker.setData(noisePoint.getData());
      return marker;
    },
  };
}

/**
 * @param {{ markerClustererCtor?: any }} [options]
 */
export async function buildMarkers(options = {}) {
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
    state.data.forEach((row, i) => {
      const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
      if (!isPublicLocation(row)) return;
      if (!lat || !lng) return;
      const el = makeMarkerContent(row.icon);
      if (state.activeIdx === i) el.classList.add('active');
      // NOTE: do NOT set map here; MarkerClusterer will manage it
      const m = new google.maps.marker.AdvancedMarkerElement({
        position: { lat, lng }, content: el,
      });
      m.__markerContent = el;
      m.addListener('click', () => {
        state.infoWindow.setContent(buildPopupContent(i));
        state.infoWindow.open({ anchor: m, map: state.map });
        activateCard(i, { centerMap: false });
      });
      state.markers[i] = m;
    });

    // Keep every public marker available for later filter changes, but seed
    // the cluster with only the locations visible under the current filters.
    const MCtor = options.markerClustererCtor || await getMarkerClusterer();
    const visibleIndexes = new Set(state.visIdx);
    const clusterMarkers = state.markers.filter(
      (marker, index) => marker && visibleIndexes.has(index)
    );
    state.markerClusterer = new MCtor({
      map: state.map,
      markers: clusterMarkers,
      renderer: { render: clusterRenderer },
    });

  } else {
    // HERE Maps clustering via H.clustering.Provider
    /** @type {any[]} */
    const dataPoints = [];
    const visibleIndexes = new Set(state.visIdx);
    state.data.forEach((row, i) => {
      const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
      if (!isPublicLocation(row)) return;
      if (!visibleIndexes.has(i)) return;
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
  link.href = 'https://js.api.here.com/v3/3.2/mapsjs-ui.css';
  document.head.appendChild(link);
  await loadScript('https://js.api.here.com/v3/3.2/mapsjs-core.js');
  await loadScript('https://js.api.here.com/v3/3.2/mapsjs-service.js');
  await loadScript('https://js.api.here.com/v3/3.2/mapsjs-ui.js');
  await loadScript('https://js.api.here.com/v3/3.2/mapsjs-mapevents.js');
  await loadScript('https://js.api.here.com/v3/3.2/mapsjs-clustering.js');
}

// ═══════════════════════════════════════════════════
// GOOGLE MAPS INIT
// ═══════════════════════════════════════════════════
/**
 * @param {MapConfig} cfg
 * @param {{center?: any, zoom?: number}} [view]
 */
function initWithGoogle(cfg, view = {}) {
  state.provider = 'google';
  state.mapConfig = cfg;
  state.mapTheme = getEffectiveTheme();
  requiredElement('map-loading').classList.add('is-hidden');

  state.map = new google.maps.Map(requiredElement('map'), {
    center: view.center || { lat: 13.82, lng: 100.52 }, zoom: view.zoom ?? 11,
    mapId: cfg.googleMapId,
    colorScheme: getGoogleColorScheme(state.mapTheme),
    backgroundColor: state.mapTheme === 'dark' ? '#111827' : '#e5e7eb',
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
  if (state.pendingDestinationFit) fitMapToVisibleLocations();
}

/**
 * Google Maps only accepts colorScheme during construction, so preserve the
 * viewport and rebuild the map when the user changes theme.
 * @param {'light'|'dark'} theme
 */
function reinitializeGoogleMap(theme) {
  if (!state.map || !state.mapConfig) return;
  const center = state.map.getCenter?.() || { lat: 13.82, lng: 100.52 };
  const zoom = state.map.getZoom?.() ?? 11;

  if (state.markerClusterer) {
    state.markerClusterer.clearMarkers();
    state.markerClusterer = null;
  }
  state.markers.forEach(marker => { if (marker) marker.map = null; });
  state.markers.length = 0;
  if (state.infoWindow) state.infoWindow.close();
  if (state.userLocationMarker) {
    state.userLocationMarker.map = null;
    state.userLocationMarker = null;
  }
  if (state.googleErrorObserver) {
    state.googleErrorObserver.disconnect();
    state.googleErrorObserver = null;
  }

  state.mapTheme = theme;
  requiredElement('map').innerHTML = '';
  initWithGoogle(state.mapConfig, { center, zoom });
}

// ═══════════════════════════════════════════════════
// HERE MAPS INIT
// ═══════════════════════════════════════════════════
/** @param {string} apiKey */
function initWithHere(apiKey) {
  state.provider = 'here';
  state.mapTheme = getEffectiveTheme();
  const browserLanguages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  const { mapLanguage, uiLocale } = getHereLanguagePreferences(browserLanguages);
  const loadingEl = requiredElement('map-loading');
  const msgEl = document.getElementById('map-loading-msg');
  loadingEl.classList.add('is-hidden');
  if (msgEl) msgEl.textContent = '';

  const platform = new H.service.Platform({ apikey: apiKey });
  // HERE 3.2 uses HARP as its only renderer. The app uses the matching raster
  // day/night pair because some deployments expose a vector night layer that
  // resolves successfully but renders blank tiles.
  const layers = platform.createDefaultLayers({
    engineType: H.Map.EngineType.HARP,
    lg: mapLanguage,
  });
  state.hereLayers = layers;

  state.map = new H.Map(
    requiredElement('map'),
    getHereBaseLayer(layers, state.mapTheme),
    {
      engineType: H.Map.EngineType.HARP,
      pixelRatio: window.devicePixelRatio || 1,
      zoom: 11,
      center: { lat: 13.82, lng: 100.52 },
    }
  );
  new H.mapevents.Behavior(new H.mapevents.MapEvents(state.map));
  state.hereUi = H.ui.UI.createDefault(state.map, layers, uiLocale);

  updateProviderBadge('here');
  buildMarkers();
  if (state.pendingDestinationFit) fitMapToVisibleLocations();
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
