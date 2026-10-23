# SuperRich 1965：Netlify 正式排程切換驗收

日期：2026-10-23（Asia/Taipei）。使用者已授權 Preview 通過後直接切換正式排程。
[PR #16](https://github.com/ginaz5/lingorm-map/pull/16) 已合併，操作方式見
[Netlify 維運手冊](superrich1965-netlify-runbook.zh-TW.md)。

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

Netlify collector 保持啟用，GitHub 自動排程保持停用；下一個可取價的排程時段為
20:30。20:30、21:00 的實際自動完成收據與全店 cache 尚待觀測，
沒有以 HTTP 202、已註冊 cron、Preview 成功或人工輪次代替完成驗收。

本對話已啟用短期只讀回查，於每小時 :06／:36 檢視持久化收據與公開 cache，
不人工派送或更動任何正式控制。兩輪完成或出現新的失敗／具體阻礙時回報並停用回查；
最晚 23:45 結案。這個回查與網站的 Netlify 取價 cron 是兩個不同的工作。

## 驗證範圍

本機 889 項 Node、14 項 Python 離線測試、strict checkJs 與 Vite build 通過。
前端資產路徑與切換前相同，地點 snapshot 未修改。來源 guard 的 epoch、
blockLevel=2 與既有失敗歷史保留；本輪 timeout 正常更新累計與冷卻，
未 bootstrap、清冷卻或重新啟用 quote control。

完整的控制身分、逐店清理後診斷與公開 cache 見
[結構化證據](evidence/superrich1965-netlify-cutover-2026-10-23.json)。
不保存 HMAC key、PAT、匿名 token、fingerprint 或上游原始 body。

日後正式站再部署或回滾，需按維運手冊先停用 collector，再核對並綁定新 deploy。
長期穩定性與實際跨 token 到期的表現，須依後續真正執行紀錄判斷。
