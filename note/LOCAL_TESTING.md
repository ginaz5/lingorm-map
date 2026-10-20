# Local Testing Before Netlify Deploy

本專案使用 Netlify 免費方案時，建議先在本機完整測試，確認沒問題後才 push 到 GitHub 觸發 Netlify deploy，以節省 deploy credits。

Location 資料以已驗證的 CSV 快照隨程式版本部署：由 Notion 匯出 → 驗證 → 更新
`data/locations.csv` → 提交部署；回滾即 `git revert` 該筆 `data/locations.csv` 變更。
指令見 `CLAUDE.md` 的 Location data workflow。

## 目標

- 本機驗證 HTML、Netlify Function、目前選定的 location data source 都正常
- 確認後才 push feature branch、建立 PR，並驗證 Netlify Deploy Preview
- 避免每次小修改都觸發 Netlify deploy

## 前置設定

確認已安裝 Netlify CLI：

```bash
netlify --version
```

如果尚未安裝：

```bash
npm install -g netlify-cli
```

第一次使用需登入並連結站台：

```bash
netlify login
netlify status
```

如果尚未 link：

```bash
netlify link
```

## 本機環境變數

在專案根目錄建立 `.env`，內容可參考 `.env.example`：

```bash
GOOGLE_MAPS_KEY=your_google_maps_key
GOOGLE_MAP_ID=your_google_map_id
HERE_API_KEY=your_here_api_key
DATA_SOURCE=notion
```

注意：

- `.env` 已在 `.gitignore` 中，不要 commit。
- `DATA_SOURCE=notion` 會讀取已提交並驗證的 `data/locations.csv`，是唯一支援的值，也是未設定時的預設值。舊版 `DATA_SOURCE=sheet` 回滾路徑已於 2026-07-21 三狀態 cutover 後停用（`build.sh` 會直接拒絕），不要使用。
- 不要直接用瀏覽器打開 `index.html` 測試，因為那樣測不到 `/api/locations` Netlify Function。

## 每次修改後的本機測試流程

1. 跑靜態型別檢查：

```bash
npm run typecheck
```

預期 TypeScript 以 strict、no-emit `checkJs` 模式完成且沒有錯誤。專案 runtime 仍是 JavaScript，這一步不會產生編譯檔。

2. 跑自動測試：

```bash
node --test tests/*.test.mjs
```

預期結果：

```text
pass 106
fail 0
```

實際測試數量可能會隨新增測試而增加，重點是 `fail 0`。

3. 啟動 Netlify 本機環境：

```bash
netlify dev
```

通常會開在：

```text
http://localhost:8888
```

4. 測試 API：

先確認 Google Maps runtime config：

```text
http://localhost:8888/api/config
```

這個 endpoint 是由 Netlify Function 執行，但回應會提供給前端地圖 SDK，因此在瀏覽器 Network 面板看見 `googleMapsKey`／`hereApiKey` 是預期行為。Browser SDK key 必須設定網站與 API restriction；`NOTION_API_KEY`、`GOOGLE_PLACE_KEY` 等 server-only credential 則絕對不應出現在此回應。

預期：

```json
{"hereApiKey":"...","googleMapsKey":"...","googleMapId":"..."}
```

再確認 location CSV endpoint：

```text
http://localhost:8888/api/locations
```

預期：

- 看到 CSV 內容
- 第一行是所選來源的 app schema。`DATA_SOURCE=notion` 時應為：

```text
"Location Name","Location Name ZH","Thai / Alt Name","Google Maps URL","Category","Notes","Notes ZH","Source URL","Source Tags","Verification Status","Lat","Lng","Icon","Country Code","Destination Key","Type","Slug"
```

如果回傳錯誤 JSON，先執行 `node scripts/validate-location-snapshot.mjs data/locations.csv`。

如果地圖顯示「這個網頁並未正確載入 Google 地圖」，請到 Google Cloud Console 的 Maps API key restriction 加入本機 referrer：

```text
http://localhost:8888/*
```

若你使用不同 port，也要加入對應 port，例如：

```text
http://localhost:8889/*
```

5. 測試網站首頁：

```text
http://localhost:8888
```

檢查：

- 地圖正常載入
- 卡片名稱、類別、說明正常顯示，且不顯示審核狀態
- 沒有空白卡片
- marker popup 不再顯示「在 Google Maps 開啟 / Open in Google Maps」
- 語言切換正常
- 篩選順序為「類別／標籤／目的地」；預設選項為「所有標籤／All label」，中文標籤顯示 LingOrm、JKR 推薦、JKR 應援、留友看，英文維持正式 Type 值
- 標籤旁的資訊按鈕可透過桌機 hover／focus 或點擊開啟分類說明，並能以點擊外部、再次點擊或 Escape 關閉；手機點擊可正常操作
- 標籤可與搜尋、類別、目的地及收藏條件正確交集篩選
- Google Maps 與 HERE Maps popup 都同時顯示類別與 Type badge
- 手機版以 `Bar / Rooftop Club`、`JKR Fan Projects`、`酒吧/天台俱樂部` 等最長篩選文字檢查，320px 與一般手機寬度都不裁切或水平溢出
- 手機版定位按鈕固定顯示於 header，且不再出現在「更多操作」選單
- 「更多操作」選單在 320px、390px 與 768px 寬度下，中英文文字完整顯示，選單不超出螢幕；放大文字時允許換行且圖示不被擠壓。可開啟本機 [版面回歸測試頁](../tests/fixtures/mobile-actions-width.html)（英文；網址加上 `?lang=zh` 測中文），以實際選單 markup、翻譯和樣式驗證 52px 放大文字，預期顯示 `PASS`。這是瀏覽器測試，`npm test` 不會執行。
- 目的地可跨國複選，國家 checkbox 能全選／取消子目的地，部分選取時顯示 indeterminate
- 目的地變更立即套用，重新整理後保留，且地圖自動縮放至全部篩選結果
- 手機版 map/list tab 正常
- 手機版 320px／390px：點地圖標記或列表卡片後，資訊卡片本體在地圖可視範圍置中；測試長短內容、連續選取及關閉後重開。Google Maps 與 HERE 都要確認；點標記維持原縮放，桌機維持原有行為。回歸測試：`node --test tests/mobile-popup.test.mjs`。
- 問題回報可開啟、驗證必填欄位並完成本機 mock 送出
- 列表與地圖只顯示 `Published`

## 確認後才部署

確認本機測試都通過後，再 commit：

```bash
npm run typecheck
node --test tests/*.test.mjs
npm run build
git status --short
git add <changed-files>
git commit -m "your commit message"
```

最後才 push feature branch：

```bash
git push -u origin <feature-branch>
```

接著建立 PR：

1. 等待 Netlify Deploy Preview 完成。
2. 在 preview URL 重跑 API、地圖、篩選與 favorites 檢查。
3. 確認 preview 正常後才 merge PR；merge 到 `main` 才會觸發 production deploy。

## 省 Netlify credits 的原則

- 可以多次 local edit、local test、local commit。
- 不要直接 push 到 `main`；使用 feature branch + PR Deploy Preview。
- 等本機確認後再 push feature branch。
- PR preview 驗證完成後才 merge；production branch 的更新會觸發 production deploy。

## 換匯功能上線與維運手冊

換匯（SuperRich）功能的資料模型與階段設計以
[實作計畫](../docs/superrich-exchange-map-plan.zh-TW.md) 為準、進度與已
完成的驗證見 [進度紀錄](../docs/superrich-exchange-map-progress.zh-TW.md)；
本節只記錄「正式環境要怎麼操作」，避免每次上線或排查問題都要重讀整份計畫。

### 報價更新時段

- 採泰國時間（`Asia/Bangkok`，UTC+7）：08:00 開始，每 30 分鐘一輪，最後一輪 22:30。
- Netlify 使用 UTC cron `0,30 1-15 * * *`，每天 30 輪；23:00～隔天 08:00 排程不抓取來源。
- 時段只由 cron 控制。Run now 或本機 `netlify functions:invoke` 任何時間都會真的抓取來源（一輪約 27 個請求）並寫入快照，仍受控制旗標與 breaker 冷卻限制；失敗也會計入 breaker。
- 夜間手動抓到的快照同樣在下一個半小時邊界加 35 分鐘到期（例：23:10 抓取 → 下一輪 23:30 → 隔天 00:05 到期），之後回到「暫無報價」。
- 沒有手動觸發時，22:30 的快照在 23:35 到期；夜間顯示「暫無報價」，最佳匯率排序停用，分店與連結仍可使用。
- 前端每 60 秒向本站 API 確認狀態，這些請求不會抓取 SuperRich；08:00 新快照完成後恢復報價。

### 上線前的驗證清單

除了本文件前面「每次修改後的本機測試流程」之外，換匯功能多這幾項：

```bash
node --test tests/exchange-rates-*.test.mjs tests/i18n-ui.test.mjs tests/styles-extraction.test.mjs tests/view-first-ui.test.mjs
node scripts/validate-superrich-mapping.mjs data/superrich-branches.json data/locations.csv
npm run fx:control -- status
```

`fx:control -- status` 在本機／未設定 Netlify 憑證時會失敗是正常的——這
支指令設計上只連正式或已 `netlify link` 的站台儲存；本機驗證的重點是
`node --test` 全過與 mapping 腳本無誤。

到期行為另以有有效報價的頁面驗證：切成離線、讓 API 請求跨過到期時間，
以及切到背景後等到過期再切回。三種情況都應撤下數字與「最佳」標示、
回一般排序；恢復連線且取得新快照後可以再次顯示報價。
`tests/exchange-rates-ui.test.mjs` 以模擬時鐘涵蓋這些情境。

換匯點的顯示以綠標 mapping 為準：`Type = Currency Exchange` 但 Slug 不在
`data/superrich-branches.json` 的地點，即使是 `Published`，也不會出現在清單、搜尋、
收藏、類別／標籤計數、目的地選項或地圖上（`isSupportedLocation()`）；綠標與一般地點
不受影響。

### 排程首次啟用（正式環境）

Deploy Preview 與 branch deploy **不會自動排程**，只能手動觸發；即使
`main` 已 merge，正式環境的 Netlify Scheduled Function 要等下一個排定
時間才會第一次自動執行。因此第一次上線要依序做：

1. 先確認正式環境目前的控制狀態：

   ```bash
   npm run fx:control -- status
   ```

   `control` 為 `null` 代表尚未建立過控制物件，會回退到 `EXCHANGE_RATES_ENABLED`。
   **這個回退值決定要不要做第 2 步**：設為 `false`（或未設定）時服務保持
   disabled，必須人工啟用；設為 `true` 時第一次排程執行會自己以
   `ensureFetchControl()` 建立 enabled 的控制物件並開始發布快照，第 2 步變成
   非必要，第 1 步看到 `enabled: true` 也屬正常。

2. 若回退值是 `false`（或想明確建立一個有版本的控制物件），建立／更新正式的控制旗標：

   ```bash
   npm run fx:control -- enable
   ```

3. **人工觸發第一輪抓取**（不要空等排程；任何時段都能觸發，但夜間快照約 30 分鐘後到期），用 Netlify UI 的「Run now」或：

   ```bash
   netlify functions:invoke exchange-rates-fetch
   ```

4. 確認 API 與前台數字：

   ```text
   https://lingorm-map.netlify.app/api/exchange-rates
   ```

   預期 `enabled: true`、`snapshot` 非 `null`；前台以「換匯」標籤篩選後，26 個
   分店都能看到三列報價（或明確的「暫無報價」，不是空白或錯誤畫面）。

5. **再驗證更新時段內接下來兩個排定批次**（每 30 分鐘一次；即等 30～60 分鐘後重
   查一次 API 的 `checkedAt`／`snapshot.completedAt` 有沒有前進），確認
   排程本身、不只是手動觸發那一次，是正常運作的。

只改 `EXCHANGE_RATES_ENABLED` 這個環境變數**不會**讓上面任何一步提前生
效——見下一節。

### 執行期停用 vs. 環境變數：差異與怎麼操作

這是兩層不同的開關，日常操作幾乎都只會用到第一種：

| | 執行期控制旗標 | `EXCHANGE_RATES_ENABLED` 環境變數 |
| --- | --- | --- |
| 怎麼改 | `npm run fx:control -- enable` / `disable --reason <code>` | Netlify 網站設定裡改環境變數 |
| 何時生效 | **立即**（下一次 API 讀取／排程檢查就看到） | **只在下一次部署之後**才生效 |
| 用途 | 日常開關、來源出事故時緊急停用 | 這個站台從一開始要不要有這個功能（沒有控制旗標時的預設回退值） |
| 停用後前台行為 | `enabled:false`；卡片、綠色標記與標籤選項都還在，只是三列報價變成「暫無報價」，篩選與收藏不受影響 | 同左 |

**常見誤區：** 改了 Netlify 環境變數的 `EXCHANGE_RATES_ENABLED` 之後，
以為存檔就生效——實際上要另外觸發一次部署（哪怕程式碼沒改）才會被讀
到新值。日常「先關掉」請一律用 `npm run fx:control -- disable --reason
<code>`，不要改環境變數。

### Circuit breaker 復原

來源回應 403／429 會被視為「來源在限流／封鎖」，立即封鎖並依
6h → 24h → 自動停用逐步升級；連續 3 輪全失敗（非 403／429）則退避 1
小時。**`npm run fx:control -- enable` 只會清除連續失敗計數，不會清除
尚未到期的封鎖期限**（含 `Retry-After`）——這是刻意的：如果來源還在限
流，手動重新啟用又立刻重抓只會再觸發一次封鎖。

排查步驟：

1. `npm run fx:control -- status`，看 `breaker.blockedUntil` 是否還沒
   到。
2. 沒過期：等到期，或找到來源限流的根本原因後再等；不要反覆
   enable/disable 試探。
3. 已過期：下一輪排程（泰國時間 08:00～22:30，每 30 分鐘）會自動恢復抓取，也可以隨時用
   `netlify functions:invoke exchange-rates-fetch` 人工觸發一次確認。
4. 恢復後應該看到 `breaker` 的失敗計數歸零、`snapshot` 更新到最新
   `completedAt`。

### 資料來源故障時，預期會發生什麼（降級檢查清單）

來源故障（逾時、格式錯誤、HTTP 錯誤、封鎖中）時，前台**不應該**看到
任何額外的錯誤畫面、彈窗或空白區塊；逐項確認：

- 「換匯」標籤選項、26 個分店卡片、地圖上的綠色標記／綠色群聚：都還在。
- 三列報價：顯示「暫無報價」（`fx_unavailable`），不是 0、空白或
  crash。
- 免責文字、官網連結、Google Maps 營業時間連結：正常顯示，不受影響。
- 類別／標籤、搜尋、目的地、收藏依交集篩選換匯點；換匯點的類別為空，
  可透過「換匯」標籤選取。
- 最佳匯率排序：沒有可用報價時隱藏排序控制，三個排序選項變成 disabled，
  並自動退回一般排序；有部分報價時，只停用缺少報價的幣別選項。
- 訪客端每 60 秒仍會照常向 `/api/exchange-rates` 確認一次；沒有因為故
  障就停止確認或需要重新整理頁面才能恢復。

若上面任何一項不成立，先查 `npm run fx:control -- status` 的
`control`／`breaker`／`snapshot` 三個物件，再對照
[實作計畫](../docs/superrich-exchange-map-plan.zh-TW.md) §4－§5 的契約
定義；這是故障排查的第一步，不是重新部署。

---

## 常見問題

### API 沒有回傳預期的 location 資料

可能原因：

- `/api/locations` 無法取得 CSV
- CSV headers 不符合 app schema
- `DATA_SOURCE` 沒有被 `netlify dev` 載入，或誤設為已停用的 `sheet`
- `data/locations.csv` 遺失或驗證失敗

先打開：

```text
http://localhost:8888/api/locations
```

確認 API 回傳內容。

### 地圖顯示 Google Maps 載入錯誤

可能原因：

- `/api/config` 沒有回傳 `googleMapsKey` / `googleMapId`
- `.env` 沒有設定 `GOOGLE_MAPS_KEY` 或 `GOOGLE_MAP_ID`
- Google Cloud Console 的 API key HTTP referrer restriction 沒有允許 `http://localhost:8888/*`

先打開：

```text
http://localhost:8888/api/config
```

如果 config 正常，再檢查 Google Cloud Console 的 key restriction。

### 直接開 index.html 看起來正常，可以算通過嗎？

不算。直接開檔案只能測靜態 HTML 和內建資料，不能測 Netlify Function、環境變數、`/api/locations`。


## 橘標整合與維運

2026-10-17：全部 38 家橘標已在 Notion 改為 Published 並經 exporter 更新 CSV。
分店發布不代表匯率服務已啟用。2026-10-20：本分支退役 Netlify 的橘標來源
抓取，保留只讀 API；尚未部署。GitHub Actions runner、逐店發布與排程仍未實作。
完整契約見 [Netlify 只讀快取與外部抓取](../docs/superrich1965-on-demand-plan.zh-TW.md)。

- 頁面每 60 秒 GET `/api/exchange-rates-1965-cache`，只讀有效逐店報價。
  缺少報價的卡片顯示「重新整理匯率／Refresh rates」，POST 到
  `/api/exchange-rates-1965-branch` 也只讀快取，不會再向來源取價。
- 保留 `/api/exchange-rates-1965` 完整 snapshot API 與既有本機 CLI 契約。
  單店 API 可讀有效 snapshot fallback，但不播種逐店快取或延長到期時間。
- 報價到期為下一個整點／半點加 35 分鐘，實際約 35～65 分鐘。
  來源抓取器可用前，現有報價到期後不會因重新整理而產生新報價。
- 刪除 `exchange-rates-1965-fetch`、`exchange-rates-1965-refresh` 兩個 Function、
  Netlify dispatch、Chromium helper／套件／打包設定。
- `EXCHANGE_RATES_1965_FETCH_MODE`、`EXCHANGE_RATES_1965_SOURCE_TRANSPORT`
  已無程式讀取，也已從 Netlify 專案所有 context 移除，需重新部署才會套用。
  `EXCHANGE_RATES_1965_ENABLED` 保留，
  預設 false，既有 runtime control 優先；只讀端點不初始化 control。
- 保留控制、cache、lease、breaker、gate 與 job 資料，不清除已知冷卻。
  `NETLIFY_SITE_ID`、`NETLIFY_AUTH_TOKEN` 仍供控制工具／既有 CLI 使用。
- 列表與 Google／HERE popup 共用報價、排序及到期狀態；綠標維持原流程。

### 只讀 API 本機驗收

使用 `netlify dev`，先確認本機控制及 store；不要為了測試改正式 control。
例如 localhost:8888 的同源請求：

```bash
curl -sS http://localhost:8888/api/exchange-rates-1965-cache
curl -sS -X POST http://localhost:8888/api/exchange-rates-1965-branch \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:8888' \
  --data '{"slug":"superrich1965-58"}'
```

單店有有效報價時回 200；無有效報價回 `503 unavailable`、Retry-After 60 秒。
停用時為 `503 disabled`；沒有有效 control 時不會自行建立。報價必須符合
slug、controlVersion、enabledAt 與原有效期；不會建立 lease、讀 breaker、
寫 Blobs 或發出來源請求。前端兩種讀取 timeout 均為 12 秒。
本機已有報價只能證明快取可讀，不能當作 GitHub runner 來源驗收。

程式驗證使用 mock，不打真實來源、不寫正式資料：

```bash
npm run typecheck
npm test
npm run build
netlify functions:build --src netlify/functions --functions /private/tmp/lingorm-functions-build
```

新只讀測試覆蓋零來源、零寫入、缺 control、控制切換、到期、snapshot fallback；
退役測試確認公開 API 不載入 collector，且兩個來源入口不存在。
這次沒有改位置資料；若另有 snapshot 變更，再跑位置／收藏／mapping validators。

### 橘標來源失敗診斷

以下用來解讀**退役前部署**及保留的 collector 診斷。新版 Netlify 公開 API
不抓來源，不會再產生來源查詢 log。舊部署仍須以確切 commit／deploy ID 辨識。

歷史 `exchange_rates_1965_branch` 紀錄中的 `httpStatus` 是本站狀態，
`blockedStatus` 與 `diagnostics[].status` 才是來源 HTTP 狀態：

- `sourceRequestCount=1`、`sourceOutcome=blocked`、`cooldownSource=source_blocked`
  表示來源請求被拒絕；`cfMitigated=challenge` 可辨識 challenge。
- `sourceRequestCount=0`、`cooldownSource=breaker|gate` 表示被既有冷卻擋下，
  沒有新來源請求。快取命中同樣為零來源，但回 200。
- `retryAt` 是本站允許再試的 UTC 時間，不保證來源已解封。
  背景紀錄的 `stoppedSlug` 是停止分店，`loaded` 是成功店數。

2026-10-19 Preview 的匿名 token GET 回 403 challenge，未發出匯率 POST，
本站回 429 是保護機制。不要以新部署、store 或 runner 規避未結束的冷卻。
詳見 [匿名 API 調查紀錄](../docs/superrich1965-anonymous-api-investigation.zh-TW.md)。
診斷不得記錄 token、Cookie、完整來源回應或任意例外文字。

### 匿名 API 模式本機驗收

原先以 `SOURCE_TRANSPORT=anonymous-api` 啟動 Netlify 單店取價的步驟已退役，
不再使用舊環境開關。已完成的本機驗證是歷史證據：A04／36 token GET／rate
POST 都 200，USD `100-50` 與 TWD `1000-100` 指定面額解析成功；不能據此
宣稱 Netlify 或 GitHub runner 可用。

匿名模組與其 mock／整合測試保留，供後續外部 runner 使用。token 只留在
程序記憶體；同輪可重用具明確到期提示的 token。任何階段遇 403／429／challenge
仍遵守共享 breaker；不 fallback、不自動重試。新的真實來源驗收須依 Actions
計畫完成受控入口，不能呼叫已刪除的 Netlify Function。

### GitHub Actions 後續驗收（尚未實作）

依 [Actions 計畫](../docs/superrich1965-github-actions-plan.zh-TW.md) 先完成
runner、明確 Preview target、probe 不發布路徑與 mock 測試，再安排手動單店。
Netlify 的只讀部分已實作；workflow、Secrets、逐店發布與排程尚未啟用。
2026-10-20 的[實作前調查](../docs/superrich1965-actions-research-2026-10-20.zh-TW.md)
確認新 Preview store 不共享來源冷卻，計畫需先補固定 site-wide source guard、
明確 Preview control 管理與不發布 probe。這些保護及管理命令目前都尚未實作。
workflow 必須先存在預設分支，才能使用 Run workflow；初版不啟用排程。
既有 CLI 尚未接匿名 transport，只寫 full snapshot，不能直接當逐店發布工具。

首次來源測試仍須先查核舊部署／本機工作已停止、保留既有冷卻並完成 guard bootstrap；
讀取 target control／breaker 與共同 source guard，取得來源 lease 後只測 A04／36。只有 token／rate 都 200 且指定 USD／TWD 完整，
才算 runner 來源成功；cache hit 不能代替來源驗證。
probe 不發布 quote，必要的 lease／失敗冷卻仍須持久化。

單店通過後才驗指定 Preview 的逐店 cache、三個公開 API、列表與兩種 map
provider，再驗小批次／38 家與排程。本次沒有設定 Secrets 或執行 workflow。

### Netlify 瀏覽器模式驗收

瀏覽器模式與專用套件已退役，不再設定 browser transport、封裝 Chromium 或
人工觸發 fetch／refresh。歷史驗證已確認瀏覽器啟動成功，但官網 navigation
仍回 403 challenge；不再調整 Chromium 來延長這條路徑。

### 橘標 UI 本機驗收

開啟 `/tests/fixtures/orange-branch-query.html`。第一店顯示模擬快取、沒有按鈕；
第二店顯示「重新整理匯率」，點擊只有一次 POST，成功後撤下按鈕。
列表與 popup 共用結果。`lang=en` 測英文、`delay=1500` 測載入及重複點擊；
`fail=1` 模擬舊 429 的前端相容處理，不代表新版 cache API 會建立冷卻。
fixture 在記憶體攔截請求，不碰來源、正式 Blobs 或 CSV。

新版部署後確認只剩三個橘標只讀 API、兩個取價入口及舊環境開關已退役。
本機測試與打包不能代替部署驗收；不要為了驗收啟用正式 control 或清除 breaker。
