/** @typedef {'zh'|'en'} ChangelogLanguage */
/** @typedef {{ zh: string, en: string }} LocalizedText */
/**
 * @typedef {{
 *   id: string,
 *   title: LocalizedText,
 *   description: LocalizedText,
 *   badge: LocalizedText,
 *   publishTime: number
 * }} ChangelogItem
 */

/**
 * Shared release history for the What's New preview and the full changelog.
 * Add new entries at the top and use an explicit GMT+8 release timestamp.
 * @type {ChangelogItem[]}
 */
export const CHANGELOG = [
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
