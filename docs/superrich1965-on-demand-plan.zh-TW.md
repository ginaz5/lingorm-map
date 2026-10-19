# SuperRich 1965：後端定時更新與單店補查

更新日期：2026-10-17。依使用者確認，全部 38 家橘標由後端慢速定時更新，
頁面只讀共用快取；沒有有效報價時，才提供單店手動查詢。五公里佇列與批次
進度已移除。全部 38 家分店已在 Notion 設為 Published，並由 exporter 更新快照。

## 後端排程

- exchange-rates-1965-fetch 每半小時派送工作，自己不抓來源。
- exchange-rates-1965-refresh 為 Background Function，逐家呼叫既有單店查詢。
  每家完成後隨機等待 2～5 秒，單次來源 timeout 5 秒；整輪預算 12 分鐘，
  留在 Netlify 背景函式的 15 分鐘上限內。排程函式本身上限仍是 30 秒。
- FETCH_MODE=background 或 netlify 使用背景更新；local／on-demand 會跳過排程。
  EXCHANGE_RATES_1965_ENABLED 預設仍為 false，既有 control 優先。
- 排程將隨機 bearer token 與控制版本寫入私有 background-job blob，然後
  POST 到同部署的背景函式。Token 只在伺服器 blob 與請求 header，不回傳頁面、
  不放 URL 或 log。背景工作先比對 token，再用 ETag 原子認領；同半小時的
  重複排程、背景函式的重送與未授權請求不會重複抓來源。
- 派送使用執行環境的 deploy ID 與 site name 組成同部署 permalink，Preview
  不回退到正式站 URL；無法辨識 Preview 部署時停止派送，避免跨部署寫入。
- 每店成功各自寫入 branches/{slug}，不偽裝成完整 38 店 snapshot。失敗不
  覆蓋舊報價；遇普通失敗的共用冷卻、busy、challenge、停用或控制版本變更，
  立即停止，留下已取得的有效快取。下輪排程或單店人工補查再處理缺漏。
- 原本單店 gate 與 breaker 仍共用；不透過新的背景工作繞過封鎖或停用。
  舊完整 snapshot API／CLI 契約保留，前端改讀新的逐店快取 API。

## Netlify 瀏覽器來源模式（2026-10-18）

`EXCHANGE_RATES_1965_SOURCE_TRANSPORT=http|browser|anonymous-api` 控制單店 API 與背景工作的
來源傳輸方式，未設定時保留 `http`。`browser` 使用版本相容的 Chromium 153
與 Playwright，在 Netlify 函式內載入官網公開匯率頁並執行 JavaScript，然後
透過同一瀏覽器 session 的 same-origin fetch 查詢固定 mapping 分店。
不依賴本機電腦、外部瀏覽器服務或使用者的 Chrome profile。

瀏覽器只在既有控制、快取、breaker、gate 與 lease 檢查通過、確實需要來源
查詢時啟動。頁面的自動預設分店查詢被攔截，不額外打匯率 API；每次只允許
當前租約指定的分店請求。背景工作重用該輪的瀏覽器與 session，手動查詢則
在完成後關閉；中止或啟動太晚也必須清理瀏覽器。

瀏覽器來源 timeout 為 23 秒、deadline 為 25 秒，lease 為至少 34 秒，背景
預算仍為 12 分鐘。手動查詢的前端 timeout 為 32 秒；唯讀快取維持 12 秒。
這些時間不延長報價有效期，也不增加來源重試。Bootstrap 包含官網頁面、JS
及初始化請求；`sourceRequestCount` 在此模式表示受 lease 保護的取價流程
次數，不能當成所有 bootstrap HTTP 請求總數。私有瀏覽器 log 的
`rateRequestCount` 是該 session 實際放行的匯率 POST 累計次數。

私有 `exchange_rates_1965_browser` log 提供 `stage=launch|navigation|rate`
與 `result=ready|complete|blocked|failed|timeout`，搭配單店 log 的
`sourceProfile=browser` 及既有 header 診斷，可區分瀏覽器啟動問題、官網頁面
challenge 與匯率 API challenge。完整 HTML、Cookie、授權資料不寫入 log，
server credentials 不傳給 Chromium child process。

這是瀏覽器相容性驗證模式，不是 CAPTCHA 解題器。不偽裝 User-Agent、不做
stealth patches、不匯入 clearance Cookie、不忽略 TLS 錯誤；遇到明確
403／429／challenge，仍由原 breaker 停止，不清除已知冷卻。

Chromium 為 Lambda/Linux binary，封裝在兩支會查來源的函式中；不在其他
函式或前端載入。Node 需 `^22.17.0 || >=24.0.0`，Netlify build 使用 Node 22
最新 patch。保留 `external_node_modules` 與 binary `included_files`，避免
esbuild 破壞套件的相對 binary 路徑。依賴與打包通過不代表雲端能通過來源防護。

## 匿名 token／external-app 介面調查（2026-10-19）

本機已以一次匿名 token GET + 一次 A04／36 取價 POST 取得有效 USD／TWD
指定面額買入價，現有 parser 可用。後續增加明確選用的 `anonymous-api` 模式，
未設定時仍保留 `http`；沒有修改 Chromium 或既有冷卻。
尚未在 Netlify 出口驗證，不得由單店本機成功推論全部分店或雲端可用。
端點證據、token／來源時間限制及後續整合邊界見
[匿名 API 調查紀錄](superrich1965-anonymous-api-investigation.zh-TW.md)。

匿名模式在 control／快取／breaker／lease 檢查後才 GET token，再 POST 固定
external-app 端點；兩階段共用 12 秒來源 timeout、15 秒 deadline，lease 至少
24 秒。背景工作在 invocation 記憶體中重用已知有效期的 token，使用 JWT exp
或 expires_in 中較早的期限並預留 30 秒；不知道期限時不跨分店重用。
JWT exp 只是本機到期提示，不宣稱已驗證簽章；token 到期或 401 不觸發同次取價重試。
factory 建立與有效快取命中不取 token。任何階段的 403／429／challenge 都
沿用同一 breaker，沒有 fallback 或自動刷新重試。token 不寫入 Blobs／log／前端。

單店私有 log 的 `sourceProfile=anonymous-api`，`diagnostics[].stage=token|rate`。
`sourceRequestCount` 在匿名模式是真實 HTTP 嘗試次數：冷 session 成功一家為 2，
背景沿用有效 token 的下一店為 1；沒有進入來源查詢時為 0。舊 HTTP／browser
的計數語意不變。原本快取 schema、指定 USD／TWD 面額、到期及背景間隔不變。

## 有效期與快取

綠標與橘標單店快取共用 src/data/exchange-rate-timing.js 的到期公式：
查詢開始時間之後的下一個 UTC 整點／半點，加 35 分鐘。實際有效期約
35～65 分鐘，不是固定 30 分鐘。例如 10:10 抓取，下個邊界 10:30，
到期為 11:05。讀快取不延長 attemptedAt 或 expiresAt。

後端每半小時刷新已到更新邊界的分店，即使舊報價仍在寬限期內也可更新；
尚未到更新時間的快取直接重用。這區分「應更新」和「已失效」，避免因為
保留舊報價而跳過下一輪。更新失敗時，舊報價繼續保留到原到期時間。

## 頁面與 API

GET /api/exchange-rates-1965-cache 是唯讀端點，只讀 control 和逐店快取，
不初始化控制、不寫 Blobs、不抓來源。前後核對控制版本，只回傳有效且
身份完整的 USD／TWD 報價，不回傳工作 token 或來源診斷。回應 no-store。

頁面初始化與每 60 秒讀此快取；背景／離線時停止新增讀取，恢復時只讀快取。
不顯示 38 店進度。有報價的卡片顯示數字與更新時間，缺少有效報價的卡片
保留「查詢此分店匯率」，按鈕只 POST 一家到原有單店 API。到期後恢復按鈕，
但不自動觸發來源查詢。列表與 Google／HERE popup 共用狀態。

POST /api/exchange-rates-1965-branch 僅接受一個 mapping Slug，拒絕其他 URL、
branchNo、額外欄位、跨站 Origin 或過大 body。200 回有效單店報價，202 表示
其他查詢處理中，429 表示冷卻，503 表示停用、來源或 storage 不可用。
有效快取優先；本機請求去重，後端保留原本跨訪客快取與 ETag lease。

服務停用不刪除快取，但 API 不再提供報價；頁面觀察到停用／新版本時撤下
舊數字。暫時的快取讀取錯誤保留已載入報價至原到期時間，不延長有效期。

## 驗證與部署邊界

2026-10-18 補充：單店與背景查詢共用私有 `exchange_rates_1965_branch` 結構化
log，保留來源狀態、請求數、有限 header 診斷與本站冷卻原因／到期時間。
背景結果另提供 `stoppedSlug`，可分辨第一家來源封鎖與後續零來源請求的冷卻。
不更動公開 API、抓取頻率、重試、冷卻或控制設定。欄位與查閱方式見
[橘標來源失敗診斷](../note/LOCAL_TESTING.md#橘標來源失敗診斷)。

Node 測試使用 fake fetch／clock／store；覆蓋 38 店順序、隨機等待、重複派送、
token 驗證、快取重用、半小時刷新、到期、失敗保留、控制競態與唯讀 API。

本機 UI fixture：/tests/fixtures/orange-branch-query.html。第一店模擬已有背景
快取、第二店無報價；後者可單獨手動查詢。lang=en 測英文、fail=1 測冷卻、
delay=1500 測載入和重複點擊。全部攔截在記憶體，不碰真實來源或正式 Blobs。

本次不修改正式環境變數、control 或部署。Deploy Preview 仍須驗證背景函式
派送、實際雲端來源可用性與跨訪客快取；本機 mock 通過不代表來源封鎖已解除。
Netlify dev 不自動觸發半小時排程，不能因為開了本機頁面就宣稱排程已運作。

原本五分鐘單店真實驗收是歷史紀錄，見
[2026-10-17 單店報告](superrich1965-single-branch-test-2026-10-17.zh-TW.md)。
Netlify 限制見 [函式設定](https://docs.netlify.com/build/functions/configuration/?fn-language=js)
與 [背景函式](https://docs.netlify.com/build/functions/background-functions/)。
