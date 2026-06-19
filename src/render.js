import { lang, t, tobj, CATEGORIES } from './i18n.js';
import { state } from './state.js';
import { switchTab } from './ui.js';

// ═══════════════════════════════════════════════════
// BADGE / STATUS HELPERS
// ═══════════════════════════════════════════════════
export function getBadgeClass(s) {
  if (s === 'Verified') return 'b-verified';
  if (s === 'Could Not Find') return 'b-notfound';
  return 'b-review';
}

export function isPublicLocation(row) {
  return row.status !== 'Could Not Find';
}

export function isApproximateCoords(row) {
  return /^(true|yes|1|approx|approximate)$/i.test(String(row.approx || '').trim());
}

// ═══════════════════════════════════════════════════
// SOURCE TAGS
// ═══════════════════════════════════════════════════
export function renderSources(row) {
  const src = row.src || '';
  const srcUrl = row.sourceUrl || '';
  if (!src) return '';
  const tokens = src.split(/\s*[+,]\s*/).map(s => s.trim()).filter(Boolean);
  const urls = srcUrl.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
  const tags = tokens.map((token, idx) => {
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
      <span class="badge ${getBadgeClass(row.status)}">${tobj('badge', row.status)}</span>
    </div>
    <div class="popup-notes">${notes}</div>
    ${approx ? `<div class="approx-tag">${t('approx')}</div>` : ''}
    <div class="popup-footer">
      ${renderSources(row)}
      ${hasCoords ? `<div class="popup-btn-group">
        <button class="popup-nav-btn" onclick="openNavigation(${i})" aria-label="${t('nav_btn')}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 3l-7.5 18-3-7.5L3 11 21 3z"/></svg>
          <span class="popup-btn-label">${t('nav_btn')}</span>
        </button>
        <button class="popup-maps-btn" onclick="openInGoogleMaps(${i})" aria-label="${t('open_maps_btn')}">
          <svg width="12" height="14" viewBox="0 0 48 56" aria-hidden="true"><path d="M24 2C13.5 2 5 10.5 5 21c0 14 19 33 19 33S43 35 43 21C43 10.5 34.5 2 24 2z" fill="#34A853"/><path d="M24 2 L5 21 L24 21 Z" fill="#EA4335"/><path d="M24 2 L43 21 L24 21 Z" fill="#4285F4"/><path d="M5 21 L24 21 L24 40 Z" fill="#FBBC04"/><circle cx="24" cy="21" r="8" fill="white"/></svg>
          <span class="popup-btn-label">${t('open_maps_btn')}</span>
        </button>
      </div>` : ''}
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════
// CARD LIST
// ═══════════════════════════════════════════════════
export function renderList() {
  const list = document.getElementById('loc-list');
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
    const st = row.status;
    const needsHelp = st === 'Needs Review';
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
        <span class="badge ${getBadgeClass(st)}">${tobj('badge', st)}</span>
        ${row.dup ? `<span class="badge b-dup">${row.dup}</span>` : ''}
      </div>
      <div class="card-notes">${notes}</div>
      ${approx ? `<div class="approx-tag">${t('approx')}</div>` : ''}
      ${renderSources(row)}
      <div class="card-footer">
        <span></span>
        <button class="card-edit-btn${needsHelp ? ' verify-hint' : ''}"
          onclick="event.stopPropagation();openEditModal(${i})">
          ${needsHelp ? t('edit_btn_verify') : t('edit_btn_edit')}
        </button>
      </div>
    </div>`;
  }).join('');
}

export function activateCard(i) {
  state.activeIdx = i;
  const row = state.data[i];
  const lat = parseFloat(row.lat), lng = parseFloat(row.lng);

  if (lat && lng && state.map) {
    if (window.innerWidth <= 700) switchTab('map');
    if (state.provider === 'google') {
      state.map.panTo({ lat, lng });
      state.map.setZoom(15);
      if (state.markers[i] && state.infoWindow) {
        state.infoWindow.setContent(buildPopupContent(i));
        state.infoWindow.open({ anchor: state.markers[i], map: state.map });
      }
    } else if (state.provider === 'here') {
      state.map.setCenter({ lat, lng });
      state.map.setZoom(15);
      if (state.markers[i] && state.hereUi) {
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
    const raf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (cb) => cb();
    raf(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
}

export function applyFilters() {
  const q = document.getElementById('search').value.toLowerCase();
  const cat = document.getElementById('cat-filter').value;
  const st = document.getElementById('status-filter').value;
  state.visIdx = [];
  state.data.forEach((row, i) => {
    const nameHit = (row.nameEn + row.nameZh + row.alt).toLowerCase().includes(q);
    const notesHit = (row.notesEn + row.notesZh).toLowerCase().includes(q);
    const catVal = lang === 'zh' ? row.catZh : row.catEn;
    const catHit = !cat || catVal === cat;
    const stHit = !st || row.status === st;
    if (!isPublicLocation(row)) return;
    if ((nameHit || notesHit) && catHit && stHit) state.visIdx.push(i);
  });
  renderList();
  const publicTotal = state.data.filter(isPublicLocation).length;
  document.getElementById('result-info').textContent = state.isLoading ? '' : t('count', state.visIdx.length, publicTotal);
}

// ═══════════════════════════════════════════════════
// i18n — SELECT HELPERS + UI UPDATER
// ═══════════════════════════════════════════════════
export function rebuildSelect(sel, html) {
  const prev = sel.value;
  sel.innerHTML = html;
  sel.value = prev;
}

export function updateLangUI() {
  document.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-ph]').forEach(el => {
    if (el.dataset.i18n) { const v = t(el.dataset.i18n); if (v !== el.dataset.i18n) el.textContent = v; }
    else if (el.dataset.i18nHtml) { const v = t(el.dataset.i18nHtml); if (v !== el.dataset.i18nHtml) el.innerHTML = v; }
    else if (el.dataset.i18nPh) { const v = t(el.dataset.i18nPh); if (v !== el.dataset.i18nPh) el.placeholder = v; }
  });
  document.getElementById('lang-btn-label').textContent = t('lang_btn');
  buildStatusFilter();
}

export function buildStatusFilter() {
  const publicStatuses = Object.entries(t('status')).filter(([status]) => status !== 'Could Not Find');
  rebuildSelect(
    document.getElementById('status-filter'),
    `<option value="">${t('all_status')}</option>` +
    publicStatuses.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')
  );
}

export function buildCatFilter() {
  const cats = new Set();
  state.data.forEach(r => cats.add(lang === 'zh' ? r.catZh : r.catEn));
  rebuildSelect(
    document.getElementById('cat-filter'),
    `<option value="">${t('all_cat')}</option>` +
    [...cats].sort().map(c => `<option value="${c}">${c}</option>`).join('')
  );
}

export function buildCatDropdown() {
  const sel = document.getElementById('add-cat');
  const prev = sel.value;
  sel.innerHTML = CATEGORIES.map(c =>
    `<option value="${c.en}">${c.icon} ${lang === 'zh' ? c.zh : c.en}</option>`
  ).join('');
  if (prev) sel.value = prev;
}
