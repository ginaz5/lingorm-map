# 檢視優先介面簡化實作計畫

**目標：** 將 Lingorm Map 調整為以搜尋、瀏覽與前往地點為核心的檢視型產品，移除一般使用者不需要的新增、審核與協作驗證介面。

**產品決策：**

- 前台移除「新增地點」。
- 前台全面隱藏審核狀態，而不只移除卡片上的 badge；範圍包含狀態篩選器、地圖彈窗、狀態圖例及 marker 的狀態配色。
- 移除地點卡片上的「建議修改／幫助驗證」及其表單流程。
- 保留全站「問題回報」，作為唯一且低干擾的資料修正管道。
- `Status` 欄位與六種 Notion 狀態全部保留，供管理端與資料品質控管使用；前台採明確 allowlist，只有 `Verified`、`Needs Review` 對外顯示，`Draft`、`Verifying`、`Could Not Find`、`Closed` 均不公開。
- Status 解析採 fail-closed：六種合法值原樣保留，明確 legacy alias 才進行轉換；真正未知或空白的值一律轉成非公開的 `Draft`。
- 完整移除未使用的 `Duplicate Group` CSV 欄位與前端 `dup` 資料屬性。2026-07-19 已直接檢查 Gina's Workspace 的 `Locations (PoC)` schema：目前只有 `Branch Group`，沒有 `Duplicate Group` 或 `Duplicate Of`，現有 98 筆 snapshot 的該欄亦全為空值。
- 正式資料來源已完成切換至 Notion；本計畫以 `DATA_SOURCE=notion` 與 committed `data/locations.csv` 為唯一發布契約。舊 Google Sheet proxy 不納入本次 schema 清理或發布驗收。

**非目標：**

- 除移除空的 `Duplicate Group` CSV 相容欄位外，不修改 Notion 或 API 的其他資料結構。
- 不改變目前 `Verified`、`Needs Review` 對外顯示的結果；同時補上 `Draft`、`Verifying`、`Closed` 的明確非公開規則。
- 不建立新的管理後台。
- 不重做搜尋、分類、收藏、定位、導航、語言或深淺色功能。
- 不修改已完成任務的 Sheet→Notion migration transform；`scripts/migrate-sheet-to-notion.mjs` 與其歷史輸入只保留作稽核紀錄。

---

## 預期前台資訊架構

### Header

- Lingorm Map 品牌
- 問題回報（桌面次要按鈕；手機維持在更多選單）
- 我的定位
- 語言
- 深淺色

### 篩選區

- 關鍵字搜尋
- 地點分類
- 我的最愛
- 結果數量

### 地點卡片

- icon、名稱、別名
- 分類
- 簡介
- 約略座標提示（若有）
- 資料來源
- 收藏

### 地圖彈窗

- icon、名稱、別名
- 分類
- 簡介
- 約略座標提示（若有）
- 資料來源
- 收藏、導航、Google Maps

地點的審核狀態不應出現在上述公開介面。`Branch Group` 是 Notion 內部用來串連同品牌不同分店的資料整理欄位，不匯出到網站；舊的 `Duplicate Group` 則從網站 snapshot schema 完整移除。

---

## 影響檔案

- `index.html`
  - 移除新增地點與建議修改的 Netlify detection forms。
  - 移除新增按鈕、待審核提示、狀態篩選器與狀態圖例。
  - 移除新增／建議修改 modal。
  - 保留問題回報 detection form 與 modal。
- `src/render.js`
  - 移除公開狀態 badge、重複群組 badge及卡片協作按鈕。
  - 移除狀態篩選與 `buildStatusFilter()`。
  - 將 `isPublicLocation()` 改為只允許 `Verified`、`Needs Review` 的明確 allowlist。
- `src/csv-parser.js`
  - 從必要標頭與 `LocationRow` 移除 `Duplicate Group`／`dup`。
  - 保留六種 Notion status 原值，不再將未知工作流狀態自動降成 `Needs Review`。
- `scripts/export-snapshot.mjs`
  - 停止輸出永遠為空的 `Duplicate Group` 欄。
- `data/locations.csv`、`tests/fixtures/notion-poc/*.csv`
  - 將 snapshot 與 fixture 更新為不含 `Duplicate Group` 的 schema。
- `src/map.js`
  - marker 改採一致的品牌色，不再由 status 決定樣式。
- `src/main.js`
  - 移除新增／編輯 modal 的 import、window exposure、事件綁定與初始化。
- `src/ui.js`
  - 移除語言切換時對新增地點分類 dropdown 的更新。
- `src/forms.js`
  - 刪除新增地點與建議修改流程，只保留問題回報與資料載入。
- `src/submit.js`
  - 保留問題回報共用送出能力。
  - 移除「待審核建議」localStorage 與 banner 行為。
- `src/i18n.js`
  - 移除新增、編輯、公開狀態、狀態圖例及待審核提示文案。
  - 將問題回報成功訊息改為中性、精確的回報確認文案。
- `styles.css`
  - 刪除新增按鈕、協作按鈕、狀態 badge、狀態 radio、待審核 banner 與狀態 marker 樣式。
  - 調整卡片 footer、篩選列及地圖 provider badge 的簡化後版面。
- `README.md`、`TODO.md`
  - 將產品說明更新為 view-first，移除已下架功能與 Netlify form 說明。
- `note/LOCAL_TESTING.md`、`docs/notion-migration-progress.md`
  - 更新目前 CSV schema、Notion properties 與六種 status 的實際狀態。
- `tests/*.test.mjs`
  - 新增檢視優先 UI 契約測試。
  - 將通用 Netlify submit 測試從 add-location 專用測試移至獨立 `tests/submit.test.mjs`。
  - 更新仍受支援功能的 fixture。
  - 移除專門測試新增地點與建議修改的過時測試。
  - 在 locations function 測試鎖定 Notion API response 不含 `Duplicate Group`。

---

## Task 1：先用測試鎖定公開介面與發布契約

**Files:**

- Create: `tests/view-first-ui.test.mjs`
- Create: `tests/submit.test.mjs`
- Modify: `tests/public-notfound.test.mjs`
- Modify: `tests/i18n-ui.test.mjs`
- Modify: `tests/favorites.test.mjs`
- Modify: `tests/parsecsv.test.mjs`
- Modify: `tests/issue-report.test.mjs`

- [ ] 在 `tests/view-first-ui.test.mjs` 加入 HTML 契約測試，確認不再包含：
  - `add-btn`
  - `add-modal`
  - `edit-modal`
  - `status-filter`
  - `pending-banner`
  - `suggest-edit` 與 `add-location` Netlify forms
  - `leg_verified` 與 `leg_review`
- [ ] 同一檔案加入 render 輸出測試，確認 `renderList()` 與 `buildPopupContent()` 不輸出：
  - 審核狀態文案或狀態 class
  - `card-edit-btn`
  - `openEditModal`
  - duplicate group badge
- [ ] 加入 marker 契約測試：`makeMarkerContent(icon)` 只產生共用 `marker-dot` class，不包含任何 status class。
- [ ] 確認問題回報按鈕、modal 與 `issue-report` Netlify form 仍存在，且 detection form 欄位和 payload 一致。
- [ ] 更新 `public-notfound` 測試為完整發布矩陣：
  - 公開：`Verified`、`Needs Review`
  - 不公開：`Draft`、`Verifying`、`Could Not Find`、`Closed`
  - 列表、結果數量與 map marker 必須套用相同規則
- [ ] 在 `parsecsv` 測試中先鎖定六種 status 原值都能 round-trip，不再把 `Draft`、`Verifying`、`Closed` 正規化為 `Needs Review`。
- [ ] 在 `parsecsv` 測試中鎖定 fail-closed 行為：
  - 空白或未知值 → `Draft`
  - `Not Found` → `Could Not Find`
  - `Not Verified` → `Needs Review`
- [ ] 更新 i18n 與 favorites fixture，不再提供 `status-filter` DOM 或 `dup` row property。
- [ ] 建立 `tests/submit.test.mjs`，從即將刪除的 add-location 測試移入並調整通用 submit 契約：
  - Netlify mock 只限 localhost、127.0.0.1、`[::1]`
  - 本機 mock 呼叫成功 callback，但不再寫入 pending 狀態
  - 正式 POST 成功時呼叫 success callback
  - POST 失敗時顯示錯誤並恢復按鈕
- [ ] 強化 `issue-report` 測試，確認成功 callback 使用專用回報成功文案。
- [ ] 執行完整的目標 RED 測試：

```sh
node --test \
  tests/view-first-ui.test.mjs \
  tests/public-notfound.test.mjs \
  tests/i18n-ui.test.mjs \
  tests/favorites.test.mjs \
  tests/parsecsv.test.mjs \
  tests/issue-report.test.mjs \
  tests/submit.test.mjs
```

預期：新契約測試在實作前失敗；既有且未改變的功能測試仍通過。

---

## Task 2：以單一原子變更完成前台切換

此任務內的 JavaScript、HTML、CSS 與 i18n 必須一起完成並一起驗證，不拆成會讓 boot sequence 指向已刪除 DOM 的中間提交。

**Files:**

- Modify: `index.html`
- Modify: `src/render.js`
- Modify: `src/map.js`
- Modify: `src/main.js`
- Modify: `src/ui.js`
- Modify: `src/forms.js`
- Modify: `src/submit.js`
- Modify: `src/i18n.js`
- Modify: `src/csv-parser.js`
- Modify: `styles.css`
- Modify: `tests/submit.test.mjs`
- Modify: `tests/issue-report.test.mjs`
- Delete: `tests/add-location-form.test.mjs`
- Delete: `tests/edit-submit.test.mjs`

### 2.1 先解除 JavaScript 對即將刪除 DOM 的依賴

- [ ] 從 `main.js` 移除：
  - add/edit form imports
  - `window.openEditModal`
  - add/edit event listeners
  - `buildStatusFilter()`、`buildCatDropdown()` imports 與 boot calls
  - `showPendingBanner()` import 與 boot call
- [ ] 從 `ui.js` 移除 `buildCatDropdown()` import，以及語言切換時的呼叫。
- [ ] 從 `render.js` 移除：
  - status badge 與 duplicate group badge
  - `needsHelp`、建議修改／幫助驗證按鈕
  - status filter DOM 讀取與 `stHit`
  - `buildStatusFilter()`、`buildCatDropdown()`、`getBadgeClass()`
  - `tobj`、`CATEGORIES` imports
- [ ] 將 `isPublicLocation()` 改為明確 allowlist，只允許 `Verified`、`Needs Review`。
- [ ] 將 `LocationStatus` 擴充為六種 Notion status；`normalizeStatus()` 對六種精確值原樣保留，只正規化舊資料的大小寫與 `Not Found` 別名。
- [ ] 將明確 legacy alias `Not Verified` 正規化為 `Needs Review`；無法識別或空白的 status 一律轉成非公開 `Draft`，不得 fail-open。
- [ ] 從 `map.js` 移除 status-to-class import；將 `makeMarkerContent(status, icon)` 改為 `makeMarkerContent(icon)`，所有 marker 使用一致品牌色。
- [ ] 從 `forms.js` 移除 edit/add modal、驗證與 payload builder；只保留問題回報與 `tryLoadSheet()`。
- [ ] 從 `submit.js` 移除 `recordPending()`、`showPendingBanner()` 與 `has_pending` localStorage；保留 issue report 所需的 Netlify submit 與 feedback reset。

### 2.2 再精簡 HTML

- [ ] 刪除 `suggest-edit` 與 `add-location` Netlify detection forms。
- [ ] 刪除新增地點按鈕、pending banner、status filter、status legend rows、edit modal 與 add modal。
- [ ] 保留 issue report detection form、modal、桌面次要按鈕與手機更多選單入口。
- [ ] 地圖圖例只保留 provider 識別。

### 2.3 清理 i18n 與 CSS

- [ ] 從 `i18n.js` 移除：
  - add/edit/status filter/status badge/status legend/pending banner keys
  - 已無使用者的 `CATEGORIES`
  - 已無使用者的 `tobj()`，並簡化 `t()` 的回傳型別
- [ ] 新增專用的問題回報成功文案；不得再提「審核後更新地圖」。
- [ ] 移除 add/edit modal、status badge、status marker、status radio、pending banner 與 duplicate badge selectors。
- [ ] 保留仍被約略座標、必填提示、成功／錯誤 feedback 使用的共用色彩 token；只刪除確認為 orphan 的 token。
- [ ] 調整卡片 footer、分類篩選與只剩 provider 的 map badge 間距。

### 2.4 驗證原子切換

- [ ] 刪除 add/edit 專用測試；通用 Netlify transport 測試必須已移至 `tests/submit.test.mjs`，不得隨 add-location 測試一起遺失。
- [ ] 強化 `issue-report` 測試，確認它是唯一保留的 Netlify form 流程，且成功／失敗行為皆由通用 submit 測試覆蓋。
- [ ] 執行 Task 1 的全部目標測試並確認 GREEN。
- [ ] 執行孤兒引用搜尋：

```sh
rg -n \
  "add-modal|add-btn|openAddModal|submitAdd|edit-modal|openEditModal|submitEdit|status-filter|buildStatusFilter|buildCatDropdown|pending-banner|has_pending|card-edit-btn|b-dup" \
  index.html src styles.css tests
```

預期：執行期檔案沒有結果；否定契約字串只允許存在 `view-first-ui` 測試。

- [ ] Task 2 結束前執行完整門檻，不允許保留任何 RED 測試：

```sh
npm run typecheck
npm test
npm run build
```

- [ ] 啟動本機網站並以實際瀏覽器完成 boot smoke test：
  - 首次載入沒有 console error 或未捕捉例外
  - 地點列表與地圖完成載入
  - 切換中英文後列表、彈窗與 header 正常更新
  - 切換深淺色正常
  - 手機版更多選單可以開關
  - 問題回報可以開啟、驗證必填欄位並完成本機 mock 送出

---

## Task 3：移除 Duplicate Group 並遷移 snapshot schema

**Files:**

- Modify: `src/csv-parser.js`
- Modify: `scripts/export-snapshot.mjs`
- Modify: `data/locations.csv`
- Modify: `tests/fixtures/notion-poc/source-10rows.csv`
- Modify: `tests/fixtures/notion-poc/exported-10rows.csv`
- Modify: `tests/parsecsv.test.mjs`
- Modify: `tests/notion-export-poc.test.mjs`
- Modify: `tests/notion-export-full.test.mjs`
- Modify: `tests/locations-function.test.mjs`

### 3.1 先建立 schema RED

- [ ] 在 `tests/parsecsv.test.mjs` 新增契約：沒有 `Duplicate Group` header 的 published CSV 可以解析，且 row object 不含 `dup`。
- [ ] 在 `tests/notion-export-poc.test.mjs` 鎖定 `CSV_HEADER` 與 `pageToRow()` 均不輸出 `Duplicate Group`。
- [ ] 在 `tests/notion-export-full.test.mjs` 鎖定新 snapshot header，並從 golden comparison 移除 `dup`。
- [ ] 在 `tests/locations-function.test.mjs` 鎖定 `DATA_SOURCE=notion` 的 `/api/locations` response header 不含 `Duplicate Group`，且仍可解析為 98 筆。
- [ ] 執行並確認只因尚未移除 schema 而 RED：

```sh
node --test \
  tests/parsecsv.test.mjs \
  tests/notion-export-poc.test.mjs \
  tests/notion-export-full.test.mjs \
  tests/locations-function.test.mjs
```

### 3.2 實作並遷移資料

- [ ] 從 `LocationRow` JSDoc contract、published CSV required headers 與 parsed row object 移除 `dup`。
- [ ] 從 Notion snapshot exporter 的 `CSV_HEADER` 與 `pageToRow()` 移除永遠為空的 `Duplicate Group` 欄；不修改 Notion 的 `Branch Group`。
- [ ] exporter 繼續原樣輸出 Notion `Status`，不在 snapshot 層改寫工作流狀態。
- [ ] 使用 `tokenizeCSV()` 讀取既有 snapshot／fixture，依 header index 精確刪除 `Duplicate Group` 欄，再使用 `csvRow()` 重新序列化；不可使用會遺失原始欄位或重新正規化內容的 application row object。
- [ ] 在覆寫前後以 slug 對齊並比較每筆資料，除被刪欄位外，名稱、Notes、來源、status、座標、icon、approx 與 slug 必須完全一致。
- [ ] 更新 parser、Notion export、full snapshot 與 UI fixtures 的預期資料結構。
- [ ] 驗證 snapshot 仍為 98 筆、98 個唯一 slug，status 分布仍為 81 `Verified`、16 `Needs Review`、1 `Could Not Find`，40 筆 approximate coordinates。
- [ ] 執行：

```sh
node --test \
  tests/parsecsv.test.mjs \
  tests/notion-export-poc.test.mjs \
  tests/notion-export-full.test.mjs \
  tests/snapshot-validator.test.mjs \
  tests/locations-function.test.mjs
```

- [ ] Task 3 結束前再次執行完整門檻，所有測試必須 GREEN：

```sh
npm run typecheck
npm test
npm run build
```

---

## Task 4：更新現行文件並完成整體驗收

**Files:**

- Modify: `README.md`
- Modify: `TODO.md`
- Modify: `note/LOCAL_TESTING.md`
- Modify: `docs/notion-migration-progress.md`

- [ ] README 改為描述搜尋、分類、收藏、定位與導航，不再宣稱提供 add/edit community contributions。
- [ ] Netlify Forms 文件只保留 `issue-report`；架構圖與模組說明改為 forms 僅負責 issue report。
- [ ] README 與 `note/LOCAL_TESTING.md` 的 CSV schema 移除 `Duplicate Group`。
- [ ] 更新 `docs/notion-migration-progress.md` 的現況：
  - 實際 schema 沒有 `Duplicate Of`
  - 保留 `Branch Group`
  - Status options 為六種
  - 正式發布資料來源為 committed Notion snapshot
- [ ] 遷移設計與已完成計畫等歷史文件保留當時決策，不回寫歷史。
- [ ] TODO 將新增／修改表單項目移除或標記為已下架，避免未來誤認為待修功能。
- [ ] 執行完整自動驗證：

```sh
npm run typecheck
npm test
npm run build
```

- [ ] 在本機實際檢查：
  - 桌面寬度約 1440px
  - 平板寬度約 768px
  - 手機寬度約 390px
  - 中英文
  - 淺色／深色
- [ ] 手動驗收搜尋、分類、收藏篩選、卡片開啟地圖、導航、Google Maps、定位及問題回報。
- [ ] 使用六種 status fixture 驗收：公開狀態在列表與地圖正常顯示，四種內部狀態完全不公開，且 UI 沒有狀態視覺差異。
- [ ] 在 Deploy Preview／production 驗證：
  - Netlify 環境使用 `DATA_SOURCE=notion`
  - `/api/locations` 回傳 committed snapshot
  - response header 不含 `Duplicate Group`
  - response 可解析為 98 筆且收藏 ID 相容性驗證通過

---

## Definition of Done

- 一般使用者無法在 UI 中新增地點或提出地點修改／驗證。
- 卡片、彈窗、篩選器、marker 與圖例皆不洩漏審核狀態。
- 公開 snapshot、parser contract 與執行期 row object 均不再包含 `Duplicate Group`／`dup`。
- 正式環境使用 `DATA_SOURCE=notion`，`/api/locations` 的發布 schema 不含 `Duplicate Group`。
- Notion 的 `Branch Group` 保留，且不被誤當成重複資料欄位。
- 問題回報仍可正常送至 Netlify Forms，且成功文案符合回報情境。
- 通用 Netlify submit 的本機 mock、正式成功與失敗恢復行為皆有獨立測試，不依賴已移除的 add-location 測試。
- CSV／Notion/API 保留六種 status 原值，既有資料驗證與匯出測試正常。
- 只有 `Verified`、`Needs Review` 出現在列表與地圖；`Draft`、`Verifying`、`Could Not Find`、`Closed` 完全不公開。
- 空白或未知 status 會 fail-closed 為 `Draft`，不會因 fallback 成為公開地點。
- HTML 移除相關 DOM 後，boot sequence 與語言切換均不再引用 add/edit/status controls。
- 搜尋、分類、收藏、定位、導航、語言、主題與兩種地圖 provider 沒有退化。
- typecheck、全部測試與 production build 通過。
