/** @typedef {'zh'|'en'} ChangelogLanguage */
/** @typedef {{ zh: string, en: string }} LocalizedText */
/**
 * @typedef {{
 *   id: string,
 *   title: LocalizedText,
 *   description: LocalizedText,
 *   badge: LocalizedText,
 *   publishTime: number,
 *   releaseId?: string
 * }} ChangelogItem
 */

export const CURRENT_CHANGELOG_RELEASE_ID = '2026-08-09-analytics-collections';

/**
 * Shared release history for the What's New preview and the full changelog.
 * Add new entries at the top, assign them to the current release, and use an
 * explicit GMT+8 date for changelog display and ordering.
 * @type {ChangelogItem[]}
 */
export const CHANGELOG = [
  {
    id: 'feat-013',
    title: {
      zh: '主題分類更清楚',
      en: 'Collections are easier to understand',
    },
    description: {
      zh: '類別與主題選項現在會顯示地點數量，搜尋與篩選也有一致的 hover 回饋。主題分類說明在桌機移開游標後會自動收合，手機版則會保持開啟，直到使用者自行關閉。',
      en: 'Category and collection options now show location counts with consistent hover feedback across search and filters. The collection guide closes when the pointer leaves on desktop, while staying open on touch devices until you dismiss it.',
    },
    badge: { zh: '功能', en: 'Feature' },
    publishTime: Date.parse('2026-08-09T00:00:00+08:00'),
    releaseId: CURRENT_CHANGELOG_RELEASE_ID,
  },
  {
    id: 'feat-012',
    title: {
      zh: '地圖收錄更多踩點',
      en: 'More locations added to the map',
    },
    description: {
      zh: '新增一批 LingOrm 相關地點與粉絲分享的收藏，並補充既有地點的資訊、座標與分類。',
      en: 'A new batch of LingOrm locations and fan-shared picks has arrived, along with refreshed details, coordinates, and collections.',
    },
    badge: { zh: '內容', en: 'Content' },
    publishTime: Date.parse('2026-08-09T00:00:00+08:00'),
    releaseId: CURRENT_CHANGELOG_RELEASE_ID,
  },
  {
    id: 'feat-010',
    title: {
      zh: '篩選新增「主題」與「目的地」',
      en: 'Filter by theme and destination',
    },
    description: {
      zh: '除了類別，現在也能依主題或目的地縮小範圍。地圖標記與清單會一起更新，選過的目的地也會保留。',
      en: 'Narrow the map by category, theme, or destination. Markers and the location list stay in sync, and destination choices are remembered.',
    },
    badge: { zh: '功能', en: 'Feature' },
    publishTime: Date.parse('2026-07-30T00:00:00+08:00'),
    releaseId: '2026-07-30-pr-2',
  },
  {
    id: 'feat-009',
    title: {
      zh: '手機清單新增地點快捷操作',
      en: 'Quick actions on mobile location cards',
    },
    description: {
      zh: '在手機清單可直接收藏、開啟導航或前往 Google Maps；定位按鈕也移到頁首，隨時都能使用。',
      en: 'Mobile location cards now offer favorite, directions, and Google Maps shortcuts. Locate Me also stays within reach in the header.',
    },
    badge: { zh: '功能', en: 'Feature' },
    publishTime: Date.parse('2026-07-30T00:00:00+08:00'),
    releaseId: '2026-07-30-pr-2',
  },
  {
    id: 'fix-003',
    title: {
      zh: '手機版地圖彈窗不再被截斷',
      en: 'Map popups stay fully visible on mobile',
    },
    description: {
      zh: '修正從清單切到地圖時彈窗偏移、內容被切掉的問題，地點數量與更新日期也改為同列顯示。',
      en: 'Fixed popups shifting off-screen after opening a place from the list. Location counts and update dates now share one line as well.',
    },
    badge: { zh: '修復', en: 'Fix' },
    publishTime: Date.parse('2026-07-30T00:00:00+08:00'),
    releaseId: '2026-07-30-pr-2',
  },
  {
    id: 'feat-008',
    title: {
      zh: '新增完整更新紀錄',
      en: 'A new home for every update',
    },
    description: {
      zh: '新增獨立的更新紀錄頁，可從頁首或新功能視窗查看所有版本內容。',
      en: 'The new changelog page keeps every release in one place, with links from the header and What’s New.',
    },
    badge: { zh: '功能', en: 'Feature' },
    publishTime: Date.parse('2026-07-30T00:00:00+08:00'),
    releaseId: '2026-07-30-pr-2',
  },
  {
    id: 'feat-007',
    title: {
      zh: '搜尋現在也會比對地點筆記',
      en: 'Search now includes location notes',
    },
    description: {
      zh: '除了店名，也能用中英文筆記裡的關鍵字找地點；清單、標記與聚合結果會保持一致。',
      en: 'Search by keywords in Chinese or English location notes, not just place names. Lists, markers, and clusters all show the same results.',
    },
    badge: { zh: '功能', en: 'Feature' },
    publishTime: Date.parse('2026-07-30T00:00:00+08:00'),
    releaseId: '2026-07-30-pr-2',
  },
  {
    id: 'fix-002',
    title: {
      zh: '地圖文字跟著瀏覽器語言',
      en: 'Map labels follow your browser language',
    },
    description: {
      zh: 'Google Maps 與 HERE Maps 會依瀏覽器語言顯示合適的標籤；遇到不支援的語系時，也能正常切換到可用語言。',
      en: 'Google Maps and HERE Maps now use labels that match your browser language, with a safe fallback when a locale is unavailable.',
    },
    badge: { zh: '修復', en: 'Fix' },
    publishTime: Date.parse('2026-07-30T00:00:00+08:00'),
    releaseId: '2026-07-30-pr-2',
  },
  {
    id: 'feat-006',
    title: {
      zh: '清單顯示資料更新日期',
      en: 'See when location data was updated',
    },
    description: {
      zh: '地點數量旁會顯示資料最後更新日期，查看地圖時更容易確認內容是否為最新版本。',
      en: 'The location count now shows when the map data was last updated, so you can quickly check how current it is.',
    },
    badge: { zh: '功能', en: 'Feature' },
    publishTime: Date.parse('2026-07-30T00:00:00+08:00'),
    releaseId: '2026-07-30-pr-2',
  },
  {
    id: 'feat-005',
    title: {
      zh: '地圖標記自動聚合',
      en: 'Automatic marker clustering',
    },
    description: {
      zh: '景點過多時，鄰近標記會自動合併為群組數字，縮放地圖即可展開查看個別地點',
      en: 'Nearby markers now combine into numbered clusters when the map is crowded. Zoom in to reveal individual locations.',
    },
    badge: { zh: '功能', en: 'Feature' },
    publishTime: Date.parse('2026-07-21T00:00:00+08:00'),
  },
  {
    id: 'feat-004',
    title: {
      zh: '全新瀏覽體驗，介面更清爽',
      en: 'A cleaner browsing experience',
    },
    description: {
      zh: '地圖頁面大幅簡化，移除多餘操作欄位，讓瀏覽曼谷景點更直覺流暢。彈窗樣式與收藏圖示也同步升級。',
      en: 'The map interface is now simpler and easier to browse, with refreshed popups and favorite icons.',
    },
    badge: { zh: '設計', en: 'Design' },
    publishTime: Date.parse('2026-07-20T00:00:00+08:00'),
  },
  {
    id: 'fix-001',
    title: {
      zh: '點擊標記不再跳回預設縮放',
      en: 'Marker clicks keep your zoom level',
    },
    description: {
      zh: '修正點擊地圖標記後縮放層級被重設的問題，現在點擊標記會保留目前縮放比例。',
      en: 'Opening a map marker now keeps your current zoom level instead of resetting the map.',
    },
    badge: { zh: '修復', en: 'Fix' },
    publishTime: Date.parse('2026-07-20T00:00:00+08:00'),
  },
  {
    id: 'feat-002',
    title: {
      zh: '點選愛心為收藏景點 ❤️',
      en: 'Tap the heart to save favorites ❤️',
    },
    description: {
      zh: '點擊愛心即可收藏地點，收藏清單會自動存在裝置上，也可透過網址分享。',
      en: 'Tap the heart to save a location on your device, then share your favorites with a link.',
    },
    badge: { zh: '功能', en: 'Feature' },
    publishTime: Date.parse('2026-06-21T00:00:00+08:00'),
  },
  {
    id: 'feat-001',
    title: {
      zh: '地點彈窗新增「在 Google Maps 開啟」',
      en: 'Open locations in Google Maps',
    },
    description: {
      zh: '點擊地圖標記後，彈窗內新增按鈕可直接在 Google Maps 查看該地點。',
      en: 'Location popups now include a button that opens the place directly in Google Maps.',
    },
    badge: { zh: '功能', en: 'Feature' },
    publishTime: Date.parse('2026-06-19T00:00:00+08:00'),
  },
];

/**
 * @param {ChangelogItem} item
 * @param {ChangelogLanguage} language
 */
export function localizeChangelogItem(item, language) {
  return {
    ...item,
    title: item.title[language],
    description: item.description[language],
    badge: item.badge[language],
  };
}

/**
 * @param {number} publishTime
 * @param {ChangelogLanguage} language
 */
export function formatChangelogDate(publishTime, language) {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-TW' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Taipei',
  }).format(new Date(publishTime));
}
