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
