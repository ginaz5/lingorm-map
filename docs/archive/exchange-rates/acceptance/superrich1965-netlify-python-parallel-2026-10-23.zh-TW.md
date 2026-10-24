# SuperRich 1965：38 店平行取價實驗

> 歷史文件，於 2026-10-24 封存。保留當時的設計、操作與驗收結果；其中的部署狀態、待辦與指令不代表現行流程。維護請從[現行文件索引](../../../README.md)開始。


日期：2026-10-23（Asia/Taipei）。使用者針對正式首輪第 19 店 timeout，明確要求
測試「38 店同時平行取價」。本實驗只取價並保存清理後證據，不發布網站報價，
也不把正式逐店 collector 改成平行執行。

## 真正 Netlify 實測結果

台灣時間 **20:13:38.977～20:13:48.582**，38 店平行取價全數成功。

| 項目 | 實測結果 |
| --- | ---: |
| 要求／成功／失敗／未嘗試 | 38／38／0／0 |
| 工作紀錄耗時 | 9.605 秒 |
| 最大同時在途數 | 38 |
| 38 店啟動時間差 | 2 毫秒 |
| Token GET | 1 次，HTTP 200，833 毫秒 |
| Rate POST | 38 次，全部 HTTP 200 |
| Rate 階段從第一店啟動到最後一店回完 | 7.441 秒 |
| 單店最短／中位／最長耗時 | 3.853／7.294／7.440 秒 |
| 總來源 HTTP | 39 次，全部 200、無 challenge |
| 失敗重試／快取命中／正式報價發布 | 0／0／0 |

最大在途數以每店「開始至完成」時間區間重新計算，不只讀 concurrency 設定。
工作紀錄耗時從背景工作開始至結果產生，不含先前的派送等待及後續來源鎖釋放。
38 個唯一 Slug 與正式 mapping 相符，每店 USD／TWD 指定面額均通過既有 quote
schema；來源回應的分店對應仍依既有 mapping，不把 caller echo 當作上游身分證明。

完成後重送同一 start，回 `replayed=true`，工作內容與 guard 均未變，
來源請求數仍為 39。共同 sourceEpoch、blockLevel=2 與歷史冷卻保留，
paused=false，lease／unresolved 均為空。一次性實測回查已設為 PAUSED。

正式部署與 collector binding 保持原值，實驗前後公開 cache 的 quote 陣列相同。
先前正式報價此時已自然過期，因此公開 cache 前後均為 0 店；實驗結果只保存在
獨立工作紀錄，沒有用這批測試報價補正式 cache。正式定時驗收仍由原只讀回查繼續。

這一輪證明 Netlify 的 Python 38 路平行能完成全店取價；沒有經過實際 token 更新
邊界，也尚未把這個模式加入正式發布與排程流程。

## 設計

- 同一個 Python 程序先取得一次匿名 token，再以 38 個 thread 同時發出固定
  mapping 的 38 次分店 rate POST；不是一個 API 回傳全分店，也不是 38 次 token GET。
- 每個 thread 使用獨立 opener、原有 Safari headers、TLS 驗證、禁止 redirect、
  12 秒 socket timeout 與 body 上限；父程序另限制 token／rate 階段各 15 秒。
- token 僅留在 Python 記憶體。Node 在記憶體解析每店 body，沿用現有精確
  USD／TWD 面額 parser、1e6 整數與 quote schema，丟棄原始 body 及額外欄位。
- barrier 等 38 個 worker 都準備完成才一起送出；紀錄各店開始／結束、HTTP、
  錯誤、啟動時間差與最大同時在途數，不能以設定 concurrency=38 代替觀測結果。
- 不重試失敗請求。38 個請求已同時送出時，收集所有在途結果；其中一店失敗
  不再使其他已送出的請求被列為「尚未嘗試」。token 階段失敗則不送任何 rate POST。

## 共用來源保護與隔離

獨立 deploy store `netlify-python-parallel-probe` 先以 CAS 建立一次性工作，明確
記錄全部 `plannedSlugs`，再取得既有 site-wide source guard 的一把排他 lease。
保留相同 sourceEpoch、blockLevel、冷卻及 failure history，不修改 guard schema。

現有 guard marker 的 `slug` 是該批第一店的 anchor，並非只有該店在途；
`operationId` 明確標為 `netlify/parallel-38/...`，可對應持久化工作中的完整 38 店。
整批結案以前不釋放 lease，因此其他正式／Preview／GitHub collector 都不能重疊取價。
token 完成後、fan-out 前，父程序再檢查 job ownership、來源 lease、paused 與冷卻。

一般失敗依既有規則記錄一次批次失敗；任一已知 403／429／challenge 沿用共同
breaker 及 Retry-After。若子程序終態不明，保留 unresolved anchor、paused=true 與
完整批次工作，需審閱整批後才能按既有流程結案，不假裝只有 anchor 店可能已送出。
成功不清除舊失敗或 blockLevel。實驗從不寫正式 quote control、逐店 cache 或 snapshot。

## 本機與部署驗證

本機 896 項 Node、19 項 Python 離線測試、專案及實驗 strict checkJs、Vite build
全部通過。新增測試證實 38 個模擬 opener 真正重疊、每店參數正確、只取一次 token、
逾時不重試、共用鎖擋下其他來源、冷卻／pause 零來源、重播零來源、未知結果保留
marker，以及原始 body 額外欄位不進工作紀錄。

獨立 draft `6adb4739c98e5d4a2c5770cc` 已確認 Linux x64、Node v22.23.2、
CPython 3.12.15 可啟動。固定 Python 壓縮檔 SHA-256 與 9 個相對符號連結已核對。
第一個 draft `6adb46721270891885b01b37` 遺漏 SDK bundle，啟動失敗、零來源；
重新完整 bundle 並本機驗證可 import 後，才建立目前的獨立部署。

正式首輪留下的冷卻至台灣 20:12:21.013；實驗另限制最早 20:12:23，短效能力憑證
於 21:15 到期。雲端提前 start 測試回 `503 before_test_window`、來源請求 0，
之後 status 仍為 `not_started`，沒有消耗實驗工作。

來源實測在原冷卻自然結束後只執行上述一輪，沒有清冷卻、改控制或重新部署重跑。
結果由持久化工作、逐店來源診斷與 quote schema 核對，不以離線測試或 HTTP 202
代替真正來源成功。

實驗檔案在 `scripts/experiments/netlify-python-parallel-*`，正式函式沒有 import。
私有短效憑證與一次性啟動工具只存本機暫存資料夾，不進 Git、URL 或靜態頁面。
已核對的部署身分、來源保護及程式雜湊見
[結構化證據](../../../evidence/superrich1965-netlify-python-parallel-2026-10-23.json)。
