# SuperRich 1965：Netlify Python 38 店背景實測

日期：2026-10-23（Asia/Taipei）。接續 [單店 Python 實測](superrich1965-netlify-python-probe-2026-10-23.zh-TW.md)，
使用者要求驗證 38 店背景取價。本次是固定全量、不發布報價的實驗，沒有切換正式排程。

## 實際結果

台灣時間 **18:23:56～18:27:25**，Netlify 背景工作完成 38 店全部新取，
總耗時 **209.044 秒（3 分 29 秒）**，超過同步函式的執行時間，工作仍持續正常執行。

| 項目 | 實際結果 |
| --- | ---: |
| 要求／成功分店 | 38／38 |
| 失敗／未嘗試 | 0／0 |
| 快取命中／公開報價發布 | 0／0 |
| 匿名 token GET | 1 |
| 匯率 POST | 38 |
| 總來源 HTTP | 39，全部 200、無 challenge |
| 來源失敗重試 | 0 |
| Token 到期等待 | 0 |

每店 USD 與 TWD 指定面額均通過現有 quote schema／parser；Slug、controlVersion、
branchNo 與 38 個正式 mapping 逐一核對。沒有以其他分店、舊 quote 或快取補足數量。
Mapping 本身仍沿用原審閱結果，來源回應沒有另外證明每家分店身分。

第一個 token 取得時剩 3234 秒有效期，整輪只取得一次 token，沒有經過實際更新邊界。
Token 更新等待的本機整合測試通過，不把這輪成功描述成雲端更新邊界驗收。

完成後重送一次 worker，再重複 start，持久化 job 與 guard 均未變，沒有新增來源請求。
Source guard 的 epoch、paused=false、blockLevel=2 與失敗歷史保留，lease／unresolved
均為空，只有正常完成時推進 nextRequestAtMs。正式部署前後均為
`6ad94882c583f63d0a5bc49b`、commit `e88e8b90d46194faa9f8ca5179efd89655d7c802`，ready。

## 實驗部署與隔離

[獨立 draft／deploy-preview](https://6adb3584957d0c5aa752ede4--lingorm-map.netlify.app)
只有實驗頁面、受短效能力憑證保護的控制端點，以及真正的 Netlify Background Function。
控制端點收到 start 後只發送一次背景工作，HTTP 202 表示接受工作；完成與每店進度
必須以強一致 Blobs 中的工作紀錄確認。

執行環境沿用單店實驗的 Linux x64、Node v24.21.0 與 CPython 3.12.15。
Python runtime 從同一份已驗證 SHA-256 的 python-build-standalone 20261021 原始壓縮檔
解開，保留相對符號連結；不包含 runtime 的 share 資料。第一次複製 runtime 時，
`fs.cp` 將符號連結改成指向本機暫存目錄的絕對路徑，雲端啟動檢查失敗；該部署
沒有發出來源請求。重新解開原壓縮檔並驗證所有連結留在 runtime 目錄內後，才啟動實測。

部署只包含測試 bundle、固定 helper、38 店 mapping、能力憑證的雜湊及獨立 Python。
暫存能力憑證保持本機私有，於台灣時間 20:19:38 到期，不進 Git、靜態頁面、URL 或 log。
原始匿名 token 只存在於背景程序記憶體與子程序 stdin，不寫入任何紀錄。

## 背景執行方式

- `scripts/experiments/netlify-python-background-probe.mjs`：固定走正式 mapping 的
  38 個唯一 Slug，逐店串行、間隔 2～5 秒；整輪預算 12 分鐘。
- `scripts/experiments/netlify-python-background-endpoints.mjs`：提供控制與 worker
  handlers，只有實驗部署的 wrapper 會引用。worker wrapper 設定
  `export const config = { background: true }`；正式 `netlify/functions/` 不新增入口。
- 全店使用同一個 `createAnonymousApiSource()` 記憶體 session 與既有 Python／Safari
  transport、parser、mapping、15 秒來源 deadline。沒有 Node fallback 或來源失敗重試。
- target 使用獨立 deploy store `netlify-python-background-probe` 與獨立 control。
  所有分店都設 `publishQuote:false`，成功報價只記錄在實驗 job 的結果欄位，
  不寫逐店 quote cache；因此測試不會拿先前正式或單店實驗的快取補 coverage。
- 沿用既有 site-wide source guard、CAS lease、unresolved marker 與封鎖冷卻。
  403／429／challenge、未知結果或其他失敗即停止，剩餘分店保持未嘗試。
- 若已知 session token 剩餘不超過 45 秒，於下一店的來源／target lease 建立前
  等到實際到期後 2 秒；等待期間每秒檢查 job ownership 與整輪 deadline。
- 工作只有一次 pending→running 的 CAS claim。平台重送、重複 start 或重複 worker
  都不會重新執行已開始或已結束的工作；失敗不靠重送重啟來源。

Netlify 的背景函式最多執行 15 分鐘，而且失敗可能由平台重送；本實驗以更短的
12 分鐘預算與持久化一次性 claim 限制來源工作，不能以背景呼叫的 202 當作取價成功。
參考 [Netlify Background Functions](https://docs.netlify.com/build/functions/background-functions/)。

## 本機驗證

完整 Node 測試 872 項、Python 離線測試 14 項、專案 strict checkJs、兩個實驗模組
額外的 strict checkJs，以及 Vite build 全數通過。Build 輸出至 `/private/tmp`，
沒有修改 `dist/`。本次新增的 6 項測試涵蓋：

- 38 店全新取價、零 quote 發布與重複工作零來源請求。
- token 真正到期後更新，等待期間沒有 target/source lease，38 店均完成。
- 來源 challenge 立即停止並保留共同冷卻。
- source paused 與工作已到期時零來源請求。
- 缺少憑證、錯誤 site、production context 與過期能力憑證的拒絕。

## 證據範圍

完整來源結果、執行環境、程式 SHA-256、前後 guard 及正式部署身分記於
[結構化證據](evidence/superrich1965-netlify-python-background-2026-10-23.json)。
不得以這次單輪測試宣稱已切換正式取價／排程、Node 22 包裝驗收完成、半小時排程
可靠或長期穩定；token 更新邊界是否經過，必須看實際 token GET 次數與 tokenWaits。
