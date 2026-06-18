import { state } from './state.js';
import { getEffectiveTheme, switchTab } from './ui.js';
import { buildPopupContent, activateCard, getBadgeClass, isPublicLocation } from './render.js';

// ═══════════════════════════════════════════════════
// MAP THEME
// ═══════════════════════════════════════════════════
export function updateMapTheme() {
  if (!state.map || !state.hereLayers) return;
  const layer = getHereBaseLayer(state.hereLayers, getEffectiveTheme());
  state.map.setBaseLayer(layer);
}

export function getHereBaseLayer(layers, theme) {
  const normalVectorLayers = layers?.vector?.normal;
  if (theme === 'dark') {
    return normalVectorLayers?.mapnight || normalVectorLayers?.map;
  }
  return normalVectorLayers?.map;
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
  state.markers.forEach(m => { if (m) state.map.removeObject(m); });
  state.markers.length = 0;
  state.data.forEach((row, i) => {
    const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
    if (!isPublicLocation(row)) return;
    if (!lat || !lng) return;
    const el = makeMarkerContent(row.status, row.icon);
    const domIcon = new H.map.DomIcon(el);
    const m = new H.map.DomMarker({ lat, lng }, { icon: domIcon });
    m.addEventListener('tap', () => {
      // Close existing bubble
      if (state.infoBubble) {
        state.hereUi.removeBubble(state.infoBubble);
        state.infoBubble = null;
      }
      state.infoBubble = new H.ui.InfoBubble({ lat, lng }, {
        content: buildPopupContent(i),
      });
      state.hereUi.addBubble(state.infoBubble);
      activateCard(i);
      if (window.innerWidth <= 700) switchTab('list');
    });
    state.map.addObject(m);
    state.markers[i] = m;
  });
}

// ═══════════════════════════════════════════════════
// HERE MAPS INIT
// ═══════════════════════════════════════════════════
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

export function initMap(apiKey) {
  document.getElementById('map-loading').classList.add('is-hidden');

  const platform = new H.service.Platform({ apikey: apiKey });
  const layers = platform.createDefaultLayers();
  state.hereLayers = layers;

  const baseLayer = getHereBaseLayer(layers, getEffectiveTheme());

  state.map = new H.Map(
    document.getElementById('map'),
    baseLayer,
    { zoom: 11, center: { lat: 13.82, lng: 100.52 } }
  );

  // Enable map interaction (pan, zoom)
  new H.mapevents.Behavior(new H.mapevents.MapEvents(state.map));

  // Default UI (zoom controls, scale bar)
  state.hereUi = H.ui.UI.createDefault(state.map, layers);

  buildMarkers();
}

export async function loadHereMapsScript() {
  try {
    const resp = await fetch('/api/config');
    if (!resp.ok) throw new Error(resp.status);
    const cfg = await resp.json();

    // Inject HERE CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://js.api.here.com/v3/3.1/mapsjs-ui.css';
    document.head.appendChild(link);

    // Load HERE scripts in dependency order
    await loadScript('https://js.api.here.com/v3/3.1/mapsjs-core.js');
    await loadScript('https://js.api.here.com/v3/3.1/mapsjs-service.js');
    await loadScript('https://js.api.here.com/v3/3.1/mapsjs-ui.js');
    await loadScript('https://js.api.here.com/v3/3.1/mapsjs-mapevents.js');

    initMap(cfg.hereApiKey);
  } catch (e) {
    console.error('HERE Maps config failed', e);
    document.getElementById('map-loading').classList.add('is-hidden');
  }
}
