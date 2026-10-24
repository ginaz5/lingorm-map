# SuperRich 1965：Netlify Python 單店實測

> 歷史文件，於 2026-10-24 封存。保留當時的設計、操作與驗收結果；其中的部署狀態、待辦與指令不代表現行流程。維護請從[現行文件索引](../../../README.md)開始。


日期：2026-10-23（Asia/Taipei）。使用者要求驗證 Python 能否在 Netlify 取得橘標報價，
不能把先前 Node fetch 的 403 challenge 視為所有 Netlify 傳輸方式都失敗。

後續同日已完成 [38 店 Netlify Python 背景實測](superrich1965-netlify-python-background-2026-10-23.zh-TW.md)：
全數新取成功、39 次來源 HTTP、耗時 3 分 29 秒、未發布報價或切換排程。
以下保留單店階段的實測範圍與當時尚未完成的項目。

## 結果

台灣時間 12:44:28～12:44:31，在 Netlify 的獨立 draft／deploy-preview 執行
Python 3.12.15 標準函式庫與既有 Safari User-Agent helper。固定只查
`superrich1965-58`（A04／36），結果為 `probe_succeeded`。

| 階段 | 結果 |
| --- | --- |
| 匿名 token GET | HTTP 200，JSON，無 challenge |
| 單店匯率 POST | HTTP 200，JSON，無 challenge |
| 指定 USD `100-50` 買入價 | 33.63，現有 parser 通過 |
| 指定 TWD `1000-100` 買入價 | 1.030，現有 parser 通過 |
| 來源 HTTP | 2 次，沒有重試 |
| 公開報價發布 | 0 |

以上是測試當時的報價，不代表持續有效。來源回應沒有自行證明分店身分，
本次沿用已審閱 mapping，沒有另外證實其他分店的對應。

[測試部署](https://6adae5e504bbc25f76b8a22f--lingorm-map.netlify.app)只有實驗頁面與
受能力憑證保護的 probe，沒有地圖或公開取價按鈕；不是正式網站版本。
[結構化證據](../../../evidence/superrich1965-netlify-python-probe-2026-10-23.json)記錄 HTTP
diagnostics、執行環境、原有保護狀態及正式部署前後身分，不含 token、Cookie、
Authorization、測試能力憑證或原始來源 body。

## 執行方式與限制

Netlify 測試環境為 Linux x64、Node v24.21.0，原生沒有 `python3`。
因此將 Astral 的
[python-build-standalone 20261021](https://github.com/astral-sh/python-build-standalone/releases/tag/20261021)
之 CPython 3.12.15 Linux x86_64 GNU stripped runtime 一併打包，下載後核對 GitHub
release asset 公布的 SHA-256：

`6d7521138fd33afddc1ccd08abb007d9a2829e38117c2576f9efdc0ec73ce772`

保留 TLS 憑證與主機名稱驗證，以系統 CA bundle 提供信任根，沒有 proxy、redirect
或來源 fallback。略去 runtime 的 share 資料；其 terminfo 名稱在 macOS 的大小寫
不敏感檔案系統產生符號連結衝突，該資料不參與 HTTPS helper。

使用既有 `createPythonSafariFetch()`、`createAnonymousApiSource()`、
`queryBranchRates()`、指定面額 parser 與固定 mapping。僅將子程序執行檔改為
隨函式部署的 Python，並明確打包 helper 與其 mapping JSON；沒有修改正式來源程式。

最初兩個 runtime-only draft 分別遇到 SDK 打包缺漏及預先打包 ZIP 的串流 metadata
問題，均未發出來源請求。改由 CLI 正常部署已合併依賴的函式來源後，先實測確認
原生 Python 缺失，再部署帶獨立 Python 的版本，才執行此次真實來源 probe。

測試使用獨立 draft store、獨立啟用控制與 `publishQuote:false`，不寫正式 quote
store。共用既有 site-wide source guard、CAS lease、冷卻及 unresolved marker；
測試前 guard 可用，測試後 lease／unresolved 均為空，sourceEpoch、paused=false、
blockLevel=2 與失敗歷史均保留，僅正常推進 nextRequestAtMs。

入口限定固定 site、非 production context、POST、短效能力憑證與固定單店，
能力憑證於台灣時間 14:35:44 到期。持久化 one-shot CAS 在來源前消耗測試操作；
重播相同 probe 回傳原結果，沒有再次執行取價。測試結果本身只存於實驗 namespace。
暫存測試程式及打包產物留於 `/private/tmp/lingorm-netlify-python-probe-20261023`；
其中能力憑證為私有檔，不能直接複製或提交整個目錄。

## 驗證與後續

- Node 測試 866 項、Python 離線測試 14 項、strict checkJs、Vite build 全數通過。
  Build 輸出至 `/private/tmp`，沒有修改 `dist/`。
- 本機驗證錯誤憑證／GET／錯誤 site／production／錯誤 action 均拒絕，runtime
  檢查不發來源請求；部署後確認獨立 Python 實際可執行。
- 重播結果逐欄相同；正式部署前後均為 `6ad94882c583f63d0a5bc49b`、
  commit `e88e8b90d46194faa9f8ca5179efd89655d7c802`，ready。
- 沒有新增或切換任何排程、合併 main、發布正式報價、重置 breaker 或輪替 guard。

這次證實「Netlify＋Python」單店可行。先前 Node 與本次 Python 測試日期不同，
沒有同時同出口的對照，不能把原失敗完全歸因於 Node fetch；也尚未驗證現有正式
Node 22 環境下的包裝、38 店全量、token 更新邊界、Background Function、正式排程
或長期穩定性。若後續把取價搬回 Netlify，須另做上述分階段驗收。
