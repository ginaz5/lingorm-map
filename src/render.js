import { lang, t } from './i18n.js';
import { state } from './state.js';
import { switchTab } from './ui.js';

/** @typedef {import('./csv-parser.js').LocationRow} LocationRow */

/** @param {string} id @returns {HTMLElement} */
function requiredElement(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el;
}

/** @param {string} id @returns {HTMLInputElement} */
function requiredInput(id) {
  return /** @type {HTMLInputElement} */ (requiredElement(id));
}

/** @param {string} id @returns {HTMLSelectElement} */
function requiredSelect(id) {
  return /** @type {HTMLSelectElement} */ (requiredElement(id));
}

const HEART_PATH = "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";
/** @param {boolean} active @returns {string} */
export const heartSVG = (active) =>
  `<svg width="18" height="18" viewBox="0 0 24 24"
    fill="${active ? '#e05252' : 'none'}"
    stroke="${active ? '#e05252' : 'currentColor'}"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"><path d="${HEART_PATH}"/></svg>`;

// ═══════════════════════════════════════════════════
// PUBLICATION HELPERS
// ═══════════════════════════════════════════════════
export const MIGRATION_PUBLIC_LOCATION_STATUSES = Object.freeze([
  'Verified',
  'Needs Review',
  'Published',
]);

/** @param {LocationRow} row @returns {boolean} */
export function isPublicLocation(row) {
  return MIGRATION_PUBLIC_LOCATION_STATUSES.includes(row.status);
}

/** @param {LocationRow} row @returns {boolean} */
export function isApproximateCoords(row) {
  return /^(true|yes|1|approx|approximate)$/i.test(String(row.approx || '').trim());
}

// ═══════════════════════════════════════════════════
// SOURCE TAGS
// ═══════════════════════════════════════════════════
/** @param {LocationRow} row @returns {string} */
export function renderSources(row) {
  const src = row.src || '';
  const srcUrl = row.sourceUrl || '';
  if (!src) return '';
  const tokens = src.split(/\s*[+,]\s*/).map((/** @type {string} */ s) => s.trim()).filter(Boolean);
  const urls = srcUrl.split(/\s*,\s*/).map((/** @type {string} */ s) => s.trim()).filter(Boolean);
  const tags = tokens.map((token, idx) => {
    /** @param {string} label @param {string} url */
    const labelFor = (label, url) => {
      if (label === 'Threads') {
        const handle = (url.match(/threads\.(?:com|net)\/@([^/?#]+)/i) || [])[1];
        if (handle) return `Threads @${handle}`;
      }
      return label;
    };
    // Match "@handle" or "Threads @handle" — link to specific post if available
    const handleMatch = token.match(/@(\S+)$/);
    if (handleMatch) {
      const url = urls[idx] || urls[0] || `https://www.threads.net/@${handleMatch[1]}`;
      return `<a class="src-tag" href="${url}" target="_blank" onclick="event.stopPropagation()">${token}</a>`;
    }
    /** @type {Record<string,string>} */
    const PLATFORM_URLS = {
      'KKday':'https://www.kkday.com','Trip.com':'https://www.trip.com',
      'Threads':'https://www.threads.net','Douban':'https://www.douban.com',
      'Google Maps':'https://maps.google.com',
    };
    const url = urls[idx] || urls[0] || PLATFORM_URLS[token] || '';
    if (url) {
      return `<a class="src-tag" href="${url}" target="_blank" onclick="event.stopPropagation()">${labelFor(token, url)}</a>`;
    }
    return `<span class="src-tag src-tag-plain">${token}</span>`;
  });
  return `<div class="src-tags">${tags.join('')}</div>`;
}

// ═══════════════════════════════════════════════════
// POPUP CONTENT (used by HERE map bubbles)
// ═══════════════════════════════════════════════════
/** @param {number} i @returns {string} */
export function buildPopupContent(i) {
  const row = state.data[i];
  const name = lang === 'zh' ? row.nameZh : row.nameEn;
  const notes = lang === 'zh' ? row.notesZh : row.notesEn;
  const cat = lang === 'zh' ? row.catZh : row.catEn;
  const approx = isApproximateCoords(row);
  const hasCoords = parseFloat(row.lat) && parseFloat(row.lng);
  return `<div class="popup-content">
    <div class="popup-name">${row.icon} ${name}</div>
    ${row.alt ? `<div class="popup-alt">${row.alt}</div>` : ''}
    <div class="badges popup-badges">
      <span class="badge b-cat">${cat}</span>
    </div>
    <div class="popup-notes">${notes}</div>
    ${approx ? `<div class="approx-tag">${t('approx')}</div>` : ''}
    <div class="popup-footer">
      ${renderSources(row)}
      <div class="popup-actions">
        <button class="fav-btn${state.favorites.has(row.id) ? ' fav-active' : ''}"
          data-fav-id="${row.id}"
          aria-pressed="${state.favorites.has(row.id)}"
          aria-label="${state.favorites.has(row.id) ? '移除最愛' : '加入最愛'}"
          onclick="toggleFavorite('${row.id}')">
          ${heartSVG(state.favorites.has(row.id))}
        </button>
        ${hasCoords ? `
        <button class="popup-nav-btn" onclick="openNavigation(${i})" aria-label="${t('nav_btn')}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 3l-7.5 18-3-7.5L3 11 21 3z"/></svg>
        </button>
        <button class="popup-maps-btn" onclick="openInGoogleMaps(${i})" aria-label="${t('open_maps_btn')}">
          <svg width="12" height="14" viewBox="0 0 48 56" aria-hidden="true"><path d="M24 2C13.5 2 5 10.5 5 21c0 14 19 33 19 33S43 35 43 21C43 10.5 34.5 2 24 2z" fill="#34A853"/><path d="M24 2 L5 21 L24 21 Z" fill="#EA4335"/><path d="M24 2 L43 21 L24 21 Z" fill="#4285F4"/><path d="M5 21 L24 21 L24 40 Z" fill="#FBBC04"/><circle cx="24" cy="21" r="8" fill="white"/></svg>
        </button>` : ''}
      </div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════
// CARD LIST
// ═══════════════════════════════════════════════════
export function renderList() {
  const list = requiredElement('loc-list');
  if (state.isLoading) {
    list.innerHTML = `<div class="empty"><div class="loading-spinner"></div>${t('sheet_loading')}</div>`;
    return;
  }
  if (!state.visIdx.length) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div>${t('empty')}</div>`;
    return;
  }
  list.innerHTML = state.visIdx.map(i => {
    const row = state.data[i];
    const name = lang === 'zh' ? row.nameZh : row.nameEn;
    const notes = lang === 'zh' ? row.notesZh : row.notesEn;
    const cat = lang === 'zh' ? row.catZh : row.catEn;
    const approx = isApproximateCoords(row);
    return `<div class="loc-card${state.activeIdx === i ? ' active' : ''}" id="card-${i}" onclick="activateCard(${i})">
      <div class="card-head">
        <div class="card-icon">${row.icon}</div>
        <div class="card-title-wrap">
          <div class="card-name">${name}</div>
          ${row.alt ? `<div class="card-alt">${row.alt}</div>` : ''}
        </div>
      </div>
      <div class="badges">
        <span class="badge b-cat">${cat}</span>
      </div>
      <div class="card-notes">${notes}</div>
      ${approx ? `<div class="approx-tag">${t('approx')}</div>` : ''}
      ${renderSources(row)}
      <div class="card-footer">
        <button class="fav-btn${state.favorites.has(row.id) ? ' fav-active' : ''}"
          data-fav-id="${row.id}"
          aria-pressed="${state.favorites.has(row.id)}"
          aria-label="${state.favorites.has(row.id) ? '移除最愛' : '加入最愛'}"
          onclick="event.stopPropagation();toggleFavorite('${row.id}')">
          ${heartSVG(state.favorites.has(row.id))}
        </button>
      </div>
    </div>`;
  }).join('');
}

/**
 * @param {number} i
 * @param {{ centerMap?: boolean }} [options]
 */
export function activateCard(i, options = {}) {
  const centerMap = options.centerMap !== false;
  state.activeIdx = i;
  const row = state.data[i];
  const lat = parseFloat(row.lat), lng = parseFloat(row.lng);

  if (centerMap && lat && lng && state.map) {
    if (window.innerWidth <= 700) switchTab('map');
    if (state.provider === 'google') {
      state.map.setCenter({ lat, lng });
      state.map.setZoom(15);
      if (state.markers[i] && state.infoWindow) {
        state.infoWindow.setContent(buildPopupContent(i));
        state.infoWindow.open({ anchor: state.markers[i], map: state.map });
      }
    } else if (state.provider === 'here') {
      state.map.setCenter({ lat, lng });
      state.map.setZoom(15);
      if (state.hereUi) {
        if (state.infoBubble) {
          state.hereUi.removeBubble(state.infoBubble);
          state.infoBubble = null;
        }
        state.infoBubble = new H.ui.InfoBubble({ lat, lng }, { content: buildPopupContent(i) });
        state.hereUi.addBubble(state.infoBubble);
      }
    }
  }

  document.querySelectorAll('.loc-card').forEach(c => c.classList.remove('active'));
  const card = document.getElementById('card-' + i);
  if (card) {
    card.classList.add('active');
    const raf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (/** @type {FrameRequestCallback} */ cb) => { cb(0); return 0; };
    raf(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
}

export function applyFilters() {
  const q = requiredInput('search').value.toLowerCase();
  const cat = requiredSelect('cat-filter').value;
  state.visIdx = [];
  state.data.forEach((row, i) => {
    const nameHit = (row.nameEn + row.nameZh + row.alt).toLowerCase().includes(q);
    const notesHit = (row.notesEn + row.notesZh).toLowerCase().includes(q);
    const catVal = lang === 'zh' ? row.catZh : row.catEn;
    const catHit = !cat || catVal === cat;
    if (!isPublicLocation(row)) return;
    if (state.favFilterOn && !state.favorites.has(row.id)) return;
    if ((nameHit || notesHit) && catHit) state.visIdx.push(i);
  });
  renderList();
  if (state.map) {
    if (state.provider === 'google' && state.markerClusterer) {
      // Use MarkerClusterer add/remove APIs for Google
      /** @type {any[]} */
      const toAdd = [];
      /** @type {any[]} */
      const toRemove = [];
      const currentMarkers = state.markerClusterer.markers;
      state.markers.forEach((m, i) => {
        if (!m) return;
        const row = state.data[i];
        const visible = !state.favFilterOn || state.favorites.has(row.id);
        const isInCluster = currentMarkers.includes(m);
        if (visible && !isInCluster) toAdd.push(m);
        else if (!visible && isInCluster) toRemove.push(m);
      });
      if (toRemove.length) state.markerClusterer.removeMarkers(toRemove);
      if (toAdd.length) state.markerClusterer.addMarkers(toAdd);
    } else if (state.provider === 'here') {
      // HERE clustering doesn't support partial add/remove;
      // rebuild the entire clustering layer via buildMarkers()
      import('./map.js').then(({ buildMarkers }) => buildMarkers());
    } else {
      // Fallback: direct marker visibility toggle
      state.markers.forEach((m, i) => {
        if (!m) return;
        const row = state.data[i];
        const visible = !state.favFilterOn || state.favorites.has(row.id);
        if (state.provider === 'google') {
          m.map = visible ? state.map : null;
        } else {
          m.setVisibility(visible);
        }
      });
    }
  }
  const publicTotal = state.data.filter(isPublicLocation).length;
  requiredElement('result-info').textContent = state.isLoading ? '' : t('count', state.visIdx.length, publicTotal);
}

// ═══════════════════════════════════════════════════
// i18n — SELECT HELPERS + UI UPDATER
// ═══════════════════════════════════════════════════
/** @param {HTMLSelectElement} sel @param {string} html */
export function rebuildSelect(sel, html) {
  const prev = sel.value;
  sel.innerHTML = html;
  sel.value = prev;
}

export function updateLangUI() {
  document.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-ph]').forEach(rawEl => {
    const el = /** @type {HTMLElement} */ (rawEl);
    if (el.dataset.i18n) { const v = t(el.dataset.i18n); if (v !== el.dataset.i18n) el.textContent = v; }
    else if (el.dataset.i18nHtml) { const v = t(el.dataset.i18nHtml); if (v !== el.dataset.i18nHtml) el.innerHTML = v; }
    else if (el.dataset.i18nPh) { const v = t(el.dataset.i18nPh); if (v !== el.dataset.i18nPh) /** @type {HTMLInputElement|HTMLTextAreaElement} */ (el).placeholder = v; }
  });
  const langBtnLabel = document.getElementById('lang-btn-label');
  if (!langBtnLabel) throw new Error('Missing required element #lang-btn-label');
  langBtnLabel.textContent = t('lang_btn');
}

export function buildCatFilter() {
  const cats = new Set();
  state.data
    .filter(isPublicLocation)
    .forEach(r => cats.add(lang === 'zh' ? r.catZh : r.catEn));
  const catFilter = /** @type {HTMLSelectElement|null} */ (document.getElementById('cat-filter'));
  if (!catFilter) throw new Error('Missing required element #cat-filter');
  rebuildSelect(
    catFilter,
    `<option value="">${t('all_cat')}</option>` +
    [...cats].sort().map(c => `<option value="${c}">${c}</option>`).join('')
  );
}
