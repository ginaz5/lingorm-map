# SuperRich 1965：正式上線與驗收紀錄

更新：2026-10-22（Asia/Taipei）。此文件記錄 PR #8 正式上線的實際證據，操作方式見
[Actions 維運文件](superrich1965-actions-runbook.zh-TW.md)。未完成的階段保持待驗收，
不以 GitHub 綠燈、Preview 報價或歷史 replay 代替正式來源及發布驗收。

## 首次實際排程失敗（2026-10-22）

[Run 39730672160](https://github.com/ginaz5/lingorm-map/actions/runs/39730672160)
為 event=schedule，台灣時間 13:54:06 建立、14:00:05 以 exitCode=1 結束。
Workflow commit 為 `bf760512bbc70eed4517dfb9ec736eb3d3508c5d`，網站 target 仍是
下表已審閱的正式 SHA；中間只有 `[skip netlify]` 文件提交，並非部署綁定失配。

- requested=38、sourceSucceeded=34、published=34、failed=1、notAttempted=3，
  共 36 次來源 HTTP；GitHub 的「All jobs have failed」表示唯一 job 失敗，並非 38 店皆失敗。
- 前 34 店成功；第 35 店 `superrich1965-92` 尚未送 rate POST，就在重新取得 token
  時停止。Callback 回 HTTP 200／JSON、無 challenge，diagnostic reason=`invalid`。
  剩餘 93／110／112 未嘗試；本輪沒有 403／429 證據。
- 現有 log 將 JSON／token 格式錯誤及到期／接近到期都記成 `invalid`，未保存原始
  token 或 body，因此無法從這次紀錄確認具體原因。跨過整點只是時間上的線索，
  不能認定是 token 到期或官網快取問題。
- 台灣時間 14:10:11 正式 cache GET 仍回 34 店有效 quote，期限均為 14:35，
  沒有把未成功的四店補上報價或延長期限。隨後只讀查核確認 control 啟用、正式部署
  身分相符、共同 guard 未 paused、blockLevel=2 保留、lease 與 unresolved 均為空；
  普通失敗的 60 秒來源間隔已過，未清冷卻、重跑或改遠端控制。

本機修正將 token 失敗診斷細分為 `invalid_token_json`／`invalid_token_value`／
`expired_token`／`near_expiry_token`，並在 Actions summary 顯示成功、失敗、未嘗試數量
及停止分店、HTTP stage／status／診斷。保留 30 秒安全邊界、失敗停輪及禁止重試；
模擬 34 店發布後更新 token 失敗，驗證舊 quote、guard 結案與零來源 replay。
這是診斷改善，不能描述成來源已修復或正式排程已恢復；須經審閱上線及後續實際
schedule 結果才能確認穩定性。

本機驗證：122 項 focused Node 測試、完整 852 項 Node 測試、14 項 Python 離線測試、
strict checkJs、Vite／Functions build（輸出至 `/private/tmp`）及 `git diff --check` 通過。
調查與驗證期間未推送或部署；沒有另發真實來源請求。

## 發布與控制身分

| 項目 | 已核對值 |
| --- | --- |
| PR | [#8](https://github.com/ginaz5/lingorm-map/pull/8)，台灣時間 2026-10-22 07:19 合併 |
| 正式 main commit | e88e8b90d46194faa9f8ca5179efd89655d7c802 |
| 正式 deploy | 6ad94882c583f63d0a5bc49b，ready／production／main |
| 整合 Preview | 6ad947e6a9a47a09d79b9729，commit c0f538823bdd6acc439e2a1d33e5f3af32938222，合併前驗收通過 |
| Production control | 82980bfd-a934-4aaf-90ac-127d44c2384b，獨立正式 store 啟用 |
| 共用 sourceEpoch | 4eb55ef8-212f-4bd3-b1b0-ebe760769c26 |
| 封鎖歷史 | blockLevel=2 保留，不因正式上線或來源成功歸零 |
| 排程開關 | EXCHANGE_RATES_1965_SCHEDULE_ENABLED=true，台灣時間 2026-10-22 07:41 核對回讀 |

正式 Environment variable `EXCHANGE_RATES_1965_PRODUCTION_COMMIT` 已設為上表完整 SHA。
沿用 main-only `superrich1965-preview` Environment 的專用 PAT 與 site ID，不以本機管理
token 取代 workflow Secret。Target 不從目前 main 自動推導；日後網站更新必須先核對
實際發布再更新綁定。Environment 的歷史名稱不表示 PAT 權限僅限 Preview。

正式 control 與 quote 沒有從 Preview 複製；source guard 則沿用同一 epoch、層級與
冷卻歷史。人工輪次結束先 pause，核對 lease 已釋放及沒有 unresolved attempt，
通過該階段驗收才恢復來源執行下一階段。

## 合併前驗證

整合保留 main 的 Python／Safari 傳輸、固定單店／五店／全店模式，以及 PR #8 的
雙品牌前端、Google／HERE、三個橘標只讀 API。848 項 Node、14 項 Python 測試、
strict checkJs、Vite／Functions build、snapshot／收藏／mapping 驗證通過；
[CI 39692664535](https://github.com/ginaz5/lingorm-map/actions/runs/39692664535) 通過。
本機測試不打真實來源或寫正式 Blobs，實際正式結果記於下表。

## 正式逐階段驗收

| 階段 | Run | 新取且發布 | Cache hit | 來源 HTTP | 驗收 |
| --- | --- | ---: | ---: | ---: | --- |
| Inspect | [39693020146](https://github.com/ginaz5/lingorm-map/actions/runs/39693020146) | 0 | — | 0 | 專用 PAT／正式 metadata 通過；當時尚無 production control，未寫狀態 |
| 單店 | [39693213469](https://github.com/ginaz5/lingorm-map/actions/runs/39693213469) | 1 | 0 | 2 | A04／36，token GET／rate POST 都 200，sourceValidated=true，API／quote 一致 |
| 五店 | [39693450584](https://github.com/ginaz5/lingorm-map/actions/runs/39693450584) | 4 | 1 | 5 | coverage=5；cache GET／5 店 POST 都 200，沿用單店 58 的原 quote |
| 全店 | [39694052646](https://github.com/ginaz5/lingorm-map/actions/runs/39694052646) | 38 | 0 | 39 | coverage=38、sourceValidated=true，GET／38 店 POST 都 200 |
| 正式地圖及排序 | 現場瀏覽器 | — | — | 0 | Google SDK／圖磚／popup、中英文及 USD／TWD 最佳排序通過；HERE／期限證據見下文 |
| 真正定時更新 | [39730672160](https://github.com/ginaz5/lingorm-map/actions/runs/39730672160) | 34 | 0 | 36 | token 更新驗證失敗，1 店失敗、3 店未嘗試；詳見上方紀錄，尚未通過排程驗收 |

單店於台灣時間 07:24 新取並發布，coverage=1；GET cache 與單店 POST 均回 200，
對應相同 quote，讀取前後 control／breaker／gate／job／operation／source guard 未變。
結果非 replay、failed=0；完成後 source paused、blockLevel=2 保留。

五店於台灣時間 07:28 完成逐店及 API 驗收，failed=0；先前單店 58 的 quote 完全
不變，其餘四店新取並發布。sourceValidated=false 如實反映混合 cache，讀取前後
控制及來源狀態未變，完成後 source paused，blockLevel=2 保留。

全店輪次已跨過 UTC 23:30 刷新邊界，因此先前五店亦重新符合更新資格，最終 38 店
全部新取且發布，1 次 token GET＋38 次 rate POST。台灣時間 07:39 逐店、cache GET
與 38 次單店 POST 比對通過，failed=0、notAttempted=0、exitCode=0，非 replay。
全部 quote 到期為 UTC 2026-10-22 00:35（台灣時間 08:35），純讀不延長時間。
每輪仍保留合法快取，不以清快取或重標時間製造全新結果。
每店指定 USD `100-50`、TWD `1000-100` 買入價、Slug／mapping、controlVersion、
attemptedAt／expiresAt、逐店終態及 API 一致性都須核對。來源成功與發布成功不同，
混合 cache 的 sourceValidated=false 是預期診斷。

此次 31 家為 USD 33.50／TWD 1.010，7 家為 USD 33.42／TWD 1.000；較低報價分店
ID 為 71、73、74、78、79、82、93。這只是本次擷取結果，不作為固定費率或未來保證。
Google 現場頁面顯示 38／211 筆地點，已驗中英文、USD／TWD「最佳」排序與 Emsphere G
實際 popup。列表、popup 與 API 使用相同 quote，沒有跨品牌或用其他店價補值。

## 排程與故障界線

排程使用 UTC `0,30 1-15 * * *`，即泰國 08:00～22:30，每天 30 輪，固定
production／publish-all-python；Repository variable 明確 `true` 才通過 job 與 CLI
兩層 gate。正式人工驗收完成後已開啟，仍須核對至少兩個實際 event=schedule 的結果。
手動 dispatch 不代替定時驗收；若排程延遲，quote 仍按原期限撤價，不補跑過期輪次。

UTC 2026-10-21 23:41:30（台灣時間 10 月 22 日 07:41）核對開關回讀為 true、
production metadata 仍為上表部署及 SHA，source-resume 成功且 paused=false；
leaseId=null、leaseUntilMs=0、unresolvedAttempt=null，原 control、sourceEpoch、
blockLevel=2 及已過期冷卻歷史皆保留，沒有其他 active GitHub 來源工作。
這是核對時間，不當作精確設定變更時間。預定首兩輪為台灣時間 09:00／09:30，
啟用時尚未發生，沒有記為成功；本次查到的首輪實際結果見上方失敗紀錄。
每日執行窗為台灣 09:00～23:30。

來源 403／429／challenge、格式錯誤、缺面額、timeout 或發布失敗都停止該輪，保留
已成功及未過期 quote。共同 guard 已有兩級歷史，再次 challenge 可能升第三級暫停；
不重試、不清冷卻、不換 target 繞過，也不恢復已退役的 Netlify 來源入口。

緊急先關排程並 source-pause；資料有疑慮再 disable production control 撤價。
網站回滾不會停止 Actions，也不會還原 site-wide Blobs。Source token 只存記憶體，
文件、log、ledger 不保存 token／Authorization／Cookie 或原始來源 body。

Preview 已驗收結果仍可參考[五店與全店文件](superrich1965-python-batches.zh-TW.md)：
先 5 店全新，後續 33 新取＋5 cache 的 38 店覆蓋。該 Preview 僅有 HERE 設定，
不能當作正式 Google Maps popup 已通過的證據。正式站的 Google SDK、圖磚及實際
popup／排序已另外現場驗收；新 Preview 的 HERE 僅讀自身 store，正確顯示無自身報價，
不會洩入正式 quote。使用正式實際 quote 的三項模擬時鐘測試，已確認 API、
列表及 Google／HERE popup 到期撤價，但不代替現場等到期限的觀察。
來源 update_time 的語意與回應缺少獨立
分店識別仍是既有限制，本次成功不代表所有 runner／時段都穩定。
