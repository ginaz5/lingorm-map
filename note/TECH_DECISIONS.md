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

兩個 provider 的瀏覽器 SDK key 都由 Netlify Function `/api/config` 從環境變數讀取，在 runtime 傳給瀏覽器，因此不會 hardcode 在 HTML、commit 進 repository，或 bundle 進 `dist/`。但 Google Maps JS 與 HERE Maps JS 都在瀏覽器執行，key 仍會出現在 DevTools／Network；`/api/config` 不是隱藏 key 的安全邊界。這類 key 必須視為公開識別碼，以網站、API、quota 與監控限制保護。

Google Maps 保護：
1. **Website application restriction**（Cloud Console → Credentials）：僅允許 `https://lingorm-map.netlify.app/*`、實際需要的 Netlify Deploy Preview origin，以及本機開發用的 `http://localhost:8888/*`。
2. **API restriction**：僅允許 Maps JavaScript API 與前端確實使用的 Maps library；不得與 server-side Places／Geocoding 等 web-service key 共用。
3. **Server key 分離**：`GOOGLE_PLACE_KEY` 等 server-only credential 必須使用獨立 key 與限制，且永遠不可由 `/api/config` 回傳。
4. **Quota 與監控**：維持 Maps JS API quota、billing alert 與 usage monitoring；實際門檻依 Cloud Console 的現行設定為準。

HERE Maps 的 browser key 同樣會由 SDK request 暴露；應在 HERE project 設定支援的範圍內套用網站／domain restriction 與用量限制。若需求是讓 credential 真正保密，必須改用 server-rendered static map，或只針對 provider 支援的 web-service API 建立 server proxy；單純改寫 `/api/config` 回應格式無法達成。

參考：[Google Maps Platform security guidance](https://developers.google.com/maps/api-security-best-practices)、[Maps JavaScript API setup](https://developers.google.com/maps/documentation/javascript/get-api-key)。

**Netlify env vars：**

| Variable | Required | 說明 |
|----------|----------|------|
| `HERE_API_KEY` | ✅ | HERE Maps JS API key（fallback，必須） |
| `GOOGLE_MAPS_KEY` | optional | Google Maps JS API key（primary） |
| `GOOGLE_MAP_ID` | optional | Map ID（dark mode + AdvancedMarkerElement） |
| `DATA_SOURCE` | optional | `notion`（唯一支援值，也是預設值）；切換後需重新部署 |

---

## 地圖 Marker：Emoji 圓形 badge

> 本節先前記錄的「依 Verification Status 上色」模型已隨換匯功能改版；
> 目前程式**不再**依審核狀態決定 marker 顏色，一律以下列現行行為為準。

**架構：** `AdvancedMarkerElement` + 自訂 HTML content（28px 圓形 div），由
`src/map/map.js` 的 `makeMarkerContent(icon, isExchange)` 產生：

```js
export function makeMarkerContent(icon, isExchange = false) {
  const el = document.createElement('div');
  el.className = `marker-dot${isExchange ? ' is-exchange' : ''}`;
  el.textContent = icon || '📍';
  return el;
}
```

- Emoji 取自 `row.icon`（由 `src/data/csv-parser.js` 依 category 自動填入），找不到時 fallback 為 📍。
- 公開狀態刻意不編碼進顏色（`Published` 才會出現在地圖上，篩選已在更上游處理）。
- 唯一的顏色變體是 `.is-exchange`（`--marker-bg:#16835b` 綠），套用在
  `Category = Currency Exchange` 的分店（`isExchangeLocation(row)`）。

**群聚著色（Phase D2）：** 單店綠色標記之外，全部由換匯分店組成的群聚也會顯示同一組綠色，混合群聚維持原有樣式（可接受的降級，先於 Phase D1 就這樣約定）：

- **Google：** `MarkerClusterer` 的 `renderer.render(cluster, stats, map)` 收到的 `cluster.markers` 就是建立單店 marker 時保留的同一批物件（`m.__markerContent = el`），因此 `isExchangeOnlyCluster(markers)` 只需檢查每個 marker 的 `__markerContent.classList.contains('is-exchange')`。
- **HERE：** `H.clustering.ICluster` 沒有現成的「成分清單」，改用 `cluster.forEachDataPoint(cb)` 走訪葉節點，`isExchangeOnlyDataPoints(forEachDataPoint)` 依此判斷是否每個 `DataPoint` 的 `getData().isExchange` 都是 `true`。
- 兩個判斷函式都刻意設計成純函式（不依賴 Google／HERE 全域物件），方便在 Node 測試環境下單獨驗證，見 `tests/view-first-ui.test.mjs`。

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
- 已驗證的 CSV 快照會隨程式版本保存，部署與回滾都可重現（回滾＝ git revert `data/locations.csv`）
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
同一層目的地之間使用 OR，並與搜尋、類別、主題、收藏條件使用 AND。

**互動：**

- 國家 checkbox 全選或取消其所有子目的地；只選部分子項時顯示 indeterminate。
- 變更立即套用，選擇儲存在 `localStorage`，重新載入後還原。
- 每次目的地變更後，Google Maps 與 HERE Maps 都縮放至所有篩選結果；
  單一結果使用地點層級 zoom，零結果維持原視窗。

**資料契約：** taxonomy 集中在 `src/data/destinations.js`。每個 `Published`
地點必須具備受支援且互相匹配的 `Country Code` 與 `Destination Key`；
匯出快照驗證失敗即阻擋 build/deploy。`Paused`／`Inactive` 草稿可暫時未分類。
目前支援 `TH`、`VN`、`TW`、`HK`、`MO`；台灣目的地為 `taipei`、
`taichung`、`kaohsiung`、`tainan`、`hualien`，香港與澳門分別使用
`hong-kong`、`macau`。既有泰國與越南 key 保持不變。

---

## 地點主題篩選

**決策：** 公開網站將正式資料的 `Type` 欄位顯示為「主題」，以單選下拉
與搜尋、類別、目的地及收藏條件使用 AND。篩選順序固定為
「類別／主題／目的地」，只顯示目前 `Published` 地點中實際存在的選項。
英文篩選器顯示為 `Collection`，避免和地點類別混淆；正式資料欄位仍維持
`Type`。篩選器旁的資訊按鈕會在 hover、focus 或點擊時顯示雙語分類說明，
並支援點擊外部或按 Escape 關閉。地圖 popup 則在類別 badge 旁顯示依目前
語言轉換的 Type badge。

**顯示契約：** 儲存與篩選仍使用穩定英文值；語言切換只改變顯示標籤：

| Type | 中文 |
| --- | --- |
| `LingOrm` | LingOrm |
| `JKR Picks` | JKR 推薦 |
| `JKR Fan Projects` | JKR 應援 |
| `Admin Picks` | 留友看 |

---

## 換匯匯率：排程快照 + 執行期控制旗標（而非即時代理）

**決策：** 前端**不會**在使用者每次開啟換匯開關時直接打 SuperRich 官方
API；由獨立的 Netlify 排程 Function（`exchange-rates-fetch.mjs`，每 30
分鐘）向來源抓一次、正規化後寫入 `@netlify/blobs` 快照，前端只打站內
`/api/exchange-rates`（`exchange-rates.mjs`）讀最新快照。完整規格見
[SuperRich 換匯地圖實作計畫](../docs/superrich-exchange-map-plan.zh-TW.md)
§4－§5；本節只記錄「為什麼這樣選」與上線／維運要點，執行細節與驗證見
[換匯功能進度紀錄](../docs/superrich-exchange-map-progress.zh-TW.md)。

**為什麼不做即時代理：**

| 考量 | 排程快照（現行） | 每次請求即時代理 |
| --- | --- | --- |
| 對來源的負載 | 固定、可預期（≤ 每 30 分鐘 1 次） | 隨訪客流量線性成長，容易被來源限流或封鎖 |
| 來源故障時的使用者體驗 | 只影響「下一次更新」，舊快照或「暫無報價」照常顯示 | 來源逾時／出錯會直接拖慢或打斷使用者的請求 |
| Netlify Function 執行時間 | 抓取與前端讀取互不影響（各自的 function） | 前端請求必須等來源回應，容易撞到 10 秒執行上限 |

**執行期停用 vs. 環境變數：兩者不是同一層開關。** 這是刻意的分工，
避免「改完環境變數卻沒生效」或「想暫停卻要重新部署」：

- **執行期控制旗標**（`scripts/exchange-rates-control.mjs` → `npm run
  fx:control -- status|enable|disable`）寫入 Blobs 裡的控制物件，**立即生
  效、不需重新部署**。用於日常開關、來源出問題時先緊急停用。
- **`EXCHANGE_RATES_ENABLED` 環境變數**只在控制旗標**尚未存在**時作為
  預設回退；改環境變數之後必須另外觸發一次部署才會被讀到新值。這層只
  用於「這個站台一開始要不要有這個功能」，日常開關一律用控制旗標。

**Circuit breaker 不是「重新啟用就重抓」。** 403／429 會立即封鎖
6h→24h→自動停用；`npm run fx:control -- enable` 只清除連續失敗計數，
**保留尚未到期的 `blockedUntil`**——這樣管理者才不會在來源還在限流時，
因為手動重新啟用而立刻又觸發一次封鎖。封鎖期滿後，下一輪排程（或人工
觸發一次）就會自動恢復抓取；等待期間 API 回 `enabled: true, snapshot:
null`，前端顯示「暫無報價」而不是隱藏整張卡片。

**來源故障時的降級路徑，全部發生在既有 UI 骨架內：** 換匯開關、分店卡
片、綠色標記、Google Maps／導航連結、收藏都不受影響；只有三列報價本
身在 `enabled:false` 或快照過期時顯示「暫無報價」並回到一般排序。沒有
額外的錯誤畫面或彈窗。
