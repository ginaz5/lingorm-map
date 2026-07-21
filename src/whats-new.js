import { t } from './i18n.js';

/** @typedef {{ id: string, title: string, description: string, badge: string, publishTime: number }} ChangelogItem */

// ═══════════════════════════════════════════════════
// CHANGELOG — add new entries at the TOP (newest first)
// publishTime: Unix timestamp in ms (Date.now() at time of release)
// ═══════════════════════════════════════════════════
/** @type {ChangelogItem[]} */
const CHANGELOG = [
  {
    id: 'feat-005',
    title: '地圖標記自動聚合',
    description: '景點過多時，鄰近標記會自動合併為群組數字，縮放地圖即可展開查看個別地點',
    badge: '功能',
    publishTime: 1753027200000, // 2026-07-21
  },
  {
    id: 'feat-004',
    title: '全新瀏覽體驗，介面更清爽',
    description: '地圖頁面大幅簡化，移除多餘操作欄位，讓瀏覽曼谷景點更直覺流暢。彈窗樣式與收藏圖示也同步升級。',
    badge: '設計',
    publishTime: 1752940800000, // 2026-07-20
  },
  {
    id: 'fix-001',
    title: '點擊標記不再跳回預設縮放',
    description: '修正點擊地圖標記後縮放層級被重設的問題，現在點擊標記會保留目前縮放比例。',
    badge: '修復',
    publishTime: 1752940800000, // 2026-07-20
  },
  {
    id: 'feat-002',
    title: '點選愛心為收藏景點 ❤️',
    description: '點擊愛心即可收藏地點，收藏清單會自動存在裝置上，也可透過網址分享。',
    badge: '功能',
    publishTime: 1782000000000, // 2026-06-21
  },
  {
    id: 'feat-001',
    title: '地點彈窗新增「在 Google Maps 開啟」',
    description: '點擊地圖標記後，彈窗內新增按鈕可直接在 Google Maps 查看該地點。',
    badge: '功能',
    publishTime: 1781827200000, // 2026-06-19
  }
];

const LS_KEY = 'last_visit_time';
const SS_KEY = 'whats_new_shown';

// ═══════════════════════════════════════════════════
// CLOSE
// ═══════════════════════════════════════════════════
export function closeWhatsNew() {
  localStorage.setItem(LS_KEY, String(Date.now()));
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
    return;
  }

  // Already shown this session (multi-tab guard)
  if (sessionStorage.getItem(SS_KEY)) return;

  const since = Number(lastVisit);
  const newItems = CHANGELOG
    .filter(item => item.publishTime > since)
    .sort((a, b) => b.publishTime - a.publishTime);

  if (newItems.length === 0) return;

  _populateModal(newItems);

  setTimeout(() => {
    document.getElementById('whats-new-modal')?.classList.add('open');
  }, 500);
}

// ═══════════════════════════════════════════════════
// DOM — populate feature list + static text
// ═══════════════════════════════════════════════════

/** @type {number} */
let _lastCount = 0;

/** Call this after lang changes to refresh static text in the modal */
export function updateWhatsNewLangUI() {
  const titleEl  = document.getElementById('wn-title');
  const descEl   = document.getElementById('wn-desc');
  const gotItBtn = document.getElementById('wn-got-it-btn');
  if (titleEl)  titleEl.textContent  = /** @type {string} */ (t('whats_new_title'));
  if (descEl)   descEl.textContent   = /** @type {string} */ (t('whats_new_desc', _lastCount));
  if (gotItBtn) gotItBtn.textContent = /** @type {string} */ (t('whats_new_got_it'));
}

/** @param {ChangelogItem[]} items */
function _populateModal(items) {
  const listEl = document.getElementById('wn-list');
  if (!listEl) return;

  _lastCount = items.length;
  updateWhatsNewLangUI();

  listEl.innerHTML = items.map(item => `
    <div class="wn-feat">
      <div class="wn-dot"></div>
      <div>
        <span class="wn-badge">${item.badge}</span>
        <div class="wn-title">${item.title}</div>
        <div class="wn-desc">${item.description}</div>
      </div>
    </div>
  `).join('');
}
