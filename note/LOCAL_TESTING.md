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

2026-10-17：全部 38 家橘標已依使用者指示在 Notion 改為 Published，
並經 exporter 更新 CSV。狀態更新不代表匯率服務已在正式環境啟用。

- 目前方案為後端每半小時派送 Background Function，逐店查詢全部 38 家，
  每家完成後隨機等 2～5 秒。頁面只 GET /api/exchange-rates-1965-cache，
  不顯示批次進度、不從瀏覽器啟動整批或五公里查詢。
- 有效報價直接顯示；缺少有效報價才顯示單店手動查詢按鈕，POST 一家到
  /api/exchange-rates-1965-branch。既有快取、lease、breaker 與停用控制共用。
- 到期規則與綠標相同：下一個整點／半點 + 35 分鐘，實際約 35～65 分鐘。
  每半小時刷新到更新時間的分店，尚未到更新時間則重用快取；讀取不延長有效期。
- 失敗、busy、冷卻或停用即停整輪；舊報價不覆寫，保留到原到期時間。
  403／429／challenge 沿用原本 breaker。服務停用時 API 不提供舊報價。
- 部署時設定 EXCHANGE_RATES_1965_FETCH_MODE=background；netlify 也走背景
  派送。local 與 on-demand 跳過排程；EXCHANGE_RATES_1965_ENABLED 預設 false，
  既有 runtime control 優先。本次未改正式設定、未部署。
- 排程函式只派送，30 秒內結束；背景工作預算 12 分鐘。私有隨機 token 與
  ETag 工作認領防止未授權啟動或重複抓取，token 不放到 client、URL 或 log。
- 列表與兩個 provider 的 popup 共用報價、排序及到期狀態；綠標輪詢維持原樣。

完整契約、操作與驗證邊界見
[後端更新與單店補查計畫](../docs/superrich1965-on-demand-plan.zh-TW.md)。

程式驗證不打真實來源、不寫正式資料：

    npm run typecheck
    npm test
    npm run build
    netlify functions:build --src netlify/functions
    node scripts/validate-location-snapshot.mjs data/locations.csv
    node scripts/validate-favorite-compatibility.mjs
    node scripts/validate-superrich1965-mapping.mjs data/superrich1965-branches.json data/locations.csv

### 橘標來源失敗診斷

單店手動查詢與背景更新會在執行該次查詢的 Function log 記錄
`event=exchange_rates_1965_branch`。以 `slug` 與 `trigger=manual|background`
辨識分店及觸發方式；`httpStatus` 是本站回應，`blockedStatus` 與
`diagnostics[].status` 才是來源 HTTP 狀態。後者附有截短、限定欄位的
`cfMitigated`、`contentType`、`retryAfter`、`rayId` 與錯誤代碼。

- `sourceRequestCount=1`、`sourceOutcome=blocked`、`cooldownSource=source_blocked`
  表示本次實際打到來源後被拒絕；`cfMitigated=challenge` 可確認 challenge。
- `sourceRequestCount=0`、`cooldownSource=breaker` 表示既有封鎖冷卻擋下查詢；
  `cooldownSource=gate` 則是共用請求間隔，兩者都沒有新來源請求。
- `retryAt` 是本站允許再試的 UTC 時間，不代表來源保證在此時解封。
  快取命中同樣為零來源請求，但 `httpStatus=200` 且沒有冷卻原因。
- 背景結束的 `exchange_rates_1965_background` 紀錄以 `stoppedSlug` 標示
  因單店查詢結果而停止的分店；`loaded` 是該工作取得成功結果的分店數。

診斷僅寫私有 Function log，不回傳單店或快取 API、不記錄 Cookie、認證 header、
工作 token、完整來源 HTML／JSON 或任意例外文字。記錄失敗不影響報價及 lease。
查詢紀錄不會新增來源請求、重試、清除冷卻或改變既有 breaker。

在 Netlify 對應部署查看 `exchange-rates-1965-branch`（手動）或
`exchange-rates-1965-refresh`（背景）的 log。CLI 可用確切 deploy permalink，
避免 Preview alias 被誤辨為 branch：

```bash
netlify logs --url https://<deploy-id>--lingorm-map.netlify.app --function exchange-rates-1965-branch exchange-rates-1965-refresh --since 1h
```

### 匿名 API 模式本機驗收

`EXCHANGE_RATES_1965_SOURCE_TRANSPORT=anonymous-api` 使用匿名 callback token 與
external-app 取價介面，不啟動 Chromium。先確認既有本機、正式與目標 Preview
沒有有效冷卻；不得透過切模式、新部署或本機空 store 避開尚未結束的封鎖。
查詢前核對 control，已停用時不為了測試清掉既有控制。

在本機程序選用模式，不需改 `.env` 或 Netlify 設定：

```bash
EXCHANGE_RATES_1965_SOURCE_TRANSPORT=anonymous-api EXCHANGE_RATES_1965_FETCH_MODE=on-demand EXCHANGE_RATES_1965_ENABLED=true netlify dev
```

`ENABLED=true` 只在本機沒有 control 時初始化；既有 disabled control 仍優先。
先查 `/api/exchange-rates-1965-cache`，再以同源 POST 查
`superrich1965-58`（mapping A04／36）。冷查詢預期來源 GET／POST 各一次，
私有 log 應為 `sourceProfile=anonymous-api`、`sourceRequestCount=2`，
診斷 stage 分別是 token、rate。確認 USD `100-50` 與 TWD `1000-100` 買入價，
再查一次應回相同快取、來源請求 0；唯讀 cache API 應提供該店相同結果。
不要為了取價而呼叫完整背景輪次。mock 測試另驗兩店共用 token 與原本的間隔。

token 只存該 invocation 記憶體，不放 URL、前端、報價快取或 console。
任何階段的 403／429／challenge 都停止，保存原冷卻；401／錯誤 JSON／逾時
不改走其他介面、不自動重試。匿名來源 timeout 12 秒、deadline 15 秒，
前端既有手動查詢 timeout 32 秒足夠，不需再調整 Chromium 或 UI 時間。

本機成功仍不代表 Netlify 出口可用。後續經授權的 Preview 驗收，先只在
Deploy Preview 的 Functions scope 設 anonymous-api 並重新部署，確認既有
冷卻結束後先測一家；單店成功再測 background。正式環境設定不隨本機測試變更。

### Netlify 瀏覽器模式驗收

只有兩支橘標來源函式會封裝 Chromium，既有 HTTP 傳輸預設保留。
瀏覽器 binary 為 Linux/Lambda 版本；macOS 本機只跑 mock 與打包檢查，不能
用本機 Chrome 成功代替 Netlify 出口驗證。套件要求 Node 22.17+（Node 22）
或 Node 24+；`netlify.toml` 已設定 Node 22 與兩支函式的 external/binary 包裝。

1. 已知來源冷卻結束後，在 **Deploy Preview context、Functions scope** 設定
   `EXCHANGE_RATES_1965_SOURCE_TRANSPORT=browser`，搭配既有 enabled control
   及 `EXCHANGE_RATES_1965_FETCH_MODE=background`。環境設定需重新部署才生效；
   不修改正式 context，也不要用新 deploy 的空 store 當作解除舊封鎖的理由。
2. 確認新 Preview 的 commit、CI 與部署成功。先點 Silom Plaza 的單店查詢，
   首次查詢最多可能等約半分鐘；快取命中不會啟動 Chromium。
3. 查看 `exchange-rates-1965-branch` 的 `exchange_rates_1965_browser` log。
   `stage=navigation,result=ready` 表示官網載入成功；`stage=rate` 才是匯率
   POST 階段。單店摘要應為 `sourceProfile=browser`，有效 JSON 成功後確認
   USD／TWD 在列表與兩種 map provider 的 popup 同步顯示。
4. 成功後才人工觸發同一 Preview 的 `exchange-rates-1965-fetch`，查看
   `exchange-rates-1965-refresh` 的結果、停止分店與逐店快取。背景輪次只啟動
   一個 browser，沿用 2～5 秒間隔。Preview 不會自行排程。
5. 若 `stage=launch,result=failed`，查 runtime／binary 包裝；若 navigation
   或 rate 階段再次 403／challenge，保存診斷並停止，不宣稱修復或反覆重跑。
   可將 Preview 的 transport 改回 `http` 後重新部署回復原路徑，但不能以此
   清除未到期冷卻。

### 橘標 UI 本機驗收

開啟 /tests/fixtures/orange-branch-query.html。第一店應顯示模擬快取報價且沒有
查詢按鈕，第二店應顯示單店按鈕。點第二店後只有一次 POST，成功後撤下按鈕；
列表與 popup 共用結果。lang=en 測英文、fail=1 測 429 冷卻、
delay=1500 測載入與重複點擊。fixture 不碰真實來源、不改 CSV。

API 整合使用 netlify dev。本機不會自動觸發排程；正式背景派送與雲端來源
仍須 Deploy Preview 驗收。不要為了測試啟用正式 control 或清除 breaker。
