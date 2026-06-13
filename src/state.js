// ═══════════════════════════════════════════════════
// SHARED MUTABLE STATE
// All modules read/write via this object so ES-module live-binding
// semantics are not needed for reassignable references.
// ═══════════════════════════════════════════════════
export const state = {
  // Location data loaded from /api/locations
  data: [],
  // Indices into data[] that pass the current filter
  visIdx: [],
  // Index of the currently active/highlighted card
  activeIdx: -1,

  // Google Maps objects — set in initMapCallback
  map: null,
  infoWindow: null,
  googleMapId: null,
  // Sparse array: markers[i] corresponds to data[i]
  markers: [],
  // Blue-dot marker for the user's GPS position
  userLocationMarker: null,

  // Snackbar auto-dismiss timer handle
  snackTimer: null,

  // True until the first sheet load attempt completes
  isLoading: true,
};
