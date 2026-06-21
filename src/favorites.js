import { state } from './state.js';
import { applyFilters, heartSVG } from './render.js';

const LS_KEY = 'favorites';

// ═══════════════════════════════════════════════════
// PERSIST — write to both localStorage and URL
// ═══════════════════════════════════════════════════
export function saveFavorites() {
  const ids = [...state.favorites];

  // localStorage — survives browser close
  localStorage.setItem(LS_KEY, JSON.stringify(ids));

  // URL — makes the list shareable
  const params = new URLSearchParams(window.location.search);
  if (ids.length > 0) {
    params.set('favs', ids.join(','));
  } else {
    params.delete('favs');
  }
  const qs = params.toString();
  window.history.replaceState({}, '', qs ? `?${qs}` : window.location.pathname);
}

// ═══════════════════════════════════════════════════
// LOAD — called once on boot
// URL takes priority (shared link); falls back to localStorage
// ═══════════════════════════════════════════════════
export function loadFavorites() {
  const params = new URLSearchParams(window.location.search);
  const urlFavs = params.get('favs');

  if (urlFavs !== null) {
    // Shared link: URL is the source of truth; sync back to localStorage
    const ids = urlFavs.split(',').filter(Boolean);
    state.favorites = new Set(ids);
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
  } else {
    // Normal open: restore from localStorage, then reflect in URL
    let stored;
    try {
      const parsed = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      stored = Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string' && id) : [];
    } catch {
      stored = [];
    }
    state.favorites = new Set(stored);
    if (stored.length > 0) saveFavorites();
  }
}

// ═══════════════════════════════════════════════════
// TOGGLE — add or remove a location from favorites
// ═══════════════════════════════════════════════════
export function toggleFavorite(id, event) {
  if (event) event.stopPropagation();

  if (state.favorites.has(id)) {
    state.favorites.delete(id);
  } else {
    state.favorites.add(id);
  }

  saveFavorites();

  // Update all fav buttons that reference this id (card + popup may both exist)
  const isFav = state.favorites.has(id);
  document.querySelectorAll(`[data-fav-id="${id}"]`).forEach(btn => {
    btn.classList.toggle('fav-active', isFav);
    btn.setAttribute('aria-pressed', String(isFav));
    btn.setAttribute('aria-label', isFav ? '移除最愛' : '加入最愛');
    btn.innerHTML = heartSVG(isFav);
  });

  // If "show favorites only" is active, re-run filters so removed items disappear
  if (state.favFilterOn) applyFilters();
}
