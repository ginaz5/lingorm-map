# Lingorm Map — 技術選型紀錄

> 記錄本專案的架構決策與選型理由，方便日後維護或交接。

現行維護入口（2026-10-24）：[文件索引](../docs/README.md)、
[兩品牌匯率契約](../docs/exchange-rate-contract.zh-TW.md)、
[橘標 Netlify 維運](../docs/superrich1965-netlify-runbook.zh-TW.md)、
[Actions 手動備援](../docs/superrich1965-actions-runbook.zh-TW.md)。
橘標目前由 Netlify 自動取價，PR #18 已完成正式兩輪排程驗收。
目前程式的橘標資料管線只保留逐店快取，舊完整快照 API／fallback 與本機取價 CLI 已退役；
綠標仍使用完整快照。
以下有日期的決策保留當時背景；其中「尚未部署／待驗收」不代表目前狀態。

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
`src/map/map.js` 的 `makeMarkerContent(icon, isExchange = false, brand = null)` 產生。
`getExchangeBrand(row)` 依正式 mapping 判斷綠標／橘標身分。

- Emoji 取自 `row.icon`（由 `src/data/csv-parser.js` 依 category 自動填入），找不到時 fallback 為 📍。
- 公開狀態刻意不編碼進顏色（`Published` 才會出現在地圖上，篩選已在更上游處理）。
- 換匯分店加入 `.is-exchange`；綠標使用綠色，橘標另加入 `.is-exchange-orange`。
  兩品牌 mapping 的聯集決定支援範圍，前端正規化為 `Type = Currency Exchange`、空白 Category。

**群聚著色：** 全綠標群聚使用綠色，全橘標群聚使用橘色；跨品牌或混有一般地點的群聚使用預設樣式。

- **Google：** renderer 以 `getExchangeClusterBrand(markers)` 檢查各 marker 保存的 `__markerContent` 與品牌 class。
- **HERE：** `cluster.forEachDataPoint(cb)` 走訪葉節點，`getExchangeDataPointsBrand(forEachDataPoint)` 檢查 `getData().isExchange` 與 `exchangeBrand`。
- 品牌判斷不依賴 Google／HERE 全域物件，兩品牌與混合群聚行為由 `tests/exchange-rates-1965-ui.test.mjs` 驗證。

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

**公開表單：** `issue-report` 回報地圖問題。新增地點、建議修改及審核狀態 UI 已移除；
正式資料由管理端查證後更新 Notion。

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

**兩段切換：** `light` ↔ `dark`。未儲存偏好或舊值 `auto` 皆使用 light，不跟隨系統。

Google Maps 主題同步：依新的 colorScheme 重建地圖並保留 viewport。
HERE Maps 主題同步：依 `getHereBaseLayer()` 切換可用的日間／夜間 base layer。

**偏好持久化：** `localStorage.setItem('theme', ...)`

---

## 多語支援：i18n 系統

**架構：**
- 共用 UI 翻譯集中在 `src/core/i18n.js` 的 `T` 物件；更新紀錄另由 `src/features/changelog-data.js` 維護雙語內容
- HTML 元素使用 `data-i18n`, `data-i18n-ph`, `data-i18n-html` 屬性
- `updateLangUI()` 單次 scan 更新全部元素
- 動態渲染內容（卡片、category filter）在語系切換時重新 render

**類別資料：** `src/ui/render.js` 的 `buildCatFilter()` 從公開地點計算類別與數量。
`src/data/csv-parser.js` 的 `CATEGORY_ALIASES`、`ZH_BY_CAT`、`ICON_BY_CAT` 負責類別正規化、中文名稱及 emoji；
前台沒有新增地點類別下拉選單。

目前支援 zh／en。若新增語言，需同步處理語言型別、控制、位置名稱與內容 fallback，
以及列表、popup、類別和更新紀錄的翻譯與回歸測試。

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
同一層目的地之間使用 OR，並與搜尋、類別、標籤、收藏條件使用 AND。

**互動：**

- 國家 checkbox 全選或取消其所有子目的地；只選部分子項時顯示 indeterminate。
- 變更立即套用，選擇儲存在 `localStorage`，重新載入後還原。
- 每次目的地變更後，Google Maps 與 HERE Maps 都縮放至所有篩選結果；
  單一結果使用地點層級 zoom，零結果維持原視窗。

**資料契約：** taxonomy 集中在 `src/data/destinations.js`。每個 `Published`
地點必須具備受支援且互相匹配的 `Country Code` 與 `Destination Key`；
匯出快照驗證失敗即阻擋 build/deploy。`Paused`／`Inactive` 草稿可暫時未分類。
目前支援 `TH`、`VN`、`TW`、`HK`、`MO`、`JP`；台灣目的地為 `taipei`、
`taichung`、`kaohsiung`、`tainan`、`hualien`，香港與澳門分別使用
`hong-kong`、`macau`，日本目前支援 `tokyo`（東京 / Tokyo）。既有泰國與越南 key 保持不變。

---

## 地點標籤篩選

**決策：** 公開網站將正式資料的 `Type` 欄位顯示為「標籤」，以單選下拉
與搜尋、類別、目的地及收藏條件使用 AND。篩選順序固定為
「類別／標籤／目的地」，只顯示目前 `Published` 地點中實際存在的選項。
英文篩選器顯示為 `label`，避免和地點類別混淆；正式資料欄位仍維持
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

**決策：** 前端透過本站 API 讀取換匯報價；由獨立的 Netlify 排程 Function
（`exchange-rates-fetch.mjs`，泰國時間
08:00～22:30 每 30 分鐘）向來源抓一次、正規化後寫入 `@netlify/blobs` 快照，前端只打站內
`/api/exchange-rates`（`exchange-rates.mjs`）讀最新快照。現行資料邊界見
[匯率資料契約](../docs/exchange-rate-contract.zh-TW.md)，操作見
[綠標維運](LOCAL_TESTING.md#換匯功能上線與維運手冊)。早期
[實作計畫](../docs/archive/exchange-rates/plans/superrich-exchange-map-plan.zh-TW.md)與
[進度紀錄](../docs/archive/exchange-rates/plans/superrich-exchange-map-progress.zh-TW.md)保留當時設計與驗證；
下方依日期記錄後續調整。

**2026-09-27 時段調整：** 使用者確認以 `Asia/Bangkok` 為準，23:00～08:00
停止來源抓取。UTC cron 為 `0,30 1-15 * * *`，每日 30 輪。當時 Function 與
runner 另外檢查更新時段（已於 2026-09-28 移除，見下段）。到期規則維持
下一個半小時邊界加 90 秒，22:30 的快照在 23:01:30 到期，不延長到隔天。
前端仍每分鐘確認本站 API，08:00 的新快照完成後即可恢復報價。

**2026-09-28 移除程式內時段檢查：** 使用者決定拿掉 Function 與 runner 的
`[08:00, 23:00)` 檢查（含 `isExchangeFetchTime`）。排程與人工觸發（UI
Run now、`netlify functions:invoke`）沒有可靠、文件化的欄位可以區分，因此
只保留 cron 作為唯一時段限制：排程行為不變；人工觸發任何時間都會抓取來源
並寫入快照，仍受控制旗標與 breaker 限制。夜間手動快照沿用同一到期規則
（下一個半小時邊界加 90 秒）。代價：夜間手動觸發會多打一輪來源（約 27 個
請求），失敗也會計入 breaker。

**2026-09-28 到期寬限延長為 35 分鐘：** 使用者反映 90 秒寬限太短，排程稍微
延遲或單輪失敗就立刻顯示「暫無報價」。改為 `SNAPSHOT_GRACE_MS = 35 分鐘`
（約一個更新週期），單一延遲或失敗的一輪不會清空畫面，要等到連續兩輪都
沒有新快照才會過期顯示「暫無報價」。`nextUtcHalfHour` 與排程週期本身不變，
只調整 `expiresAt = nextUpdateAt + 寬限`；22:30 的最後一輪 `expiresAt` 從
23:01:30 延到 23:35。代價：畫面可能多顯示最長 35 分鐘的舊報價。

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

**儲存範圍由 Function 的 `context.deploy.context` 決定。** API 與排程
都把執行期 context 傳入儲存工廠：`production` 使用與管理指令相同的
site-wide store；Preview、branch deploy、本機及缺少 context 時使用
deploy-specific store。不要依賴 `process.env.CONTEXT`，它是建置期變數。

**Circuit breaker 不是「重新啟用就重抓」。** 403／429 會立即封鎖
6h→24h→自動停用；`npm run fx:control -- enable` 只清除連續失敗計數，
**保留尚未到期的 `blockedUntil`**——這樣管理者才不會在來源還在限流時，
因為手動重新啟用而立刻又觸發一次封鎖。封鎖期滿後，下一輪排程（或人工
觸發一次）就會自動恢復抓取；等待期間 API 回 `enabled: true, snapshot:
null`，前端顯示「暫無報價」而不是隱藏整張卡片。

**來源故障時的降級路徑，全部發生在既有 UI 骨架內：** 換匯標籤、分店卡
片、綠色標記、Google Maps／導航連結、收藏都不受影響；只有三列報價本
身在 `enabled:false` 或快照過期時顯示「暫無報價」並回到一般排序。沒有
額外的錯誤畫面或彈窗。

報價到期不受輪詢暫停影響：離線、背景頁面，以及 API
請求尚未完成時，仍保留到期計時；頁面恢復執行時先撤下過期數字，再
安排查詢。自動停用後的 breaker 清理沿用該輪寫入的 ETag，遇到較新的
手動控制變更就放棄清理，避免覆蓋重新啟用後的版本。

**2026-10-17 橘標整合：** 沿用 main 的標籤篩選、filter sheet、popup 置中與粉絲資源
分析事件，新增 SuperRich 1965 的獨立報價 state／輪詢、API、來源抓取及管理工具。
兩品牌共用「換匯」標籤與排序選單；綠標維持三列，橘標顯示 USD 100＋50、
TWD 1,000–100 兩列。單一品牌停用、失敗或到期不會清除另一品牌報價。
單品牌群聚使用該品牌顏色，混合群聚維持預設樣式，Google／HERE 行為一致。

`isSupportedLocation()` 接受兩份已驗證 mapping；未知換匯點仍不公開。
舊橘標快照使用 `Category = Currency Exchange`，CSV parser 在 runtime 將它
轉為空 Category 與 `Type = Currency Exchange`，以沿用 main 的唯一標籤入口。
不修改正式 CSV；未來由 Notion exporter 產生的新資料可直接使用 Type 欄位，
mapping validator 同時接受這兩種表示。所有 `Paused` 狀態與收藏 Slug 保持不變。

目前 38 家橘標仍為 Paused；整合程式不代表發布分店或啟用報價服務。
橘標服務預設 disabled，`EXCHANGE_RATES_1965_FETCH_MODE=local` 時雲端排程
不打來源，由既有本機 CLI 明確發布快照；未設定 FETCH_MODE 的相容預設仍為
`netlify`，但抓取仍受 disabled/control/breaker 限制。本次未更動線上設定。


### 2026-10-17：橘標改採單店手動查詢

以下保留單店與定時更新方案的歷史；現行只讀行為見本節末的退役決定。

使用者確認改為卡片按鈕觸發本站後端單店查詢。新增
`POST /api/exchange-rates-1965-branch`，只接受正式 mapping 的 Slug，由後端
轉換 branchNo／companyCode；前端不直接跨站抓來源。完整契約見
[單店按需查詢計畫](../docs/archive/exchange-rates/plans/superrich1965-on-demand-plan.zh-TW.md)。

單店報價使用獨立 Blobs key 與最多 5 分鐘 TTL，不放寬原本完整 38 店 snapshot
驗證。跨 Function 的強一致 ETag lease 控制冷查詢併發；快取命中可直接回傳，
冷請求期間其他訪客取得 busy 與 Retry-After，避免重複來源請求。
單店成功不重設整批 breaker 的升級歷史，失敗與 challenge 則更新同一 breaker。
（2026-10-24 起，發布成功會清除連續失敗計數，見同日「發布成功清除連續失敗計數」。）
新的 `FETCH_MODE=on-demand` 可停掉整批排程；既有 local／netlify 相容行為保留。

前端只在使用者點擊後 POST，不因渲染、切換分頁或到期自動抓來源。到期計時
僅撤下數字並恢復按鈕，查詢狀態與報價在列表及兩種 provider 的 popup 共用。
排序只比較有效報價，不宣稱為完整分店排名。服務停用後，已載入的有效報價
可保留到原 5 分鐘 TTL；下一次查詢觀察到新 controlVersion 會一併撤下其他
卡片的舊版本報價。本次未發布分店、未切換正式環境、未部署。

後續決定：改為後端每半小時派送 Background Function，逐家查詢全部 38 家，
每家完成後隨機等 2～5 秒。排程不在 30 秒內跑整輪，背景工作預算 12 分鐘。
私有 token 與 ETag 認領避免未授權／重複抓取，每店獨立保留成功結果；遇到
失敗冷卻、封鎖、停用或控制版本變更即停止，舊快取不覆寫。

頁面每 60 秒只讀逐店快取，不顯示批次進度；沒有有效報價的卡片才提供單店
補查按鈕。移除五公里前端佇列。橘標單店與綠標共用同一到期計算模組：下一個
半小時邊界加 35 分鐘；後端仍每半小時刷新到期更新的分店，讀快取不延長時間。
舊整批 snapshot／CLI 契約保留，綠標到期行為不變。本次未改正式旗標或部署。

### 2026-10-18：橘標增加 Netlify 瀏覽器傳輸驗證模式

使用者要求維持全 Netlify 執行，新增可選的 `SOURCE_TRANSPORT=browser`。
在現有控制、快取與租約檢查後，於函式內啟動 Chromium、載入官網公開頁面的
JS/session，再使用 same-origin fetch 查 mapping 中的單店。保留 HTTP 預設，
兩支來源函式的 browser 在 invocation 完成時關閉；背景輪次重用同一 session。
不使用本機 Chrome、外部服務、Cookie 匯入、CAPTCHA 解題或 stealth patches。
Cloudflare challenge 仍停止並沿用冷卻，是否改善雲端可用性必須由 Preview 實測。
來源的 browser timeout／lease 及前端等待時間同步調整，報價到期與綠標不變。

### 2026-10-19：橘標增加選用的匿名 API 傳輸

本機已驗證匿名 callback GET 與 external-app 單店 POST 可回有效 USD／TWD
指定面額買入價，增加 `SOURCE_TRANSPORT=anonymous-api`，預設仍是 HTTP。
token 在原有控制、快取、breaker、lease 後 lazy 取得，只留在 invocation
記憶體；背景工作可重用有明確到期提示的 token。callback 與 rate 都計入來源
請求數及共用逾時，私有診斷以 stage 區分，不記錄 token 或任意來源文字。
任一階段的 403／429／challenge 都沿用既有冷卻，不 fallback 或自動重試。
保留原本 mapping、parser、快取與背景間隔；Chromium 未調整。
這是新的可選後端路徑，本機成功不代表已驗證 Netlify 出口或 38 家覆蓋。

### 2026-10-19：先規劃 GitHub Actions 抓取與 Netlify 逐店快取

同日後續 Preview 已確認匿名 token GET 被 403 challenge 擋下，匯率 POST
沒有發出。ThaiCash 的 Actions 有公開單店成功紀錄，使用者同意先修改文件，
規劃將來源請求移至 Actions、Netlify 保留 cache／API／前端。
先做手動單店 probe，再發布至明確 Preview 逐店 cache，最後驗 38 家與排程。
沿用匿名 transport、parser、mapping、共享 control／lease／breaker 與 2～5 秒間隔，
不以換 runner 或新 store 清除已知冷卻，也不將報價 commit 來觸發網站部署。
現有 CLI 的匿名接線／逐店發布、Preview target、probe 不發布與 Netlify 單店
只讀行為皆待實作；`FETCH_MODE=local` 現在只停排程，不能當成單店只讀開關。
首次 workflow_dispatch 仍需 workflow 存在預設分支。實作與驗收條件見
[Actions 計畫](../docs/archive/exchange-rates/plans/superrich1965-github-actions-plan.zh-TW.md)。
本次沒有新增 workflow、設定 Secrets、抓來源或更動 runtime／遠端狀態。


### 2026-10-20：退役橘標 Netlify 來源入口與環境開關

使用者要求同步退役不再需要的 functions 與 env。刪除橘標 fetch 排程、refresh
Background Function、Netlify dispatch，以及 Chromium helper、專用測試、套件和
binary 打包設定。移除 `EXCHANGE_RATES_1965_FETCH_MODE` 與
`EXCHANGE_RATES_1965_SOURCE_TRANSPORT` 的程式讀取及範例宣告；上方這兩個
開關與 browser／背景取價的說明均為歷史，不再是本分支的啟用方式。

保留三個公開 API 的路徑與資料契約，單店 POST 改為只讀快取／有效 snapshot
fallback，無資料回 503 unavailable 與 60 秒 Retry-After。公開入口不載入
collector、不初始化 control、不讀 breaker 或取得 lease，也不寫 Blobs。
前端改為「重新整理匯率／Refresh rates」，兩種 cache 請求 timeout 均為 12 秒。
讀取不延長報價有效期；外部抓取器尚未就緒時，舊報價依原時間到期。

`EXCHANGE_RATES_1965_ENABLED`、管理工具的 Netlify credentials 與既有 control／
cache／breaker／gate／lease／job 資料保留。匿名 transport、mapping、parser、
逐店 collector、慢速批次核心和原本完整 snapshot CLI 留給後續整合；
新 Actions runner、Preview target、probe、Secrets 和排程仍待實作。
本次程式變更尚未部署，不以退役清除來源冷卻，綠標流程維持原樣。

兩個退役環境變數已從 Netlify 專案所有 context 移除；CLI 確認需重新部署才會
套用到部署版本。本次未部署，沒有刪除或改寫遠端 control、breaker、快取及憑證。


### 2026-10-20：Actions 實作前調查與計畫補強（尚未實作）

依使用者要求先調查並寫計畫。核對現有逐店／批次核心、SDK 11.0.3、GitHub
官方限制及 ThaiCash 的固定版本成功輸出；它只證明單店部分幣別曾成功，不能
代替本專案 GitHub runner 的 TWD、指定面額、38 家及長期穩定驗收。

計畫建議保留 targetStore 的報價／control 隔離，另以固定 site-wide source guard
保存跨 Preview／production 的來源冷卻與互斥。probe 成功不發布 quote，但必要的
lease／失敗 breaker 要持久化；須補明確 target、控制管理、job 建立、rerun 冪等、
取消與完整 coverage。舊本機 full-snapshot CLI 不直接搬入 Actions。

實作與 mock 先完成，再經 workflow main bootstrap 做單店 probe，之後才驗
Preview 單店／pilot／38 家與正式排程。詳見[計畫](../docs/archive/exchange-rates/plans/superrich1965-github-actions-plan.zh-TW.md)
及[調查證據](../docs/archive/exchange-rates/research/superrich1965-actions-research-2026-10-20.zh-TW.md)。
本次只改文件，沒有實作、呼叫來源、執行 workflow、設定 Secrets、改遠端或部署。


### 2026-10-20：Actions 本機實作與部署界線

使用者同意 probe 成功前正式網站不變、專用有到期日 PAT／Environment，以及日後
泰國 08:00～22:30 每半小時更新。新增手動 inspect／probe workflow、明確 target
factory／控制 CLI、source guard、job／operation ledger 與 probe／publish 核心；
checked-in target 預設空，workflow 沒有發布或排程入口。

共同 guard 的 unresolvedAttempt 在來源前落盤，已知 403 即使取消或 target control
改變也先持久化冷卻；未知結果不因租約到期解鎖。Probe 成功不寫 quote，失敗仍保留保護。
Rerun 先讀 terminal ledger、保留原失敗結果；設定／storage 錯誤不當成中性 skip。
發布前最後一次 await 後重驗期限，資料損壞與 CAS 競態都停止來源或發布。

Netlify 官方支援最終 main commit 的 `[skip netlify]` 避免該次正式部署；PR title
只處理 Preview，下一個未標記 commit 仍包含所有略過變更。Bootstrap 前後須核對實際
commit／Netlify 狀態，不能把標記當作持續鎖站。見[維運文件](../docs/superrich1965-actions-runbook.zh-TW.md)。
本次只做本機程式與 mock；未建立憑證、改遠端、執行來源、發布 workflow、部署或 commit。
以下為 bootstrap 階段歷史：當時正式版只支援 SuperRich Thailand（綠標）。正式快照仍可能包含其他換匯品牌的
資料列（例如已暫停的 SuperRich 1965），因此顯示規則改以「此版本支援的換匯點」
判斷：`Type = Currency Exchange` 的地點必須在綠標 mapping 中才會顯示；
換匯點的 `Category` 留空，以標籤作為單一換匯篩選入口。
由 `isSupportedLocation()` 併入 `isPublicLocation()`，清單、搜尋、收藏、篩選
計數、目的地選項與 Google／HERE marker 共用同一個判斷。刻意不用品牌 Slug 黑名單；
收藏中既有的其他品牌 ID 也不清除，日後支援該品牌時仍可對應。

### 2026-10-21：獨立橘標 Actions bootstrap

使用者要求 PR #8 保持開啟，先獨立準備手動 workflow、collector 依賴與固定 Preview
target，讓 runner 驗收可在前端功能合併前進行。沿用 main-only Environment／執行身分、
共用來源 guard、control／lease／breaker 與既有 probe，不新增來源的公開 Function。
現有前端、CSV、公開入口與綠標排程維持 main 版本。本機準備及 mock 驗證沒有取價或部署；
後續 main bootstrap 須核對最終 `[skip netlify]` 與正式發布基準。詳見
[bootstrap 操作與驗收](../docs/archive/exchange-rates/research/superrich1965-actions-bootstrap.zh-TW.md)。

### 2026-10-22：橘標正式上線接線

使用者選擇完整準備後合併 PR #8。保留 main 的 Python／Safari、五店／全店與來源
保護，正式 target 用 Environment 的 `EXCHANGE_RATES_1965_PRODUCTION_COMMIT` 綁定
經核對的實際 production SHA；網站換版未重新核准便停止。沿用既有 main-only
Environment 專用 PAT，Preview／正式 quote store 隔離，共用 guard 的 epoch、
blockLevel=2 與冷卻歷史不變。每店開始及發布前重新核對正式部署，失配停止。

排程固定泰國 08:00～22:30 每半小時；repository variable 明確 true 才通過 job 與
CLI 兩層 gate，只能全店 production。正式人工取價、API、地圖與排序通過才啟用，
再驗真正定時更新。網站回滾不會回復 Blobs 或停 Actions，須另操作 guard／control。

Preview 已驗五店全新及後續 33 新加 5 cache 的 38 店覆蓋。PR #8 已合併為
`e88e8b90d46194faa9f8ca5179efd89655d7c802`，正式 deploy
`6ad94882c583f63d0a5bc49b` 已 ready 並綁定到 Environment SHA。
正式 inspect、單店新取／發布及五店 4 新取＋1 cache 已通過，production control
獨立建立，不搬 Preview quote。正式全店於刷新邊界後全數 38 店新取並發布，
cacheHit=0、來源 HTTP=39，API／quote 及零讀取副作用通過；正式 Google、中英文及
USD／TWD 排序通過。HERE 的現場隔離驗收與實際 quote 離線到期測試分別記錄，
不將其描述成正式站現場切換 HERE。台灣時間 07:41 已核對排程開關為 true、
guard resumed 且無 lease／未結案來源，原 control／epoch／封鎖歷史不變；
首兩輪預定台灣時間 09:00／09:30，真正定時更新另行驗收。
操作見 [Actions 維運文件](../docs/superrich1965-actions-runbook.zh-TW.md)，
實際證據見 [正式上線紀錄](../docs/archive/exchange-rates/releases/superrich1965-production-release.zh-TW.md)。

### 2026-10-23：橘標 token 到期前不提早要求更新

實際排程證實 callback GET 可能回傳同一個、僅剩 18 秒有效期的 token，
因此原本在剩 30 秒時更新會讓整輪停止。Actions 改在已知 token 剩餘 ≤45 秒時，
於 target／source lease 起算前先等待到期後 2 秒；45 秒包含原 30 秒安全邊界與
15 秒啟動裕度。快取命中不等待，等待仍受 12 分鐘 job、取消與 ownership 限制，
結束後重驗正式部署，再由原控制、breaker、guard 與 CAS 把關來源工作。
不改 HTTP 失敗重試政策、未知 TTL、冷 session 無效 token 或封鎖處理。

### 2026-10-23：Netlify Python 背景取價與排程切換

Netlify 上的獨立 Python 單店及 38 店實測成功，不能將先前 Node 的 403 概括為
所有 Netlify 傳輸皆失敗。新正式 collector 延用 Python 與既有來源 guard／逐店契約，
以 Scheduled Function 派送 Background Function，維持泰國 08:00～22:30 半小時頻率。
Server-only control 綁定實際 deploy 與 quote control，HMAC 驗證 worker、每 slot CAS
只派送一次；來源及發布前核對目前部署。Python binary 僅在 build 下載並核對固定摘要，
只放入 worker 封包，不進 Git。GitHub cron 移除並保留手動備援，Netlify 啟用時拒絕
GitHub 取價。實際 Preview／正式啟用及定時驗收不得由本機測試推定，見
[Netlify 維運手冊](../docs/superrich1965-netlify-runbook.zh-TW.md)。

### 2026-10-23：橘標來源逾時放寬與 token 逾時單次重試

20:30 自動排程在第一個 token callback GET 逾時（`stage=token`、`status=null`、
`challenge=false`、`reason=timeout`）就停止：1 次來源請求、0 店發布，先前報價約
20:05 到期，38 家全部「暫無報價」。19:12 人工首輪也有一次 rate POST 逾時。
同時段的平行實驗 39 次請求全部 200，來源本身可達，判斷為 Netlify 出口的偶發慢連線。

調整兩項，皆不改請求身分（URL、UA、headers、body 不變）：

- **逾時放寬：** 單一 HTTP 呼叫上限 12 秒 → 25 秒（`PYTHON_REQUEST_TIMEOUT_MS`；
  Python helper socket 逾時 30 秒僅作後備）。`ANONYMOUS_SOURCE_PROFILE` 改為
  `requestTimeoutMs 75_000`、`deadlineMs 80_000`（token 25＋token 重試 25＋rate 25）。
  來源 lease 隨 `deadlineMs + 9s` 變為 89 秒。token 到期等待改用獨立常數
  `TOKEN_READY_LEAD_MS = 15_000`，不隨 deadline 放大，避免新 token 被誤判為將到期。
- **token 逾時重試一次：** 只在 token GET 以 Python 層逾時結束（`python_source_timeout`）
  且呼叫端未取消時重試一次。HTTP 回應（403／429／challenge／5xx）、其他網路錯誤、
  rate POST、body 解析失敗、呼叫端取消一律不重試，維持原停止行為。兩次嘗試都計入
  來源請求數與診斷（先 `timeout` 再結果），第二次也逾時時整個 quote 以 failed 計入 guard。
  這是對 10/17 之後「不新增來源 retry」規則的明確例外，範圍僅限 token GET。

代價：最壞情況單店約 75 秒；整輪仍受 12 分鐘預算與失敗即停限制。尚未部署，
需重新部署後依 Netlify 維運手冊重新 bind／enable，並觀察至少兩輪真正的排程收據。

**後續修正（23:00 排程失敗）：** 部署後 23:00 輪次第一店 token 逾時、重試成功並已發布，
但 actions runner 的逐店結果驗證仍限制 `sourceRequestCount <= 2`、診斷最多 2 筆，
3 次請求（token＋token 重試＋rate）被判為 `source_unknown`／`invalid_result`，
整輪停止、其餘 37 店未嘗試。上限改為 `MAX_BRANCH_SOURCE_REQUESTS = 3`，
診斷保留 3 筆；超過 3 仍 fail closed。新增 runner 單元與 Python 端到端整合測試。

### 2026-10-24：橘標重試結果契約修正與正式排程驗收

Token GET 逾時重試成功後，同一店會有 token、重試與 rate 共 3 次來源請求。
PR #18 將 runner 逐店結果與安全診斷上限一併改為 3，避免成功發布後被誤判為
`invalid_result`；超過上限仍拒收。這沒有擴大重試條件，其他來源失敗沿用停止規則。

PR #18 已正式部署，09:30、10:00 兩輪自動排程均新取並發布 38 店，後續追加回查也通過。
正式取價維持 Netlify scheduler／Python background worker，GitHub 沒有 cron、保留手動備援。
具體部署、binding 與逐輪證據見[最新上線紀錄](../docs/superrich1965-netlify-pr18-release-2026-10-24.zh-TW.md)。
舊計畫、bootstrap 與實驗已封存；現行資料邊界整理至[匯率資料契約](../docs/exchange-rate-contract.zh-TW.md)。

### 2026-10-24：橘標舊完整快照管線退役

橘標正式取價與公開讀取已使用逐店 quote，保留舊完整快照管線會增加未使用的
輪詢、state、驗證與來源入口。本次移除前端舊完整快照輪詢／state、
`/api/exchange-rates-1965` 端點、單店完整 snapshot fallback，以及本機
`fx:1965:fetch` 取價 CLI；目前的公開報價與 collector 都只讀各 Slug 的逐店 cache。

保留 `/api/exchange-rates-1965-cache`、`/api/exchange-rates-1965-branch`、
供部署綁定核對的 `/api/exchange-rates-1965-runtime`，以及現有管理控制 CLI。
來源工作由 Netlify scheduler／Python background worker 執行，Actions 保留受控手動備援。
既有橘標 snapshot Blobs 不讀取、不搬移、不改寫或刪除；逐店 quote key、控制與有效期不變。
綠標 `/api/exchange-rates` 完整快照與 Notion 位置 CSV snapshot 繼續使用。

這次是目前程式的退役整理，部署仍須另依 runbook 核對、重新綁定與驗收。
過去 release、archive 與 evidence 保留當時的相容契約及驗收結果，不回寫歷史。

### 2026-10-24：橘標發布成功清除連續失敗計數

舊完整快照 runner 退役後，沒有任何路徑會在成功時清除 `consecutiveFailedRuns`；
相隔數小時或數天的 3 次單店失敗，即使中間有大量成功，仍會觸發 1 小時退避，
使所有分店回 429 cooldown。

`queryBranchRates()` 在單店報價實際寫入逐店 cache 後，以 `clearFailedRuns()`
將共用 breaker（`EXCHANGE_KEYS.breaker`）與 source guard breaker 的連續失敗計數歸零：

- 只清 `consecutiveFailedRuns`；`blockLevel`（6h→24h→自動停用升級）與
  `blockedUntil` 原樣保留，連續 challenge 仍會升級。
- 只在發布後執行。快取命中、`publishQuote:false` probe、來源未發出請求都不清除；
  `finishSourceAttempt()` 本身仍不重設任何歷史。
- Source guard 須仍持有該次 lease 才寫入（`clearSourceFailedRuns()`），兩者皆用 CAS。
- 清除為盡力而為：寫入失敗不改變已發布報價的 200 回應，計數維持原值。


### 2026-10-24：橘標移除分階段上線模式

正式取價只走 `publish-all-python`（Netlify worker 與 Actions 手動備援皆然），
但 runner／CLI／workflow 仍保留 PR #10～#12 試跑用的 probe、單店、五店、
pilot 與 Node 傳輸模式，以及 workflow 從未啟用的 GitHub schedule 路徑。
本次只留 `inspect` 與 `publish-all-python`：

- Runner 只接受 `mode: 'publish-all-python'`、`scope: 'all'`，固定 38 店；
  `probe_succeeded` 不再是合法逐店結果。
- Ledger 的 operation identity 仍保留 mode／scope 欄位與原格式，
  既有 `publish-all-python` 紀錄（含 stale job 回收路徑）照常可讀。
- CLI 拒絕任何 schedule 事件（含 inspect），不再讀
  `EXCHANGE_RATES_1965_SCHEDULE_ENABLED`；來源固定為 Python 傳輸。
- 來源保護、lease、breaker、source guard、逐店 cache key 與有效期不變。

若 `exchange-rates-1965/actions/job` 停在一筆舊模式的 running 紀錄，回收時會因
identity 不合而以 `invalid_operation` 停止，需人工檢查。Netlify collector 每輪都以
`publish-all-python` 寫入該 key，因此正常排程下不會遇到；此點依程式行為推斷，
未直接讀取正式 Blobs 確認。
