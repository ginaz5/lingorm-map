# SuperRich 1965：Netlify 正式排程切換驗收

> 歷史文件，於 2026-10-24 封存。保留當時的設計、操作與驗收結果；其中的部署狀態、待辦與指令不代表現行流程。維護請從[現行文件索引](../../../README.md)開始。


日期：2026-10-23（Asia/Taipei）。使用者已授權 Preview 通過後直接切換正式排程。
[PR #16](https://github.com/ginaz5/lingorm-map/pull/16) 已合併，操作方式見
[Netlify 維運手冊](../../../superrich1965-netlify-runbook.zh-TW.md)。

後續更新：PR #18 已於 10/24 上線並重新綁定 collector，09:30、10:00 兩輪自動排程驗收通過，詳見
[10/24 正式上線與新版驗收](../../../superrich1965-netlify-pr18-release-2026-10-24.zh-TW.md)。
以下保留 10/23 當日的驗收紀錄與結論。

## 部署與控制

| 項目 | 已核對值 |
| --- | --- |
| 正式 commit | `f26229c46f80259dcfcfe85b1827716cf3860678` |
| 正式 deploy | `6adb4042ae391a294444ba45`，ready／production／main |
| 發布時間 | 台灣時間 19:09:16.946 |
| Runtime | Node v22.23.2，來源 HTTP 使用 CPython 3.12.15 |
| 正式 collector | 19:10:03.342 啟用，綁定目前正式 deploy |
| 正式 quote control | `82980bfd-a934-4aaf-90ac-127d44c2384b`，沿用原值 |
| 共用 sourceEpoch | `4eb55ef8-212f-4bd3-b1b0-ebe760769c26`，沿用原值 |
| Netlify cron | UTC `0,30 1-15 * * *`，台灣時間 09:00～23:30 每半小時 |
| GitHub cron | workflow 已移除；repository 排程開關已回讀為 false |

Netlify 部署 API 已列出 `exchange-rates-1965-schedule`，與綠標
`exchange-rates-fetch` 使用同一個 cron。公開 runtime API 核對正式 deploy 與 Node 22；
正式合併後的 [CI](https://github.com/ginaz5/lingorm-map/actions/runs/39944038560) 通過。

## Preview 發布驗收

Preview `6adb3e2a47ed0ef9b810f74d`，commit
`ff8b4f7340a040164c14c1418a0cc428811be54d`，19:02:09.591～19:06:20.810
完成正式 worker 的逐店發布路徑，耗時 251.219 秒。

- requested／sourceSucceeded／published：38／38／38。
- 來源 HTTP：39（1 次 token GET＋38 次 rate POST），全部 200、無 challenge。
- failed／notAttempted／cacheHit：0／0／0，沒有來源失敗重試。
- 公開 cache 的 38 個唯一 Slug 與正式 mapping 相符，quote schema 全數有效，
  每店 USD／TWD 皆有報價。
- 同 slot 重複派送回 `slot_already_dispatched`，未啟動第二輪來源。
- 驗證後已 disable Preview collector；正式報價沒有從 Preview 複製。

這輪實測支持 Python 在 Netlify 能完成全店取價與發布，不能由此推論所有來源環境
都不會回 403，也不能把這輪人工派送當作自動排程驗收。

## 正式驗收進度

正式人工派送於 19:10:12.593 建立，19:12:21.478 以 `stopped` 結束：

- requested=38、sourceSucceeded=18、published=18、failed=1、notAttempted=19。
- 第 19 店 `superrich1965-74` 的 rate 請求在 15 秒期限內未完成，
  `status=null`、`challenge=false`、`reason=timeout`；沒有本輪 403 的證據。
- 共 20 次來源請求，沒有 retry 或快取補 coverage；公開 cache 確認 18 店有效報價。
- 原 guard 保留的兩次一般失敗，加上這次 timeout，按既有規則觸發一小時冷卻，
  到台灣時間 20:12:21.013。blockLevel=2 保留、paused=false、lease／unresolved 均為空。
- 冷卻中經同一 dispatcher 檢查，回 `skipped`／`cooldown`，沒有建立第二個工作或
  重試來源。19:30、20:00 預期均受冷卻 gate 擋下，不能算全店定時驗收通過。

Netlify collector 保持啟用，GitHub 自動排程保持停用。20:30 已取得真正的
`trigger=schedule` 收據，但 token GET 逾時後停止，未發布任何店，詳見下方新收據。
逾時修正（PR #17）上線並重新綁定後，22:30 首輪自動排程 38／38 發布，
但 23:00、23:30 均在第一店以 `invalid_result` 停止；新 deploy 最多連續成功 1 輪，
**10/23 兩輪連續驗收未通過**。原因與修正（PR #18，尚未部署）見下方。沒有以 HTTP 202、
已註冊 cron、Preview 成功或人工輪次代替完成驗收。

本對話原以短期只讀回查，於每小時 :06／:36 檢視持久化收據與公開 cache，
不人工派送或更動任何正式控制。20:35 查得新的失敗後已回報，並依約將回查設為
`PAUSED`；正常 Netlify 正式 cron 保持啟用。這個回查與網站的取價 cron 是兩個不同的工作。

### 19:46 只讀回查

台灣時間 19:46:13 再核對：正式 deploy／runtime／collector binding／quote control 均未變，
GitHub 排程開關仍為 false。共同 sourceEpoch 與 blockLevel=2 保留，paused=false，
lease／unresolved 均為空；仍在原有冷卻期限內，沒有新的來源失敗或控制異動。
公開 cache schema 有效，18 店 quote 與正式人工首輪保存內容相同。

19:30 尚無 slot receipt，與冷卻 gate 相符；這不能單獨證明 scheduler 已呼叫，
也不算新的排程失敗。目標 20:30／21:00 尚未到時，定時驗收繼續等待；
本回查未人工派送或發出來源請求。

### 20:13 獨立平行實驗

使用者另要求的[38 店平行實驗](../acceptance/superrich1965-netlify-python-parallel-2026-10-23.zh-TW.md)
在原冷卻自然結束後完成：38／38 店、39 次來源 HTTP 全部 200，工作紀錄耗時
9.605 秒，實際最大在途數 38、啟動時間差 2 毫秒。整輪未發布報價，
不計入正式排程的兩輪驗收。正式部署／binding 未變，來源 guard 的 epoch、
blockLevel=2 與歷史保留，paused=false、lease／unresolved 均為空。
原 20:30／21:00 正式定時驗收仍待實際收據。

### 20:25 只讀回查

台灣時間 20:25:02 核對正式 published deploy、runtime、collector binding 與
quote control 均未變，GitHub 排程開關仍為 false。原冷卻已自然到期，
source guard 的 epoch 與 blockLevel=2 保留，paused=false、lease／unresolved 均為空。

公開 cache schema 有效，目前有效 quote 為 0，與人工首輪報價已到期相符；
獨立平行實驗沒有發布報價。19:30／20:00 沒有 slot receipt，目標 20:30／21:00
尚未到時，仍未取得真正自動完成收據。本回查未發出來源請求或改動正式資料，
回查維持啟用並等待目標時段。

### 20:30 自動排程失敗，20:35 只讀確認

強一致 production site-wide store 的 slot `1792758600000` 已保存真正的
`trigger=schedule` 收據：20:30:33.994 建立，20:30:49.554 以 `stopped` 結束，
`exitCode=1`。對應 actions operation ledger 的終態、逐店結果與 exit code 相符。

- requested=38、sourceSucceeded=0、published=0、failed=1、notAttempted=37、cacheHit=0。
- 第一店 `superrich1965-56` 在 token 階段逾時：`status=null`、`challenge=false`、
  `reason=timeout`。共 1 次來源 HTTP，為 1 次 token GET 嘗試；尚未發出 rate POST，
  沒有本輪 403 或 challenge 的證據。
- 20:35:37 公開 cache schema 有效，有效 quote 為 0；因此無法驗收 38 店 mapping、
  USD／TWD 與完整發布。正式 deploy／runtime／collector binding／quote control 均未變，
  GitHub 排程開關仍為 false。
- source guard 保留原 epoch、blockLevel=2 與既有冷卻時間，consecutiveFailedRuns=1；
  paused=false、lease／unresolved 均為空，沒有新增整輪長冷卻或未決工作。

本回查未請求來源、重跑或更動正式資料。已回報新失敗並將回查設為 `PAUSED`，
正常 Netlify 正式排程保留。下一步應排查 token GET 的連線逾時；本輪在逐店取價前
已停止，不能據此歸因於 38 店並行或逐店間隔。兩輪自動驗收仍未完成，21:00 尚未到時。

### 22:00 逾時修正上線與重新綁定

[PR #17](https://github.com/ginaz5/lingorm-map/pull/17) 以 squash 合併為
`d58fa9af7199d45a11b790959ecb3287f4811e25`：單次來源請求上限 12 秒改 25 秒，
token GET 僅在逾時時於同一 quote 內重試一次。正式 deploy `6adb684e10879df37c5c2719`
於台灣時間 22:00:08.123 發布，main CI 通過。

換版前未先 disable collector；舊 binding 仍為 enabled 但指向舊 deploy
`6adb4042ae391a294444ba45`，依 deploy 身分檢查不會取價，22:00 沒有 slot receipt。
隨後依維運手冊於 22:02:31.999 disable、22:02:49.447 bind、22:03:06.387 enable，
新 bindingVersion 為 `e3e01df9-fcf8-462e-bbe9-ff7be4e00d35`，quote control
`82980bfd-a934-4aaf-90ac-127d44c2384b` 沿用原值。未人工派送，GitHub 排程開關仍為 false。

綁定前公開 cache 已有 38 店報價，完成於 21:30～21:34，來自舊 deploy 的 21:30 輪次；
本次未讀取該 slot receipt，且不是修正後的程式，不計入新 deploy 的兩輪驗收。

### 22:30 自動排程成功，22:36 只讀確認

slot `1792765800000` 保存真正的 `trigger=schedule` 收據：22:30:38.486 建立，
22:34:42.521 以 `complete` 結束，`exitCode=0`，耗時約 244 秒。
binding 與 deploy 均為上述新值。

- requested=38、sourceSucceeded=38、published=38、failed=0、notAttempted=0、cacheHit=0。
- 來源 HTTP 39 次（1 次 token GET＋38 次 rate POST），全部 200、無 challenge。
  token GET 首次即成功，剩餘有效期 3009 秒，本輪未觸發 token 逾時重試。
- 22:36 公開 cache `enabled=true`，38 個唯一 Slug 的 quote 均完成於
  22:30:44.933～22:34:41.872，已全數取代 21:30 報價；最早到期為 23:35。
- 正式 published deploy 仍為 `6adb684e10879df37c5c2719`，GitHub 排程開關仍為 false。

本回查未請求來源、派送或更動正式控制。這是新 deploy 上第 1 輪成功的自動排程；
23:00 若同樣 38／38 發布，即完成兩輪連續驗收。

### 23:00 自動排程失敗，23:06 只讀確認

slot `1792767600000` 的 `trigger=schedule` 收據：23:00:40.628 建立，23:01:14.451 以
`stopped` 結束，`exitCode=1`。binding 與 deploy 仍為 22:03 的新值。

- requested=38、sourceSucceeded=0、published=0、failed=1、notAttempted=37、cacheHit=0。
- 第一店 `superrich1965-56` 為 `source_unknown`、`reason=invalid_result`，
  收據的 sourceRequestCount=0、無診斷。
- 但公開 cache 有該店本輪的新 quote：attempted 23:00:43.746、completed 23:01:13.498，
  約 30 秒，到期 00:05。來源與發布實際成功，是 runner 事後拒收結果。

推定原因（依程式與時間推得，收據未保留診斷可佐證）：PR #17 的 token 逾時重試使成功的
重試店共 3 次來源請求（token＋token 重試＋rate），但 actions runner 的 `branchResult()`
仍要求 `sourceRequestCount <= 2`、`safeDiagnostics()` 只保留 2 筆，結果被改寫為
`source_unknown`／`invalid_result`，整輪停止。PR #17 的測試只在 anonymous source
層驗證重試，未經過 runner 的結果驗證。

### 23:30 同樣失敗，23:36 只讀確認

slot `1792769400000`：23:30:37.669 建立，23:31:20.657 以 `stopped` 結束，`exitCode=1`，
計數與第一店結果和 23:00 相同（published=0、notAttempted=37、`invalid_result`）。
公開 cache 中 `superrich1965-56` 新 quote 為 attempted 23:30:41.144、
completed 23:31:19.805，約 39 秒，同樣符合 token 逾時後重試成功。

- 23:00 的 `source_unknown` 沒有使共同 source guard 停止派送：23:30 照常開始並取價。
- 其餘 37 店的 22:30 報價已於 23:35 到期；23:36 起公開 cache 只剩 1 店有效 quote，
  直到 10/24 09:00 下一個排程時段都不會補上。
- 正式 published deploy、binding、quote control 均未變，GitHub 排程開關仍為 false。
  本輪回查未請求來源、派送或更動正式控制。

四次正式排程中，20:30、23:00、23:30 三次的第一個 token GET 都逾時；重試在 23:00、
23:30 都成功取得 token。

### 10/23 結論與修正

新 deploy 的三個排程時段為 成功／失敗／失敗，最多連續成功 1 輪，**兩輪連續驗收未通過**。
[PR #18](https://github.com/ginaz5/lingorm-map/pull/18)（`41b0aef`）將 runner 逐店
上限改為 `MAX_BRANCH_SOURCE_REQUESTS = 3`，診斷保留 3 筆，超過 3 仍 fail closed；
新增 runner 單元測試與 Python 端到端整合測試（未修正時重現 `exitCode=1`）。
尚未合併部署。部署前須依維運手冊先 disable collector，部署後 bind／enable 並檢查
source guard 是否留有 unresolved marker，再從 10/24 的排程時段重新進行兩輪驗收。

## 驗證範圍

本機 889 項 Node、14 項 Python 離線測試、strict checkJs 與 Vite build 通過。
前端資產路徑與切換前相同，地點 snapshot 未修改。來源 guard 的 epoch、
blockLevel=2 與既有失敗歷史保留；本輪 timeout 正常更新累計與冷卻，
未 bootstrap、清冷卻或重新啟用 quote control。

完整的控制身分、逐店清理後診斷與公開 cache 見
[結構化證據](../../../evidence/superrich1965-netlify-cutover-2026-10-23.json)。
不保存 HMAC key、PAT、匿名 token、fingerprint 或上游原始 body。

日後正式站再部署或回滾，需按維運手冊先停用 collector，再核對並綁定新 deploy。
長期穩定性與實際跨 token 到期的表現，須依後續真正執行紀錄判斷。
