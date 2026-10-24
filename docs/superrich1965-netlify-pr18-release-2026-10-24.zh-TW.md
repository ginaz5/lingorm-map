# SuperRich 1965：PR #18 正式上線與排程驗收

日期：2026-10-24（Asia/Taipei）。使用者要求將
[PR #18](https://github.com/ginaz5/lingorm-map/pull/18) 上線。
前一日的排程失敗見[10/23 切換紀錄](archive/exchange-rates/releases/superrich1965-netlify-cutover-2026-10-23.zh-TW.md)，
操作依[Netlify 維運手冊](superrich1965-netlify-runbook.zh-TW.md)。

## 修正與驗證

Token GET 逾時後重試成功時，同店可能有 3 次來源請求（token、token 重試、rate）。
原 runner 只接受最多 2 次，會在來源與發布成功後誤判 `invalid_result`，停止其餘分店。
PR #18 將逐店計數與保留診斷的上限一併改為 3，超過 3 仍拒收；
新增逐店結果測試與 Python transport 接線的離線整合回歸測試。

已在 PR head `41b0aef5ebdfc6d48d7d0ae7c51fb874e4f19ea3` 的獨立 worktree 驗證：

- `npm run typecheck` 通過。
- `npm test`：903／903 通過。
- 直接執行 `python3 -B tests/exchange-rates-1965-python-http.test.py` 與
  `python3 -B tests/netlify-python-parallel-http.test.py`：14＋5 項通過。
- `npm run build -- --outDir /private/tmp/lingorm-pr18-release-build` 通過，未改動 `dist/`。
- `git diff --check` 通過。
- Preview `6adb7ac34c4b21db92708848` 為 ready，commit 與 PR head 相同，
  runtime 為 deploy-preview／Node v22.23.2；GitHub CI 與 Preview 建置通過。

## 正式切換

| 項目 | 已核對值 |
| --- | --- |
| 合併時間 | 台灣時間 09:13:08 |
| 正式 commit | `0a2b122517e686e62c239cc176a31f9038eb1f4a` |
| 正式 deploy | `6adc06265e8f3e809c171e29`，ready／production／main |
| 發布時間 | 台灣時間 09:13:37.439 |
| Runtime | Node v22.23.2，production |
| Collector bindingVersion | `28e3191c-b1bb-4eb8-8fde-b0746e61320b` |
| Quote controlVersion | `82980bfd-a934-4aaf-90ac-127d44c2384b`，沿用原值 |
| Source epoch | `4eb55ef8-212f-4bd3-b1b0-ebe760769c26`，沿用原值 |

依序於 09:12:57.901 停用舊 collector、合併 PR、核對新部署，
09:14:45.672 bind、09:15:17.348 enable。新 main 的
[CI](https://github.com/ginaz5/lingorm-map/actions/runs/40048781044) 通過。
合併基底另含 PR #19 的歷史驗收文件，該 PR 僅改兩份文件。

09:15:58 回讀確認 published deploy、runtime、collector binding 一致，collector enabled=true。
正式 quote control 與整份共用 source guard 均與切換前相同；paused=false、
lease／unresolved 均為空，未清除歷史失敗或冷卻。
Netlify 橘標及綠標 cron 均為 UTC `0,30 1-15 * * *`，
GitHub `EXCHANGE_RATES_1965_SCHEDULE_ENABLED` 仍為 false。

公開 cache 的 38 個唯一 Slug 均通過正式 mapping、USD／TWD、controlVersion、時間與期限檢查；
`superrich1965-56` 的單店只讀 API 也通過契約驗證。38 份 quote 與切換前相同，
來自舊 deploy 的 09:00 真正排程，09:04:42.256 完成（38／38、39 次來源 HTTP），
有效至 10:05，**不計入 PR #18 新版驗收**。

這次切換未人工 dispatch、重跑或向 SuperRich 發出額外來源請求。
09:00 slot 已由舊 deploy 使用，保留原收據並等待下一個自動時段。

## 新版排程驗收

新版 09:30、10:00 已連續兩輪成功，**PR #18 的兩輪自動排程驗收通過**。
11:00 追加驗收也通過；已確認 09:30～11:00 連續四輪均為 38／38 新取價與發布。
13:36 再次核對最近三個已到時排程，12:30、13:00、13:30 也全數通過，詳見下方。
兩輪均為真正 `trigger=schedule` 收據；
每輪須 complete／exitCode=0、requested=sourceSucceeded=published=38、
failed=notAttempted=cacheHit=0，並核對公開 quote 與來源請求、token GET 次數。
Token 重試路徑已由離線回歸測試覆蓋；實際排程若未發生重試，不宣稱已實測該路徑。

### 09:30 自動排程成功，09:38 只讀確認

強一致 production site-wide store 的 slot `1792805400000` 已保存新版
`trigger=schedule` 收據：09:30:32.478 建立，09:34:40.679 以 complete 結束，
exitCode=0，耗時 248.201 秒。deployID／bindingVersion 均為本頁的新值，
對應 operation ledger 的終態、exit code 與逐店結果一致。

- requested=sourceSucceeded=published=38，failed=notAttempted=cacheHit=0，replayed=false。
- 來源 HTTP 共 39 次：1 次 token GET、38 次 rate POST，全部 200、無 challenge。
  token 首次即成功，沒有 token 逾時或重試；本輪不能當作實際重試路徑的驗收。
- 09:38:12 公開 cache 有 38 個唯一且有效的正式 mapping quote，USD／TWD 與
  controlVersion 均符合契約。38 店皆屬本輪，完成時間 09:30:38.933～09:34:39.986，
  有效至 10:35，已全數取代舊 deploy 的 09:00 報價。
- 正式 published deploy、runtime、collector binding 與 quote control 均未變。
  source guard paused=false、lease／unresolved 均為空，原 epoch、blockLevel=2 與歷史保留。

本回查沒有來源請求、人工 dispatch 或正式資料變更。10:00 尚未到時，
回查維持 ACTIVE，等待第二輪；兩輪連續驗收尚未完成。

### 10:00 自動排程成功，10:06 只讀確認

slot `1792807200000` 保存第二輪新版 `trigger=schedule` 收據：10:00:36.759 建立，
10:04:41.285 以 complete 結束，exitCode=0，耗時 244.526 秒。
同一個正式 deploy 與 bindingVersion，operation ledger 的終態、exit code、
逐店結果與收據一致；09:30 的持久化收據也與前次保存內容完全相同。

- requested=sourceSucceeded=published=38，failed=notAttempted=cacheHit=0，replayed=false。
- 來源 HTTP 共 39 次（1 次 token GET＋38 次 rate POST），全部 200、無 challenge；
  本輪 token 也首次即成功，兩輪均沒有 token 逾時重試。
- 10:06:44 公開 cache 全部 38 店均屬 10:00 這輪，38 個唯一 Slug 的正式 mapping、
  USD／TWD、controlVersion、完成與到期時間皆有效。完成於
  10:00:42.598～10:04:40.610，全部有效至 11:05。
- Published deploy、runtime、collector binding、quote control 均符合正式預期。
  source guard paused=false、lease／unresolved 均為空，原 epoch、blockLevel=2 與歷史保留。

兩輪共 78 次來源 HTTP（2 次 token GET、76 次 rate POST），均由 Netlify 自動排程執行。
這次只讀驗收沒有人工派送、重跑、額外來源請求或正式資料異動。
兩輪連續驗收通過；token 重試路徑仍以離線回歸測試為證，沒有宣稱本次真實觸發重試。

短期只讀回查原訂於每小時 :06／:36 檢查、最晚 12:06 結束；現在已完成驗收，
已刪除本對話的 `netlify` 回查 automation，避免繼續回查已結案事項。
正常 Netlify 正式半小時排程持續啟用；本次沒有停用或改動網站排程。

### 11:00 追加驗收成功，11:09 只讀確認

使用者要求再驗收 11:00。本次另讀 10:30 收據與 ledger，補齊連續時段的證據：

| 排程時段 | Slot | 建立時間 | 完成時間 | 結果 |
| --- | --- | --- | --- | --- |
| 10:30 | `1792809000000` | 10:30:31.185 | 10:34:36.270 | complete、exitCode=0、38／38 發布 |
| 11:00 | `1792810800000` | 11:00:34.525 | 11:04:40.140 | complete、exitCode=0、38／38 發布 |

兩輪均為相同正式 deploy／bindingVersion 的真正 `trigger=schedule`，
requested=sourceSucceeded=published=38，failed=notAttempted=cacheHit=0，replayed=false；
各輪 operation ledger 的終態、exit code 與逐店結果均符合收據。
每輪來源 HTTP 為 39 次（1 次 token GET＋38 次 rate POST），全數 200、無 challenge，
沒有 token 逾時重試。

11:09:36 公開 cache 的 38 個唯一 Slug 均屬 11:00 這輪，正式 mapping、USD／TWD、
controlVersion 與時間契約均通過。完成於 11:00:41.144～11:04:39.489，
全數有效至 12:05；10:30 的報價已被覆蓋，該輪依持久化收據與 ledger 驗證。
正式 published deploy、runtime、collector binding、quote control 均未變；
source guard paused=false、lease／unresolved 均為空，原 epoch、blockLevel=2 與歷史保留。

已確認 09:30、10:00、10:30、11:00 連續四輪全部成功。
本次僅讀取正式證據並更新本地文件，未人工派送、重跑、額外請求來源或改動正式控制；
未重新建立短期回查。正常 Netlify 排程持續啟用。

### 13:36 最近三個排程均成功

使用者要求再次驗收最近三個排程。13:36:24 選取已到時的最近三個半小時 slot，
於 13:36:26 完成只讀核對：

| 排程時段 | Slot | 建立時間 | 完成時間 | 發布／失敗／未嘗試 |
| --- | --- | --- | --- | --- |
| 12:30 | `1792816200000` | 12:30:31.754 | 12:34:37.486 | 38／0／0 |
| 13:00 | `1792818000000` | 13:00:36.188 | 13:04:32.288 | 38／0／0 |
| 13:30 | `1792819800000` | 13:30:33.454 | 13:34:53.849 | 38／0／0 |

三輪均為原正式 deploy／bindingVersion 的 `trigger=schedule`，status=complete、
exitCode=0，requested=sourceSucceeded=published=38，cacheHit=0、replayed=false。
每輪 38 個唯一 Slug 均符合正式 mapping 且逐店結果為 published；
operation ledger 的終態、exit code 與逐店結果也全數符合收據。
每輪 39 次來源 HTTP（1 次 token GET＋38 次 rate POST）全數 200，
合計 117 次；沒有 challenge、token 逾時或重試。

公開 cache 的 38 個有效 quote 全部屬於 13:30 輪次，mapping、USD／TWD、
controlVersion 與時間契約均通過。完成於 13:30:40.234～13:34:53.202，
有效至 14:35。12:30、13:00 的公開 quote 已被覆蓋，依其持久化收據與 ledger 驗證。
正式 published deploy、runtime、collector binding、quote control 均未變；
source guard paused=false、lease／unresolved 均為空，原 epoch、blockLevel=2 與歷史保留。

本次只驗收這三個 slot，未推定未讀取的 11:30、12:00 輪次結果。
未人工派送、重跑、額外請求來源或改動正式控制，未重新建立短期回查；
正常 Netlify 排程持續啟用。

後續收據與清理後的 cache／guard 證據寫入
[結構化證據](evidence/superrich1965-netlify-pr18-release-2026-10-24.json)。
本地驗收文件不推送、合併或觸發另一個部署。
