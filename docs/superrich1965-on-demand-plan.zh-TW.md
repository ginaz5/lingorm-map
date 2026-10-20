# SuperRich 1965：Netlify 只讀快取與外部抓取

更新日期：2026-10-20。本分支已退役橘標的 Netlify 來源抓取入口，保留
38 家分店的卡片、排序、Google／HERE 地圖，以及共用快取 API。
這是程式變更，尚未部署；舊部署的行為不會因本機修改而改變。

本機匿名 API 曾成功取得指定 USD／TWD 面額買入價，但 Netlify Preview
在匿名 token GET 收到來源 403 challenge，尚未發出匯率 POST；本站的
429 是後續冷卻。證據見 [匿名 API 調查紀錄](superrich1965-anonymous-api-investigation.zh-TW.md)。
下一階段規劃由 GitHub Actions 抓取、Netlify 提供快取與前端；
[Actions runner、發布接線與排程](superrich1965-github-actions-plan.zh-TW.md) 尚未實作。
在新抓取器可用前，現有報價會依原有效期到期，按鈕不會產生新報價。

## 已退役項目

| 項目 | 本分支狀態 |
| --- | --- |
| `exchange-rates-1965-fetch.mjs` | 刪除半小時排程入口 |
| `exchange-rates-1965-refresh.mjs` | 刪除 Background Function 入口與 Netlify dispatch |
| `exchange-rates-1965-browser.mjs` | 刪除 Chromium 傳輸與專用測試 |
| `@sparticuz/chromium`、`playwright-core` | 移除依賴及 Netlify binary 打包設定 |
| `EXCHANGE_RATES_1965_FETCH_MODE` | 移除程式讀取與範例設定 |
| `EXCHANGE_RATES_1965_SOURCE_TRANSPORT` | 移除程式讀取與範例設定 |

兩個舊環境開關不再控制本分支的任何行為。2026-10-20 已從 Netlify 專案的
所有 context 移除，CLI 確認需重新部署才會套用；不要為新版部署重新設定它們。
`EXCHANGE_RATES_1965_ENABLED` 保留，預設 false，既有 runtime control 優先。
`NETLIFY_SITE_ID`、`NETLIFY_AUTH_TOKEN` 仍供管理工具與既有 CLI 使用，不能一併刪除。

匿名 transport、parser、mapping、control、lease、breaker、逐店 collector 與
慢速批次核心保留供外部抓取器整合；它們不在公開 Netlify API 的依賴鏈中。
既有本機 CLI 與完整 snapshot 契約也保留，但 CLI 尚未接匿名 transport 或
逐店發布，不能直接當成 Actions runner。

## 頁面與 API

| 端點 | 方法 | 現行行為 |
| --- | --- | --- |
| `/api/exchange-rates-1965-cache` | GET | 讀取有效逐店快取；不初始化 control、不寫 Blobs、不抓來源 |
| `/api/exchange-rates-1965-branch` | POST | 保留 `{ "slug": "superrich1965-58" }` 契約，只重新讀取該店快取；可讀取有效舊 snapshot fallback |
| `/api/exchange-rates-1965` | GET | 保留既有完整 snapshot 的只讀 API，供舊 CLI 契約使用 |

單店 POST 只接受正式 mapping 的一個 Slug，拒絕額外欄位、跨站 Origin、
錯誤 content type 或過大 body。有效報價回 200；無有效報價回
`503 unavailable` 與 60 秒 Retry-After。停用、控制競態或 storage 失敗沿用
各自的 503 reason；不再因單店按鈕取得 lease、讀 breaker 或啟動來源請求。
公開回應不含來源診斷、token 或快取中的額外欄位，並設為 no-store。

純讀流程前後核對 control，報價必須符合 slug、controlVersion、enabledAt 與
原到期時間。缺少有效 control 時不自行建立；停用不刪除快取，但 API 不提供報價。
不得以更換部署、store 或 runner 清除既有控制與封鎖冷卻。

頁面初始化及每 60 秒讀取逐店快取；離線、背景頁面暫停新增讀取，恢復後只讀快取。
有有效報價時顯示數字與時間；缺少報價時顯示「重新整理匯率／Refresh rates」，
按鈕只讀該店快取。兩種請求的前端 timeout 均為 12 秒，沒有 Chromium 啟動等待。
列表與 Google／HERE popup 共用結果、排序與到期狀態；橘標排序只比較已有有效
報價的分店，不宣稱為全部 38 家的完整排名。綠標流程不變。

## 有效期與資料保留

綠標與橘標單店快取共用 `src/data/exchange-rate-timing.js` 的到期公式：
查詢開始時間之後的下一個 UTC 整點／半點，加 35 分鐘，實際約 35～65 分鐘。
例如 10:10 抓取，下一個邊界 10:30，到期為 11:05。讀取不延長
attemptedAt 或 expiresAt；舊 snapshot fallback 也不重寫逐店快取。

控制、breaker、gate、lease、背景 job 與快取資料均不因這次退役而刪除。
暫時的快取讀取錯誤保留前端已載入報價至原到期時間；停用或控制版本改變則
撤下舊數字。外部抓取器仍須遵守同一控制、冷卻、租約與 2～5 秒間隔。

## 驗證與部署邊界

Node 測試以 fake fetch／clock／store 覆蓋只讀 API 的零來源請求、零寫入、
無 control、不符版本、到期、有效 snapshot fallback 與控制競態；部署邊界測試
確認公開 API 不載入 collector、退役入口不再存在。保留匿名 transport、
逐店 collector、慢速批次與原完整 snapshot 的回歸測試。

本機步驟見 [橘標整合與維運](../note/LOCAL_TESTING.md#橘標整合與維運)。
`/tests/fixtures/orange-branch-query.html` 在記憶體模擬快取結果；
`lang=en` 測英文、`fail=1` 測既有冷卻回應相容性、`delay=1500` 測載入與重複點擊。
fixture 不代表新 API 會建立冷卻，也不接觸來源或正式 Blobs。

部署新版後須確認橘標只剩上述三個公開只讀 API，沒有 fetch／refresh 來源入口，
且舊環境開關已移除。未部署前不要將本機測試視為線上退役完成。
GitHub Actions 的 Secrets、Preview target、probe 與首次 workflow_dispatch
仍須另行實作和驗收；不得直接觸發舊來源函式來驗收新版。

過往來源 log 的 403／429 區分見
[橘標來源失敗診斷](../note/LOCAL_TESTING.md#橘標來源失敗診斷)。
原五分鐘單店真實驗收是歷史紀錄，見
[2026-10-17 單店報告](superrich1965-single-branch-test-2026-10-17.zh-TW.md)。
