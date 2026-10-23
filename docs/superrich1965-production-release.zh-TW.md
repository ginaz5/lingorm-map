# SuperRich 1965：正式上線與驗收紀錄

更新：2026-10-23（Asia/Taipei）。此文件記錄 PR #8 正式上線的實際證據，操作方式見
[Actions 維運文件](superrich1965-actions-runbook.zh-TW.md)。未完成的階段保持待驗收，
不以 GitHub 綠燈、Preview 報價或歷史 replay 代替正式來源及發布驗收。

## Token 更新失敗原因已重現（2026-10-23）

[PR #14](https://github.com/ginaz5/lingorm-map/pull/14) 的診斷變更已於台灣時間
10 月 22 日 22:45:17 合併，main commit 為
`74f4958dd599d6ead7a746ab2e1b1f91dee7f19f`，最終訊息含 `[skip netlify]`。
853 項 Node、14 項 Python、checkJs、Vite／Functions、GitHub CI 及固定 Preview
`6ada1e2cd20d19ea990509fa` 驗證通過；Preview cache 為空，前端資產與正式版一致。
合併後已只讀核對正式部署仍為下表原版，網站 target SHA 沒有變更。

[受控 probe 39798525108](https://github.com/ginaz5/lingorm-map/actions/runs/39798525108)
於 10 月 22 日 22:48:45 開始來源工作，token GET／rate POST 都 200、來源 2 次、
sourceValidated=true、published=0。首次 callback token 僅剩 783 秒；不把重新 GET
等同於取得完整新有效期。原訂到期附近的額外手動對照未執行，以下證據來自排程本身。

[排程 39818355808](https://github.com/ginaz5/lingorm-map/actions/runs/39818355808)
於 10 月 23 日 00:56:54 建立；第一個 token GET 剩 334 秒。01:02:30 開始處理
`superrich1965-81`，更新 token 的 callback 回 HTTP 200／JSON、沒有 challenge，但：

- `reason=near_expiry_token`
- `tokenRemainingSeconds=18`
- `tokenReissued=1`，表示 callback 確實回傳同一 session 先前的同一個 token。

因此已在實際 GitHub 排程重現原因：現有流程會在 token 進入到期前 30 秒時重新 GET
callback，但 callback 不保證簽發新 token；回傳的同一個舊 token 僅剩 18 秒，仍不符
30 秒安全邊界，程式在 rate POST 之前停止整輪。這次不是 403／429、錯誤 JSON 或
分店參數問題，也不是對已到期 token 發出了 rate 請求。

該輪 requested=38、published=24、failed=1、notAttempted=13、來源 HTTP=26，
沒有 replay；成功 quote 保留原期限，失敗後沒有人工重試、清冷卻或改 guard。
來源的 60 秒失敗間隔仍正常生效。已擷取的清理後證據見
[JSON 紀錄](evidence/superrich1965-token-incident-2026-10-23.json)。

原 10 月 22 日 14:00 的失敗也發生在這條 token 更新／驗證路徑，但原回應沒有保存，
不能宣稱已從舊 log 證明當時的精確 token 值或剩餘秒數。新的排程則提供直接證據，
不再只是本機模擬。官網為何重用 token（例如 origin 或 CDN 快取）仍未驗證。
PR #14 只改善診斷，沒有改變 token 更新及整輪停止行為；後續修復見下一節。

### Token 到期等待修復

Actions 的 session 現在提供純記憶體的來源準備時間。已知 token 剩餘不超過
45 秒（原 30 秒安全邊界＋15 秒來源啟動裕度）時，先等到該 token 到期後 2 秒，
才進入下一家的正常 token GET／rate POST。這避免在 callback 尚會重用舊 token
時提早要求更新，不縮短安全邊界，也不把失敗的 HTTP 請求重新送一次。

等待只發生於需要新報價的分店，快取命中不等。等待在 target／source lease 與
15 秒來源 deadline 建立前，每秒檢查取消、job ownership 與整輪 12 分鐘預算；
結束後重驗 production target，既有 control、breaker、source guard 與 CAS 仍逐一
把關。等待期間不發來源請求、不建立 unresolved marker、不計來源失敗。
`exchange_rates_1965_token_wait` 僅記錄等待毫秒數，無 token／fingerprint。

本機整合回歸確認 38 店跨 token 到期全數發布（2 次 token GET＋38 次 rate POST），
等待當下無 target/source lease，既有 quote 與保護歷史保留；取消、期限、ownership、
control／target／guard 及 gate CAS 變更都不新增 HTTP。首次取得的 token 本身已過期／
近到期、過期後官網仍回無效 token、403／429／challenge 等仍按原規則停止，
不新增 force、fallback 或失敗重試。本機驗證與實際上線結果分別記錄。

本次修復本機驗證：866 項 Node 測試、14 項 Python 離線測試、strict checkJs、
Vite／Functions build（輸出至 `/private/tmp`）、本機文件連結及 `git diff --check`
通過；獨立程式審閱沒有需要修補的問題。

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

### 後續比對與取證準備

[Run 39771123990](https://github.com/ginaz5/lingorm-map/actions/runs/39771123990)
於台灣時間 19:30:42 建立，19:35:53 已完成最後一店；同一 workflow commit、
同一正式 target，38 店全新取／發布、39 次來源 HTTP、failed=0。
全輪只有首次 token GET，沒有 token 更新；這能證明後續全店成功，不能驗證
失敗時的 token 更新已修復。原失敗 run 的 artifacts API 為 total_count=0。

程式路徑確認：已重用 34 店的第一個 token，只有在剩餘有效期不超過 30 秒時才會
被丟棄並重新 GET callback。若 callback 仍回同一個接近到期的 token，新的驗證會
立刻停止；本機用同一個 JWT、剩餘 28 秒重現，沒有再 POST rate 或重試。
這是可重現的候選原因，尚未證明原 14:00 回應的內容就是此情況。

本次診斷追加僅管理端可見的 `tokenRemainingSeconds`（剩餘秒數，限制 ±86400）
與 `tokenReissued`（同一 session 的更新是否回相同 token，0／1）；不保存 token、
fingerprint、JWT claims 或 body。原本的 main-only、固定 target、source guard、
lease、冷卻與零重試都保留。使用者已授權推送、開 PR、驗證後合併並以受控流程
取證；最終合併訊息須含 `[skip netlify]`，保留目前正式網站部署與 target SHA。

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
