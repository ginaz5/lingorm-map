// ═══════════════════════════════════════════════════
// SHARED MUTABLE STATE
// All modules read/write via this object so ES-module live-binding
// semantics are not needed for reassignable references.
// ═══════════════════════════════════════════════════
/** @typedef {import('./csv-parser.js').LocationRow} LocationRow */
/** @typedef {'google'|'here'|null} MapProvider */
/**
 * @typedef {Object} AppState
 * @property {LocationRow[]} data
 * @property {number[]} visIdx
 * @property {number} activeIdx
 * @property {MapProvider} provider
 * @property {any} map
 * @property {any} mapConfig
 * @property {'light'|'dark'} mapTheme
 * @property {any} infoWindow
 * @property {MutationObserver|null} googleErrorObserver
 * @property {any} hereUi
 * @property {any} hereLayers
 * @property {any} infoBubble
 * @property {any[]} markers
 * @property {any} markerClusterer
 * @property {any} userLocationMarker
 * @property {ReturnType<typeof setTimeout>|null} snackTimer
 * @property {boolean} isLoading
 * @property {Set<string>} favorites
 * @property {boolean} favFilterOn
 * @property {Set<string>} selectedDestinations
 * @property {boolean} pendingDestinationFit
 */

/** @type {AppState} */
export const state = {
  // Location data loaded from /api/locations
  data: [],
  // Indices into data[] that pass the current filter
  visIdx: [],
  // Index of the currently active/highlighted card
  activeIdx: -1,

  // Active map provider: 'google' | 'here' | null
  provider: null,

  // Shared map object (google.maps.Map or H.Map)
  map: null,
  mapConfig: null,
  mapTheme: 'light',

  // Google Maps-specific
  infoWindow: null,
  googleErrorObserver: null,

  // HERE Maps-specific
  hereUi: null,
  hereLayers: null,
  infoBubble: null,

  // Sparse array: markers[i] corresponds to data[i]
  markers: [],
  // Google MarkerClusterer or HERE clustering layer
  markerClusterer: null,
  // Blue-dot marker for the user's GPS position
  userLocationMarker: null,

  // Snackbar auto-dismiss timer handle
  snackTimer: null,

  // True until the first sheet load attempt completes
  isLoading: true,

  // Favorites — Set of location id slugs
  favorites: new Set(),
  // Whether the "show favorites only" filter is active
  favFilterOn: false,

  // Destination filter — empty means every destination.
  selectedDestinations: new Set(),
  // Fit the map after it becomes available (used when restoring a saved filter).
  pendingDestinationFit: false,
};
