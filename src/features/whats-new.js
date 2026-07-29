import { lang, t } from '../core/i18n.js';
import {
  CHANGELOG,
  CURRENT_CHANGELOG_RELEASE_ID,
  localizeChangelogItem,
} from './changelog-data.js';

const LS_KEY = 'last_visit_time';
const RELEASE_LS_KEY = 'last_seen_changelog_release';
const SS_KEY = 'whats_new_shown';
export const WHATS_NEW_PREVIEW_LIMIT = 3;

// ═══════════════════════════════════════════════════
// CLOSE
// ═══════════════════════════════════════════════════
export function closeWhatsNew() {
  localStorage.setItem(LS_KEY, String(Date.now()));
  localStorage.setItem(RELEASE_LS_KEY, CURRENT_CHANGELOG_RELEASE_ID);
  sessionStorage.setItem(SS_KEY, '1');
  document.getElementById('whats-new-modal')?.classList.remove('open');
}

// ═══════════════════════════════════════════════════
// CHECK & SHOW
// ═══════════════════════════════════════════════════
export function checkWhatsNew() {
  const lastVisit = localStorage.getItem(LS_KEY);

  // First visit: silently record time, don't show anything
  if (!lastVisit) {
    localStorage.setItem(LS_KEY, String(Date.now()));
    localStorage.setItem(RELEASE_LS_KEY, CURRENT_CHANGELOG_RELEASE_ID);
    return;
  }

  // Already shown this session (multi-tab guard)
  if (sessionStorage.getItem(SS_KEY)) return;

  if (localStorage.getItem(RELEASE_LS_KEY) === CURRENT_CHANGELOG_RELEASE_ID) return;

  const newItems = CHANGELOG
    .filter(item => item.releaseId === CURRENT_CHANGELOG_RELEASE_ID)
    .sort((a, b) => b.publishTime - a.publishTime);

  if (newItems.length === 0) return;

  _populateModal(newItems.slice(0, WHATS_NEW_PREVIEW_LIMIT), newItems.length);

  setTimeout(() => {
    document.getElementById('whats-new-modal')?.classList.add('open');
  }, 500);
}

// ═══════════════════════════════════════════════════
// DOM — populate feature list + static text
// ═══════════════════════════════════════════════════

/** @type {number} */
let _lastCount = 0;
/** @type {typeof CHANGELOG} */
let _lastItems = [];

/** Call this after lang changes to refresh static text in the modal */
export function updateWhatsNewLangUI() {
  const titleEl  = document.getElementById('wn-title');
  const descEl   = document.getElementById('wn-desc');
  const gotItBtn = document.getElementById('wn-got-it-btn');
  const viewAllLink = document.getElementById('wn-changelog-link');
  if (titleEl)  titleEl.textContent  = /** @type {string} */ (t('whats_new_title'));
  if (descEl)   descEl.textContent   = /** @type {string} */ (t('whats_new_desc', _lastCount));
  if (gotItBtn) gotItBtn.textContent = /** @type {string} */ (t('whats_new_got_it'));
  if (viewAllLink) viewAllLink.textContent = /** @type {string} */ (t('whats_new_view_all'));
  _renderItems();
}

/** @param {typeof CHANGELOG} items @param {number} totalCount */
function _populateModal(items, totalCount) {
  _lastItems = items;
  _lastCount = totalCount;
  updateWhatsNewLangUI();
}

function _renderItems() {
  const listEl = document.getElementById('wn-list');
  if (!listEl) return;

  listEl.innerHTML = _lastItems.map(rawItem => {
    const item = localizeChangelogItem(rawItem, lang);
    return `
    <div class="wn-feat">
      <div class="wn-dot"></div>
      <div>
        <span class="wn-badge">${item.badge}</span>
        <div class="wn-title">${item.title}</div>
        <div class="wn-desc">${item.description}</div>
      </div>
    </div>
  `;
  }).join('');
}
