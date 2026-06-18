// ═══════════════════════════════════════════════════
// CATEGORIES — single source of truth for dropdowns + filter
// ═══════════════════════════════════════════════════
export const CATEGORIES = [
  {zh:'餐廳',       en:'Restaurant',         icon:'🍽'},
  {zh:'咖啡廳',     en:'Cafe',               icon:'☕'},
  {zh:'飲料',       en:'Beverages',          icon:'🥤'},
  {zh:'飯店',       en:'Hotel',              icon:'🏨'},
  {zh:'酒吧/天台俱樂部', en:'Bar / Rooftop Club', icon:'🍸'},
  {zh:'街頭小吃',   en:'Street Food',        icon:'🍢'},
  {zh:'Spa',        en:'Spa',                icon:'♨️'},
  {zh:'購物',       en:'Shopping',           icon:'🛍'},
  {zh:'活動',       en:'Activity',           icon:'🎯'},
  {zh:'拍攝場地',   en:'Filming Location',   icon:'🎬'},
  {zh:'街區',       en:'Neighbourhood',      icon:'🏘️'},
  {zh:'自然 / 一日遊', en:'Nature / Day-trip', icon:'🌿'},
  {zh:'其他',       en:'Other',              icon:'🔖'},
];

// ═══════════════════════════════════════════════════
// i18n
// ═══════════════════════════════════════════════════
export let lang = 'zh';

export function setLang(l) {
  lang = l;
  localStorage.setItem('lang', l);
}

export const T = {
  zh: {
    hdr_sub: '鄺玲玲曼谷踩點地圖',
    lang_btn: '🌐 EN',
    theme_btn: '主題',
    add_loc: '新增地點',
    search_ph: '搜尋地點…',
    all_cat: '全部類別',
    all_status: '全部狀態',
    status: {Verified:'✅ 已驗證','Needs Review':'⚠️ 待確認','Could Not Find':'❌ 找不到'},
    badge:  {Verified:'已驗證',   'Needs Review':'待確認',   'Could Not Find':'找不到'},
    count: (n,t) => `顯示 ${n} / ${t} 個地點`,
    approx: '📍 座標為估算位置',
    edit_btn_verify: '幫助驗證',
    edit_btn_edit: '建議修改',
    empty: '沒有符合的地點',
    leg_verified: '已驗證', leg_review: '待確認', leg_notfound: '找不到',
    tab_map: '地圖', tab_list: '清單',
    pending_notice: '你有待審核的建議，感謝你的貢獻！',
    submit_ok: '✅ 已送出！感謝你的貢獻，管理員審核後會更新地圖。',
    submit_err: '❌ 送出失敗，請稍後再試。',
    submitting: '送出中…',
    // Edit modal
    edit_title: '✏️ 建議修改',
    edit_desc: '你的建議會送交審核，經確認後才會更新到地圖。感謝貢獻！',
    edit_lbl_location: '地點',
    edit_lbl_status: '建議狀態',
    edit_lbl_maps: 'Google Maps 搜尋字串',
    edit_hint_maps: '如果你找到正確的 Google Maps 頁面，可貼上店名關鍵字或完整網址',
    edit_ph_maps: '例：Ministry of Crab Bangkok',
    edit_lbl_lat: '緯度 Lat', edit_lbl_lng: '經度 Lng',
    edit_hint_coords: '在 Google Maps 點選地點後，網址列可複製座標',
    edit_lbl_notes_zh: '補充說明（中文）', edit_lbl_notes_en: '補充說明（英文）',
    edit_ph_notes_zh: '例：確認仍在營業，建議提前預訂',
    edit_ph_notes_en: 'e.g. Confirmed open, reservations recommended',
    edit_lbl_reason: '修改原因',
    edit_ph_reason: '例：親身拜訪，餐廳已搬遷…',
    edit_lbl_submitter: '你的名字 / 聯絡方式',
    edit_lbl_submitter_opt: '（選填，方便回覆）',
    edit_submit: '送出建議',
    // Add modal
    add_title: '➕ 新增地點',
    add_desc: '填寫你知道的Lingorm打卡地點，送出後由管理員審核後才加入地圖。',
    add_lbl_name: '地點名稱',
    add_ph_name: '例：暹羅精品酒店',
    add_lbl_cat: '類別',
    add_lbl_maps: 'Google Maps 連結',
    add_ph_maps: '例：https://maps.app.goo.gl/...',
    add_hint_maps: '在 Google Maps 找到地點後，點選「分享」複製連結',
    add_lbl_notes: '簡短說明',
    add_ph_notes: '例：玲玲在 IG 直播中推薦的餐廳，招牌是...',
    add_lbl_status: '狀態',
    add_lbl_source: '來源連結',
    add_lbl_source_opt: '（選填，例如 IG 貼文、YT 影片網址）',
    add_lbl_submitter: '你的名字 / 聯絡方式',
    add_submit: '送出',
    add_success_title: '感謝您的地點貢獻',
    add_success_desc: '我們已收到您的建議，管理員審核後會加入地圖。',
    // Issue report modal
    issue_btn: '問題回報',
    issue_title: '問題回報',
    issue_desc: '回報資料錯誤、地圖問題或網站操作異常。',
    issue_lbl_message: '問題描述',
    issue_ph_message: '請描述你遇到的問題，或貼上相關地點名稱。',
    issue_lbl_contact: '你的名字 / 聯絡方式',
    issue_submit: '送出回報',
    // Validation
    err_name_required: '請填寫地點名稱。',
    err_maps_required: '請填寫 Google Maps 連結。',
    err_maps_invalid: '請貼上有效的 Google Maps 分享連結（例：https://maps.app.goo.gl/...）。',
    err_issue_required: '請填寫問題描述。',
    // Common
    opt: '（選填）', cancel: '取消', done: '完成',
    st_verified: '✅ 已驗證', st_review: '⚠️ 待確認', st_notfound: '❌ 找不到',
    ph_submitter: '例：@your_ig',
    // Admin auth
    admin_title: '🔐 管理員登入',
    admin_desc: '輸入管理員密碼以進入設定頁面。',
    admin_lbl: '密碼', admin_ph: '請輸入密碼',
    admin_btn: '登入', admin_err: '密碼錯誤',
    admin_not_configured: '尚未設定管理員密碼。請設定 ADMIN_PASSWORD 環境變數後重新部署。',
    // Navigation & location
    nav_btn: '🧭 導航到這裡',
    locate_btn: '📍',
    locate_btn_label: '定位',
    locate_snack: '✓ 已定位　點地標上的「導航到這裡」可開啟路線',
    locate_err: '無法取得位置，請稍後再試。',
    locate_deny: '請允許位置存取權限後重試。',
    // Sheet modal
    sheet_title: '⚙️ Google Sheets API 狀態',
    sheet_desc: '資料由 Netlify Function 代抓 Google Sheets CSV；實際試算表網址只存在 Netlify 環境變數，不會暴露在前端。',
    sheet_howto: '<strong>設定方式：</strong><br>1. Google Sheets → 檔案 → 分享 → 發佈至網路<br>2. 選擇「Locations 工作表」+「逗號分隔值 (.csv)」<br>3. 將 CSV URL 存到 Netlify 環境變數 <code>GOOGLE_SHEET_CSV_URL</code> 並重新部署',
    sheet_netlify: '<strong>設定 Netlify 表單通知（接收共編建議）：</strong><br>1. Netlify Dashboard → Forms → 找到 <code>suggest-edit</code>、<code>add-location</code> 和 <code>issue-report</code><br>2. Settings → Form notifications → 加入你的 Email',
    sheet_ok: n => `✅ 已載入 ${n} 筆資料`,
    sheet_err: e => `❌ 載入失敗：${e}`,
    sheet_loading: '載入中…',
    sheet_save: '重新載入',
  },
  en: {
    hdr_sub: 'Lingorm Bangkok Location Map',
    lang_btn: '🌐 中文',
    theme_btn: 'Theme',
    add_loc: 'Add Location',
    search_ph: 'Search locations…',
    all_cat: 'All Categories',
    all_status: 'All Statuses',
    status: {Verified:'✅ Verified','Needs Review':'⚠️ Needs Review','Could Not Find':'❌ Not Found'},
    badge:  {Verified:'Verified', 'Needs Review':'Needs Review','Could Not Find':'Not Found'},
    count: (n,t) => `${n} / ${t} locations`,
    approx: '📍 Coordinates are approximate',
    edit_btn_verify: 'Help verify',
    edit_btn_edit: 'Suggest edit',
    empty: 'No matching locations',
    leg_verified: 'Verified', leg_review: 'Needs Review', leg_notfound: 'Not Found',
    tab_map: 'Map', tab_list: 'List',
    pending_notice: 'Your suggestion is pending review. Thank you!',
    submit_ok: '✅ Submitted! The admin will review and update the map.',
    submit_err: '❌ Submission failed, please try again.',
    submitting: 'Submitting…',
    // Edit modal
    edit_title: '✏️ Suggest Edit',
    edit_desc: 'Your suggestion will be reviewed before being applied to the map. Thank you!',
    edit_lbl_location: 'Location',
    edit_lbl_status: 'Suggested status',
    edit_lbl_maps: 'Google Maps search query',
    edit_hint_maps: 'If you found the correct Google Maps listing, paste the name or URL',
    edit_ph_maps: 'e.g. Ministry of Crab Bangkok',
    edit_lbl_lat: 'Latitude', edit_lbl_lng: 'Longitude',
    edit_hint_coords: 'Open the location in Google Maps and copy the coordinates from the URL',
    edit_lbl_notes_zh: 'Notes (Chinese)', edit_lbl_notes_en: 'Notes (English)',
    edit_ph_notes_zh: 'e.g. 確認仍在營業，建議提前預訂',
    edit_ph_notes_en: 'e.g. Confirmed open, reservations recommended',
    edit_lbl_reason: 'Reason for edit',
    edit_ph_reason: 'e.g. Visited in person, restaurant has relocated…',
    edit_lbl_submitter: 'Your name / contact',
    edit_lbl_submitter_opt: '(optional, for follow-up)',
    edit_submit: 'Submit suggestion',
    // Add modal
    add_title: '➕ Add Location',
    add_desc: "Submit a Lingorm-spotted location. An admin will review it before adding to the map.",
    add_lbl_name: 'Location name',
    add_ph_name: 'e.g. The Siam Hotel',
    add_lbl_cat: 'Category',
    add_lbl_maps: 'Google Maps link',
    add_ph_maps: 'e.g. https://maps.app.goo.gl/...',
    add_hint_maps: 'Find the location on Google Maps, tap "Share" to copy the link',
    add_lbl_notes: 'Notes',
    add_ph_notes: "e.g. Spotted in Lingorm's IG livestream...",
    add_lbl_status: 'Status',
    add_lbl_source: 'Source link',
    add_lbl_source_opt: '(optional, e.g. IG post, YouTube URL)',
    add_lbl_submitter: 'Your name / contact',
    add_submit: 'Submit',
    add_success_title: 'Thanks for contributing a location',
    add_success_desc: "We've received your suggestion. An admin will review it before adding it to the map.",
    // Issue report modal
    issue_btn: 'Report Issue',
    issue_title: 'Report an issue',
    issue_desc: 'Report incorrect data, map problems, or site issues.',
    issue_lbl_message: 'Issue details',
    issue_ph_message: 'Describe what happened, or include the related location name.',
    issue_lbl_contact: 'Your name / contact',
    issue_submit: 'Send report',
    // Validation
    err_name_required: 'Please enter the location name.',
    err_maps_required: 'Please enter a Google Maps link.',
    err_maps_invalid: 'Please paste a valid Google Maps share link (e.g. https://maps.app.goo.gl/...).',
    err_issue_required: 'Please describe the issue.',
    // Common
    opt: '(optional)', cancel: 'Cancel', done: 'Done',
    st_verified: '✅ Verified', st_review: '⚠️ Needs Review', st_notfound: '❌ Not Found',
    ph_submitter: 'e.g. @your_ig',
    // Admin auth
    admin_title: '🔐 Admin Login',
    admin_desc: 'Enter the admin password to access settings.',
    admin_lbl: 'Password', admin_ph: 'Enter password',
    admin_btn: 'Login', admin_err: 'Incorrect password',
    admin_not_configured: 'Admin password not configured. Set ADMIN_PASSWORD env var and redeploy.',
    // Navigation & location
    nav_btn: '🧭 Navigate here',
    locate_btn: '📍',
    locate_btn_label: 'Locate me',
    locate_snack: '✓ Located　Tap a marker → "Navigate here" to open directions',
    locate_err: 'Could not get your location. Please try again.',
    locate_deny: 'Please allow location access and retry.',
    // Sheet modal
    sheet_title: '⚙️ Google Sheets API Status',
    sheet_desc: 'A Netlify Function fetches the Google Sheets CSV. The real spreadsheet URL only lives in Netlify environment variables and is not exposed to the frontend.',
    sheet_howto: '<strong>Setup:</strong><br>1. Google Sheets → File → Share → Publish to web<br>2. Select "Locations sheet" + "Comma-separated values (.csv)"<br>3. Store the CSV URL in Netlify env var <code>GOOGLE_SHEET_CSV_URL</code> and redeploy',
    sheet_netlify: '<strong>Set up Netlify form notifications:</strong><br>1. Netlify Dashboard → Forms → find <code>suggest-edit</code>, <code>add-location</code>, and <code>issue-report</code><br>2. Settings → Form notifications → add your Email',
    sheet_ok: n => `✅ Loaded ${n} entries`,
    sheet_err: e => `❌ Load failed: ${e}`,
    sheet_loading: 'Loading…',
    sheet_save: 'Reload',
  }
  // Add 'th': {...} here for Thai support in the future
};

export function t(k, ...a) {
  const v = T[lang][k];
  return typeof v === 'function' ? v(...a) : (v ?? k);
}

export function tobj(k, s) {
  return (T[lang][k] || {})[s] || s;
}
