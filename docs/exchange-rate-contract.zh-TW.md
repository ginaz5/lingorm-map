# 換匯資料與公開 API 契約

更新：2026-10-24。這份文件整理目前程式共用的資料邊界；部署操作見
[綠標維運](../note/LOCAL_TESTING.md#換匯功能上線與維運手冊)、
[橘標 Netlify 維運](superrich1965-netlify-runbook.zh-TW.md)。
欄位驗證以 parser、正式 mapping 與回歸測試為準。早期計畫保存在
[歷史索引](archive/README.md)，不作為目前的啟用步驟。

## 品牌與來源解析

SuperRich Thailand（綠標）與 SuperRich 1965（橘標）是不同公司。
來源 parser、識別碼與排序選項分開維護，不互相替代。

| 品牌 | Parser／mapping | 買入價來源欄位與精確面額 | 排序 key |
| --- | --- | --- | --- |
| 綠標 | [exchange-rates.js](../src/data/exchange-rates.js)、[26 店 mapping](../data/superrich-branches.json) | `buyText`；USD `100`、USD `50`、TWD `2000 - 100` | `USD_100`、`USD_50`、`TWD` |
| 橘標 | [exchange-rates-1965.js](../src/data/exchange-rates-1965.js)、[38 店 mapping](../data/superrich1965-branches.json) | `buy_rate_amount`；USD `100-50`、TWD `1000-100` | `USD_1965`、`TWD_1965` |

- 只接受指定面額買入價；其他面額與賣出價不進入公開報價。缺少或格式不符時回傳明確不可用狀態。
- 兩個 parser 都用整數 `rateScaledE6`，共同縮放係數為 `1_000_000`；`displayDecimals` 保留顯示精度。比較使用整數，不用顯示字串或浮點縮放。
- 綠標來源的 `officialId`／`branchCode` 必須與 mapping 相符；不符時整店失敗。
- 橘標 rate response 不帶可驗證的分店身分，請求前必須由正式 mapping 決定 `branchNo`；不得由名稱猜測。來源 `data.update_time` 的語意未經確認，不作為快取完成或到期時間。
- 分店自動名稱配對只產生草稿；更新 mapping 或 Notion 前，逐筆核對官方分店身分、地址與對照證據，先處理碰撞與 partner 分組。
- Parser 對外只提供驗證過的識別碼、數值、固定列舉與必要連結；來源任意文字不直接插入報價 HTML。
- 橘標分店對照與建檔證據見[正式分店查證](superrich1965-branch-verification.zh-TW.md)。[mapping validator](../scripts/validate-superrich1965-mapping.mjs) 仍讀取原有 evidence JSON。

## 公開 API 與快取

| 端點 | 方法 | 行為 |
| --- | --- | --- |
| `/api/exchange-rates` | GET | 讀取綠標控制與完整快照 |
| `/api/exchange-rates-1965-cache` | GET | 讀取有效橘標逐店報價 |
| `/api/exchange-rates-1965-branch` | POST | 接受正式 mapping 的單一 `{ "slug": "superrich1965-58" }`，只讀該店逐店快取 |
| `/api/exchange-rates-1965-runtime` | GET | 只讀目前路由的 site／deploy／context／Node 身分，供部署綁定核對；不提供報價或憑證 |

公開讀取不抓來源。橘標讀取不初始化 control、不取得來源 lease、不寫 Blobs，
也不啟動背景工作。單店 POST 檢查 Origin、content type、body 大小與額外欄位：
有效報價回 200；無有效報價回 `503 unavailable` 與 `Retry-After: 60`；停用回 `503 disabled`。
聚合 cache GET 在停用、缺少 control 或沒有有效報價時回 200、`quotes: []`；
綠標完整 snapshot GET 在沒有可用快照時回 200、`snapshot: null`。
橘標單店與聚合 cache API 依公開欄位 allowlist 輸出，不暴露 token、來源診斷或快取額外欄位；
綠標完整 snapshot API 保留既有驗證後 entry 的格式。

報價必須符合 Slug／分店身分、quote `controlVersion`、`enabledAt` 與原有效期。
讀取前後核對控制版本；停用或版本改變便撤下舊報價。暫時讀取失敗可保留前端
既有報價至原到期時間。讀取不重標時間、不延長有效期。橘標公開 API 與 collector
都只讀取各 Slug 的逐店 quote，不從舊完整快照補值。

### 橘標舊完整快照管線退役

2026-10-24 移除橘標 `/api/exchange-rates-1965` 完整快照端點、前端對應的舊輪詢／state、
單店完整快照 fallback 與本機 `fx:1965:fetch` 取價 CLI。舊橘標 snapshot Blobs
不再由目前流程讀取，也不搬移、改寫或刪除；逐店 quote 的 key、控制版本與原有效期保持原契約。
綠標 `/api/exchange-rates` 完整快照流程與 Notion 地點 CSV snapshot 繼續使用。

## 有效期與前端

[exchange-rate-timing.js](../src/data/exchange-rate-timing.js) 使用查詢開始後的下一個
UTC 整點／半點，再加 35 分鐘作為到期時間；實際約 35～65 分鐘。
例如 10:10 開始查詢，下一邊界為 10:30，到期為 11:05。

前端每 60 秒讀取本站 API；離線、背景頁面暫停新增請求，到期計時仍須撤下舊數字，
恢復時先處理到期再讀快取。頁面與橘標「重新整理匯率」按鈕都只讀本站快取。
沒有報價仍保留分店、收藏及連結；只有對應品牌／幣別有有效報價時才能使用最佳排序。
排序不跨品牌混比，列表與 Google／HERE popup 共用同一報價與到期狀態。

公開換匯點須通過正式位置發布規則，且 Slug 位於兩品牌 mapping 的聯集。
Notion 仍是位置系統來源；匯率與營業時間不寫入位置 snapshot。

## 來源工作與驗證

綠標由獨立 Netlify collector 更新快照。橘標由綁定部署的 Netlify scheduler／Python
background worker 逐店發布；GitHub Actions 保留手動備援，沒有 cron。
橘標沿用共同 source guard、冷卻、lease、CAS 與 operation ledger；正式部署更換後
必須核對並重新綁定，不清除來源保護歷史。單店報價發布成功只清除連續失敗計數，
封鎖等級與未到期封鎖時間不變。操作及 token 逾時重試的明確例外見
[Netlify 維運手冊](superrich1965-netlify-runbook.zh-TW.md)。

修改契約時需檢查來源 parser、兩品牌 state／輪詢、公開 API、控制／collector、
列表與兩個地圖 provider 的消費端。執行 `npm run typecheck`、`npm test`、
`npm run build`；mapping 或 snapshot 變更另跑位置、收藏相容性與兩品牌 mapping validators。
這些離線檢查不代替真實排程收據與公開報價驗收。
