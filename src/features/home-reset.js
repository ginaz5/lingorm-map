// ═══════════════════════════════════════════════════
// HOME RESET — the header title returns to the default view
// ═══════════════════════════════════════════════════
// Tapping "LingOrm Map" clears every narrowing control (search, the sheet
// filters, favorites-only, the exchange sort) and the current selection, then
// shows the list tab from the top and refits the map. It deliberately does not
// reload the page: favorites, language, theme and the shared `?fav=` link
// survive the reset.
//
// The callers own the filter mechanics. Their clears here are silent (state and
// DOM only), so this module rebuilds once and reports one analytics event.

/**
 * @typedef {Object} HomeResetDeps
 * @property {Document} [documentRoot]
 * @property {() => void} clearSearch empty the search box and drop its pending analytics
 * @property {() => void} clearFilters silently clear filters, favorites-only and the exchange sort
 * @property {() => void} clearActiveLocation selected card, marker and popup
 * @property {() => void} showListFromTop
 * @property {() => void} applyFilters single rebuild after the clears
 * @property {() => void} trackReset
 */

/**
 * Wire the header title. Returns null when the button is absent, so pages that
 * share these styles without the map (changelog, 404) stay untouched.
 * @param {HomeResetDeps} deps
 * @returns {{resetToHome: () => void}|null}
 */
export function initHomeReset({
  documentRoot = document,
  clearSearch,
  clearFilters,
  clearActiveLocation,
  showListFromTop,
  applyFilters,
  trackReset,
}) {
  const button = documentRoot.getElementById('home-btn');
  if (!button) return null;

  function resetToHome() {
    clearSearch();
    clearFilters();
    clearActiveLocation();
    showListFromTop();
    applyFilters();
    trackReset();
  }

  button.addEventListener('click', resetToHome);
  return { resetToHome };
}
