// ═══════════════════════════════════════════════════
// HOME RESET — the header title returns to the default view
// ═══════════════════════════════════════════════════
// Tapping "LingOrm Map" clears every narrowing control (search, the sheet
// filters, favorites-only) and the current selection, then shows the list tab
// from the top. It deliberately does not reload the page: favorites, language,
// theme and the shared `?fav=` link survive the reset.
//
// The callers own the filter mechanics so this module never duplicates their
// analytics or DOM bookkeeping; it only sequences them and rebuilds once.

/**
 * @typedef {Object} HomeResetDeps
 * @property {Document} [documentRoot]
 * @property {() => void} clearFilters category, label and destination filters
 * @property {(on: boolean) => void} setFavoritesFilter favorites-only toggle
 * @property {() => void} clearActiveLocation selected card, marker and popup
 * @property {(tab: 'map'|'list') => void} switchTab
 * @property {() => void} applyFilters single rebuild after the clears
 */

/**
 * Wire the header title. Returns null when the button is absent, so pages that
 * share these styles without the map (changelog, 404) stay untouched.
 * @param {HomeResetDeps} deps
 * @returns {{resetToHome: () => void}|null}
 */
export function initHomeReset({
  documentRoot = document,
  clearFilters,
  setFavoritesFilter,
  clearActiveLocation,
  switchTab,
  applyFilters,
}) {
  const button = documentRoot.getElementById('home-btn');
  if (!button) return null;

  function resetToHome() {
    const search = /** @type {HTMLInputElement|null} */ (documentRoot.getElementById('search'));
    if (search) search.value = '';
    clearFilters();
    setFavoritesFilter(false);
    clearActiveLocation();
    switchTab('list');
    const list = documentRoot.getElementById('loc-list');
    if (list) list.scrollTop = 0;
    applyFilters();
  }

  button.addEventListener('click', resetToHome);
  return { resetToHome };
}
