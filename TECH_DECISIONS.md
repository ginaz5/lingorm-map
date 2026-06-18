# Lingorm Map — 技術選型紀錄

> 記錄本專案的架構決策與選型理由，方便日後維護或交接。

---

## 地圖：Google Maps + HERE Maps 雙 provider

**主要：** Google Maps JS API（`AdvancedMarkerElement` + `colorScheme`）
**備援：** HERE Maps（Google Maps 無法載入時自動切換）

**切換邏輯：**
```
loadMapScript()
  → fetch /api/config (Google Maps key)
    → 成功 → 載入 Google Maps
    → 失敗 / 載入 timeout → 載入 HERE Maps
```

`state.provider` 記錄目前使用哪個 provider（`'google' | 'here' | null`），所有 marker / popup / 主題切換邏輯都以此判斷。

**Google Maps 選用理由：**

| 考量 | Google Maps JS API | Leaflet + CartoDB |
|------|-------------------|-------------------|
| 視覺品質 | Google 原生，與使用者習慣一致 | 開源 tiles，視覺差異明顯 |
| 深色主題 | `colorScheme: DARK/LIGHT` 原生支援 | CartoDB `dark_all` tiles |
| API Key | 必須，需綁信用卡 | 不需要 |
| 費用 | $200/月免費額度（~28,500 次/月） | 完全免費 |

**Key 安全策略：**

Google Maps JS API key 透過 Netlify Function `/api/config` 在 runtime 傳遞，不 hardcode 於 HTML。三層保護：

1. **HTTP Referrer 白名單**（Cloud Console → Credentials）：限制 key 僅接受 `https://lingorm-map.netlify.app/*` ✅
2. **API Quota 硬停**（Maps JS API → Quotas）：`Map loads per day` = 900 ✅
3. **Budget Alert**（Billing → Budgets & alerts）：$5 觸發 email 通知 ✅

---

## 地圖 Marker：Emoji 圓形 badge

**架構：** `AdvancedMarkerElement` + 自訂 HTML content（28px 圓形 div）

```js
export function makeMarkerContent(status, icon) {
  const el = document.createElement('div');
  el.className = `marker-dot ${getBadgeClass(status).replace('b-', 'marker-')}`;
  el.textContent = icon || '📍';
  return el;
}
```

**顏色對應 status：**

| Status | CSS class | 顏色 |
|--------|-----------|------|
| Verified | `.marker-verified` | `#2f7d4f` 綠 |
| Needs Review | `.marker-review` | `#c2772a` 橘 |
| Could Not Find | `.marker-notfound` | `#b1452f` 紅（不顯示於公開清單） |

Emoji 取自 `row.icon`（由 `csv-parser.js` 依 category 自動填入），找不到時 fallback 為 📍。

---

## 部署：Netlify

**選用：** Netlify 免費方案，連接 GitHub repo 自動部署

**`netlify.toml` 設定：**

```toml
[build]
  command = "bash build.sh && npm run build"
  publish = "dist"

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

`[functions]` 必須明確設定，否則 Netlify 不部署 functions（`/api/*` 會回 404）。
`[[redirects]]` 是因為 Netlify Functions v2 path routing 在部署時不穩定，改用 redirect rule 確保 `/api/config` 和 `/api/locations` 正確路由。

---

## 資料來源：Google Sheets CSV + Netlify Function Proxy

**架構：**
```
Google Sheets（人工編輯）
    ↓  File → Share → Publish to web → CSV
CSV URL 存在 Netlify env var: GOOGLE_SHEET_CSV_URL
    ↓  Netlify Function fetch（server-side）
/api/locations
    ↓  frontend fetch('/api/locations') on page load
前端 CSV parser 解析 → markers + card list
```

**選用理由：**
- 前端不暴露真實 Spreadsheet URL
- 非技術用戶在熟悉的試算表界面更新資料
- 同平台（Netlify），無需另建伺服器

**限制：**
- 單向同步（Sheets → 網頁），網頁不寫回 Sheets
- 更新需手動重新整理網頁（非 WebSocket 即時推送）

---

## 共編提交：Netlify Forms

**架構：** 使用者填寫表單 → `fetch POST /` → Netlify Forms → Email 通知管理員 → 人工審核後更新 Google Sheets

**三個表單：**
- `suggest-edit` — 建議修改現有地點
- `add-location` — 新增地點
- `issue-report` — 回報地圖問題

**注意事項：**
- 需在 Netlify Dashboard → Forms 手動開啟 form detection，再重新 deploy
- AJAX 提交必須包含 `form-name` 欄位（已實作於 `submit.js`）
- `Content-Type: application/x-www-form-urlencoded` + `URLSearchParams` 編碼（已實作）
- 本地開發時 submit 為 mock（`console.info`），不實際送出

---

## 主題系統：CSS Custom Properties

**架構：** `[data-theme="dark" | "light"]` attribute on `<html>` + CSS variables

```css
:root { --bg: #f5f5f7; }
[data-theme="dark"] { --bg: #0f0f1a; }
```

**三段切換：** `auto`（跟隨系統）→ `light` → `dark`

Google Maps 主題同步：`map.setOptions({ colorScheme: 'DARK' | 'LIGHT' })`
HERE Maps 主題同步：重新載入 base layer（`vector.normal.mapnight` for dark）

**偏好持久化：** `localStorage.setItem('theme', ...)`

---

## 多語支援：i18n 系統

**架構：**
- 所有 UI 字串集中在 `src/i18n.js` 的 `T` 物件
- HTML 元素使用 `data-i18n`, `data-i18n-ph`, `data-i18n-html` 屬性
- `updateLangUI()` 單次 scan 更新全部元素
- 動態渲染內容（卡片、category filter）在語系切換時重新 render

**類別資料：** 單一 `CATEGORIES` 陣列驅動 category filter 下拉、新增地點下拉、marker emoji。

**未來擴充（泰文）：** 在 `T` 新增 `th: {...}` key，CATEGORIES 新增 `th` 欄位即可。

---

## 手機版架構

**Layout：**
```css
@media(max-width:700px) {
  .app-body { flex-direction: column }
  .panel { flex: 1; min-height: 0 }   /* 必須，否則 overflow-y:auto 失效 */
}
```

**Tab 導航邏輯：**
- 點地圖 marker → 停留在地圖 tab，開 info window
- 點清單卡片 → 切到地圖 tab，pan 到地點並開 info window

`min-height: 0` 是關鍵：flex item 預設 `min-height: auto`，不設為 0 則 `.loc-list` 父層不會有固定高度，`overflow-y: auto` 無法生效。

---

## 未來擴充考量

| 需求 | 建議方案 |
|------|----------|
| 每月 >100 筆建議 | 換 Formspree 或加 Supabase 後端 |
| 即時更新 | Server-Sent Events 或 Supabase Realtime |
| 流量超過 quota（>900次/日） | 調高 Cloud Console quota，或升級 Vercel（key 存環境變數） |
| 更多地點（>200 筆） | 考慮虛擬捲動（virtual scroll） |
| 泰文支援 | `i18n.js` 加 `th` key，lang toggle 加第三段 |
