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

兩個 provider 的 key 都透過 Netlify Function `/api/config` 在 runtime 傳遞，不 hardcode 於 HTML。

Google Maps 三層保護：
1. **HTTP Referrer 白名單**（Cloud Console → Credentials）：限制 key 僅接受 `https://lingorm-map.netlify.app/*` ✅
2. **API Quota 硬停**（Maps JS API → Quotas）：`Map loads per day` = 900 ✅
3. **Budget Alert**（Billing → Budgets & alerts）：$5 觸發 email 通知 ✅

HERE Maps：免費方案 250,000 map transactions/月，無需信用卡，在 [developer.here.com](https://developer.here.com) 建立 project → REST API key。

**Netlify env vars：**

| Variable | Required | 說明 |
|----------|----------|------|
| `HERE_API_KEY` | ✅ | HERE Maps JS API key（fallback，必須） |
| `GOOGLE_MAPS_KEY` | optional | Google Maps JS API key（primary） |
| `GOOGLE_MAP_ID` | optional | Map ID（dark mode + AdvancedMarkerElement） |
| `DATA_SOURCE` | optional | `notion`（唯一支援值，也是預設值）；切換後需重新部署 |

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

Emoji 取自 `row.icon`（由 `src/data/csv-parser.js` 依 category 自動填入），找不到時 fallback 為 📍。

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

## 資料來源：Notion 快照（`DATA_SOURCE=notion` 為唯一支援路徑）

**架構：**
```
Notion（system of record，單一 Locations database）
    ↓  exporter / 驗證
data/locations.csv（隨版本提交）
    ↓  DATA_SOURCE=notion
/api/locations
    ↓  frontend fetch('/api/locations') on page load
前端 CSV parser 解析 → markers + card list
```

**選用理由：**
- Notion 作為可協作的主要資料來源，但 production request 不直接依賴 Notion API
- 已驗證的 CSV 快照會隨程式版本保存，部署與回滾都可重現（回滾＝ git revert `data/locations.csv`，見 `docs/notion-deploy-workflow.md`）
- 前端不會暴露 Notion 憑證

**限制：**
- Notion 資料更新後，必須重新匯出、驗證、提交快照並部署，網站才會更新
- 目前仍是單向同步，網頁不直接寫回 Notion

**已停用：** 舊版 `DATA_SOURCE=sheet`（Google Sheets 回滾路徑）已於 2026-07-21
三狀態 cutover 後停用——legacy 的 `verified`/`needs review` 狀態一律
normalize 為 `Paused`（非公開），該路徑會顯示 0 筆地點。`build.sh` 現在會
直接拒絕 `DATA_SOURCE=sheet`。

---

## 共編提交：Netlify Forms

**架構：** 使用者填寫表單 → `fetch POST /` → Netlify Forms → Email 通知管理員 → 人工審核後更新 Notion；下一次快照匯出與部署後反映到網站

**三個表單：**
- `suggest-edit` — 建議修改現有地點
- `add-location` — 新增地點
- `issue-report` — 回報地圖問題

**注意事項：**
- 需在 Netlify Dashboard → Forms 手動開啟 form detection，再重新 deploy
- AJAX 提交必須包含 `form-name` 欄位（已實作於 `src/services/submit.js`）
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
- 所有 UI 字串集中在 `src/core/i18n.js` 的 `T` 物件
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
| 泰文支援 | `src/core/i18n.js` 加 `th` key，lang toggle 加第三段 |

---

## JavaScript 靜態型別檢查：TypeScript checkJs + JSDoc

**決策：** 保留現有 `.js` ES modules 與 Vite runtime/build 流程；TypeScript 只作為開發期靜態檢查器，以 strict、no-emit `checkJs` 搭配 JSDoc 描述應用程式資料契約，不進行整體 `.ts` 遷移。

**目前範圍：**
- 主要檢查 `src/app/app-coordinator.js`、`src/core/state.js`、`src/data/csv-parser.js`、`src/map/map.js`、`src/features/forms.js`
- TypeScript 會沿著上述檔案的 ES module imports 檢查相依邊界；必要時只補窄範圍 JSDoc 或 DOM null safety，不重新設計被匯入模組
- 後續模組依維護需求逐步納入，不要求一次覆蓋全部程式碼

**選用理由：**
- 不改變瀏覽器實際執行的 JavaScript，也不讓 TypeScript 取代 Vite emit production assets
- 先在 CSV 資料、shared state、地圖與表單等高風險邊界取得 strict 檢查效益
- JSDoc contract 可直接貼近既有程式碼，降低大規模副檔名、import 與建置流程遷移成本
- `npm run typecheck` 可在測試與 build 前快速攔截資料 shape、callback、DOM nullable 等問題

**限制：** Google Maps 與 HERE Maps SDK 是執行時動態載入，目前只在 ambient declaration 將其 global boundary 標為 `any`。這代表第三方 SDK 內部 API 不在本階段的嚴格型別保證內；應用程式自行擁有的資料與函式邊界仍以 JSDoc 嚴格檢查。若日後需要更完整 SDK 型別，再個別引入官方或維護良好的 declarations。

**擴充方式：** 每次納入新模組時，同步補足其 public JSDoc contract、imported boundaries 與測試，維持 `npm run typecheck`、完整 node tests、`npm run build` 依序通過後才提交。

---

## 國家／目的地複選篩選

**決策：** 地理篩選採兩層式 `Country Code` → `Destination Key` taxonomy。
目的地代表城市或旅遊目的地，不代表曼谷行政區或街區。篩選器允許跨國複選；
同一層目的地之間使用 OR，並與搜尋、類別、收藏條件使用 AND。

**互動：**

- 國家 checkbox 全選或取消其所有子目的地；只選部分子項時顯示 indeterminate。
- 變更立即套用，選擇儲存在 `localStorage`，重新載入後還原。
- 每次目的地變更後，Google Maps 與 HERE Maps 都縮放至所有篩選結果；
  單一結果使用地點層級 zoom，零結果維持原視窗。

**資料契約：** taxonomy 集中在 `src/data/destinations.js`。每個 `Published`
地點必須具備受支援且互相匹配的 `Country Code` 與 `Destination Key`；
匯出快照驗證失敗即阻擋 build/deploy。`Paused`／`Inactive` 草稿可暫時未分類。
