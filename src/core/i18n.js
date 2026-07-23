// ═══════════════════════════════════════════════════
// CORE i18n
// ═══════════════════════════════════════════════════
/** @typedef {'zh'|'en'} Language */
/** @type {Language} */
export let lang = 'zh';

/** @param {string} l */
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'zh';
  localStorage.setItem('lang', lang);
}

export const T = {
  zh: {
    hdr_sub: '鄺玲玲曼谷踩點地圖',
    lang_btn: 'EN',
    theme_btn: '主題',
    search_ph: '搜尋地點或內文關鍵字…',
    all_cat: '類別',
    dest_filter: '目的地',
    dest_filter_count: (/** @type {number} */ n) => `目的地（${n}）`,
    all_destinations: '所有目的地',
    clear: '清除',
    count: (/** @type {number} */ n, /** @type {number} */ t) => `顯示 ${n} / ${t} 個地點`,
    updated: (/** @type {string} */ d) => `更新於 ${d}`,
    approx: '📍 座標為估算位置',
    empty: '沒有符合的地點',
    tab_map: '地圖', tab_list: '清單',
    favorite_storage_notice: '收藏僅儲存在此瀏覽器，不會跨裝置同步；清除瀏覽資料後可能遺失。',
    submit_err: '❌ 送出失敗，請稍後再試。',
    submitting: '送出中…',
    // Issue report modal
    issue_btn: '問題回報',
    issue_title: '問題回報',
    issue_desc: '回報資料錯誤、地圖問題或網站操作異常。',
    issue_lbl_message: '問題描述',
    issue_ph_message: '請描述你遇到的問題，或貼上相關地點名稱。',
    issue_lbl_contact: '你的名字 / 聯絡方式',
    issue_submit: '送出回報',
    issue_submit_ok: '✅ 已收到回報，感謝你提供資訊。',
    // Validation
    err_issue_required: '請填寫問題描述。',
    // Common
    opt: '（選填）', cancel: '取消',
    // What's New modal
    whats_new_title: '✨ 新功能更新',
    whats_new_desc: (/** @type {number} */ n) => `自上次造訪後，我們新增了 ${n} 項功能`,
    whats_new_got_it: '我知道了',
    ph_submitter: '例：@your_ig',
    // Navigation & location
    nav_btn: '導航',
    open_maps_btn: 'Maps',
    locate_btn: '📍',
    locate_btn_label: '定位',
    locate_snack: '✓ 已定位　點地標上的「導航到這裡」可開啟路線',
    locate_err: '無法取得位置，請稍後再試。',
    locate_deny: '請允許位置存取權限後重試。',
    sheet_loading: '載入中…',
  },
  en: {
    hdr_sub: 'Lingorm Bangkok Location Map',
    lang_btn: '中文',
    theme_btn: 'Theme',
    search_ph: 'Search names or notes…',
    all_cat: 'All Categories',
    dest_filter: 'Destinations',
    dest_filter_count: (/** @type {number} */ n) => `Destinations (${n})`,
    all_destinations: 'All destinations',
    clear: 'Clear',
    count: (/** @type {number} */ n, /** @type {number} */ t) => `${n} / ${t} locations`,
    updated: (/** @type {string} */ d) => `Updated ${d}`,
    approx: '📍 Coordinates are approximate',
    empty: 'No matching locations',
    tab_map: 'Map', tab_list: 'List',
    favorite_storage_notice: 'Favorites stay in this browser only. They aren’t synced across devices and may be lost if browsing data is cleared.',
    submit_err: '❌ Submission failed, please try again.',
    submitting: 'Submitting…',
    // Issue report modal
    issue_btn: 'Report Issue',
    issue_title: 'Report an issue',
    issue_desc: 'Report incorrect data, map problems, or site issues.',
    issue_lbl_message: 'Issue details',
    issue_ph_message: 'Describe what happened, or include the related location name.',
    issue_lbl_contact: 'Your name / contact',
    issue_submit: 'Send report',
    issue_submit_ok: '✅ Report received. Thank you for letting us know.',
    // Validation
    err_issue_required: 'Please describe the issue.',
    // Common
    opt: '(optional)', cancel: 'Cancel',
    // What's New modal
    whats_new_title: "✨ What's new",
    whats_new_desc: (/** @type {number} */ n) => `${n} new feature${n === 1 ? '' : 's'} since your last visit`,
    whats_new_got_it: 'Got it',
    ph_submitter: 'e.g. @your_ig',
    // Navigation & location
    nav_btn: 'Navigate',
    open_maps_btn: 'Maps',
    locate_btn: '📍',
    locate_btn_label: 'Locate me',
    locate_snack: '✓ Located　Tap a marker → "Navigate here" to open directions',
    locate_err: 'Could not get your location. Please try again.',
    locate_deny: 'Please allow location access and retry.',
    sheet_loading: 'Loading…',
  }
  // Add 'th': {...} here for Thai support in the future
};

/**
 * @param {string} k
 * @param {...(string|number)} a
 * @returns {string}
 */
export function t(k, ...a) {
  const table = /** @type {Record<string, string|((...args: Array<string|number>) => string)>} */ (T[lang]);
  const v = table[k];
  return typeof v === 'function' ? v(...a) : (v ?? k);
}
