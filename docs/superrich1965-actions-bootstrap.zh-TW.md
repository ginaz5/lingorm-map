# SuperRich 1965：獨立 Actions bootstrap

更新：2026-10-21。這份變更從 main `9eeb498112230102c3cb39510247ad445bfb8582`
分出，讓 GitHub runner 能在 PR #8 保持開啟時驗證橘標來源。本文記錄 bootstrap
範圍、本機驗證結果與後續執行順序；本機準備與 mock 驗證沒有真實來源請求。

## 範圍與來源

帶入 20 個執行依賴、手動 workflow、固定 Preview 設定、mock 測試與必要的
package scripts／checkJs 設定。執行程式沿用 PR #8 的 `74b9013` 版本；另包含目前
本機已審閱的 Preview 綁定、target 模組註解及兩項空設定測試修正，沒有另做一套 collector。
部分舊批次 helper 是管理與 query 模組的匯入依賴，沒有獨立的公開入口。

現有前端入口、公開 Netlify Functions、CSV、Netlify 設定、套件版本及綠標排程維持 main
版本。新增的三個 `src/data` 模組僅供 collector 使用，本分支的頁面沒有載入它們。
Workflow 提供手動 inspect／probe／probe-python，以及固定 Preview 單店的 publish-python；
不提供批次發布、排程或 push／PR 自動取價。Python probe 成功與單店發布的後續驗收見
[Python 單店發布文件](superrich1965-python-single-publish.zh-TW.md)。

| 測試身分 | 固定值 |
| --- | --- |
| Target | preview-reviewed |
| Site ID | b5ac142c-7e21-4910-90f7-1719a9d90d5d |
| Deploy ID | 6ad779f97644e6fb5b04b05c |
| Preview branch | codex/superrich1965-on-demand |
| Preview commit | 74b9013494b94201bd0841ee8090f583c7994288 |
| Context | deploy-preview |
| Probe 單店 | superrich1965-58，A04／36 |

驗收使用[固定 Preview 網址](https://6ad779f97644e6fb5b04b05c--lingorm-map.netlify.app/)。
之後 PR alias 即使移往新部署，Actions 仍使用上述固定 deploy；重新綁定須另核對 metadata。
執行紀錄的 collector commit 是 bootstrap main 的實際 `GITHUB_SHA`，與 Preview commit 分開。

## Bootstrap 前的遠端準備紀錄

- `superrich1965-preview` Environment 已建立，只允許 main branch。
- Environment Variable `NETLIFY_SITE_ID` 已設定；Secret `NETLIFY_AUTH_TOKEN` 已確認存在。
  GitHub 不回傳 Secret 值，PAT 的實際存取權限與到期日仍待驗證，不把值放進命令或文件。
- 10 個退役前橘標測試部署的來源 control 已停用，原 breaker／gate／job 保留。
- 共用 source guard 保持 paused；沒有 lease 或未結案來源。blockLevel=1 與原
  blockedUntil=`2026-10-19T20:50:01.138Z` 均保留，歷史冷卻過期也不清除升級層級。
- 新 Preview target control 尚未建立；公開 API 只讀，不能由訪客請求自行啟用。
- 正式站發布基準為 deploy `6aba5d63729551000809bfa5`、commit
  `9eeb498112230102c3cb39510247ad445bfb8582`。

2026-10-21 已在本機使用既有管理憑證執行只讀 inspect，exitCode=0、outcome=inspected。
Preview 的 site／deploy／branch／commit／context 全部符合設定，metadata state=ready；
target enabled=false、controlVersion=null，guard paused=true、blockLevel=1、unresolved=false，
sourceRequestCount=0、published=0。這次沒有使用 GitHub Environment 的專用 PAT，不能用
本次成功取代該 PAT 驗收。這次本機檢查時專用 Secret 只確認存在，遠端只有 CI Test；
GitHub 專用 PAT 由 main bootstrap 後的 workflow 另行驗證。inspect 本身僅驗讀取，
不能單獨證明寫入權限或 token 到期日。

## 2026-10-21 遠端驗證結果與目前限制

Bootstrap 已由 [PR #9](https://github.com/ginaz5/lingorm-map/pull/9) 合併至 main
`01c546af5b13cd88dd4b15e82f3da426f99d51c4`，最終訊息包含 `[skip netlify]`。
[Inspect run](https://github.com/ginaz5/lingorm-map/actions/runs/39587382696) 通過，
確認 GitHub Environment 專用 PAT 能讀取 Preview metadata 與 Blobs。

[Node probe run](https://github.com/ginaz5/lingorm-map/actions/runs/39588494049)
在匿名 token GET 收到 HTTP 403、`cf-mitigated: challenge`；只有 1 個來源請求，
沒有取得 token、沒有 rate POST、沒有發布報價。實際寫入 job／operation／guard／gate
已驗證，quote CAS 發布權限與 PAT 到期日仍未驗證。正式站 published deploy 未變。

共用 guard 保留原 sourceEpoch，blockLevel 由 1 升為 2，blockedUntil 為
`2026-10-22T10:58:50.276Z`（台灣時間 **10/22 18:58:50**）；probe 後已 paused，
lease 與 unresolvedAttempt 均已結清。固定 Preview control 已啟用。執行前仍須只讀
查最新狀態，不以這份紀錄代替即時 preflight。

已知舊版 branch／run 摘要可能只顯示 target 的 6 小時 retryAt，共用 guard 實際是
24 小時；目前以 `source-status` 的 blockedUntil／paused 為準，不依較短摘要重試。

## Python＋Safari 單店驗證

`probe-python` 使用 Python 標準函式庫 `urllib.request` 和
[ThaiCash 固定版本的 Safari 17 UA 與 headers](https://github.com/mrfartman77/thaicash-data/blob/cafce7f3bbd20d77306a82364e61f349a4e2e45e/scrapers/booth_rates.py#L27)。
Token GET 只設 UA；rate POST 設 UA、Bearer、JSON、Referer，不額外送 Accept。
POST body 以 Python `json.dumps` 序列化，固定 A04／36。這是 HTTP client 實驗，
不代表實際啟動 Safari，也不能由一次結果推定 Cloudflare 的封鎖原因。

JS 沿用既有 token 驗證、USD 100-50／TWD 1000-100 解析、control、lease、common guard、
breaker 與操作 ledger；Python 只負責單次 HTTP。新模式只能對固定 Preview 做 single
probe，不發布、不批次、不自動回退 Node；模式也固定於操作身分，同一 run 不能換 client 重跑。
Python 子程序不繼承 PAT／proxy 環境，token 只經 stdin，沒有額外套件；沿用 12 秒
請求 timeout／15 秒來源 deadline。與 ThaiCash 預設不同，本專案仍明確禁止 redirect、
proxy、cookies 與 retry，保留 TLS 驗證。403／429／challenge 立即保留診斷並停止，不讀 HTML。

先執行完全離線測試：

```bash
python3 -I -B tests/exchange-rates-1965-python-http.test.py
node --test tests/exchange-rates-1965-python.test.mjs tests/exchange-rates-1965-actions-integration.test.mjs
npm run typecheck
npm test
npm run build
```

Workflow 使用 runner 的 `python3`，會先記錄 Python 版本並跑上述 Python mock 測試，
該步驟不載入 Netlify Secret。CI 也執行 Python 離線測試。

真實測試須待此變更經審閱進 main，並且既有冷卻到期、人工確認 guard 可以恢復後，
才在 workflow 選 `probe-python`。先選 inspect 核對固定 Preview 與最新 common guard，
不偽造本機 GitHub 身分、不清除冷卻或升級歷史。成功標準與原 probe 相同：兩階段 200、
sourceValidated=true、replayed=false、sourceRequestCount=2、published=0。遇 challenge
立即停止並檢查共用 guard；blockLevel=2 再遇封鎖會升至下一階段的停用保護。

以下 Python 驗證結果只涵蓋本機與 mock，真實來源 probe 的結果須另行記錄。
本次驗證：636 項 Node 測試、12 項 Python 測試、strict checkJs、Vite build、Functions
build、兩份 workflow 的 YAML／Bash 語法皆通過。前端輸出與 bootstrap 基準逐檔相同，
4 個公開 Function 封包皆沒有橘標 collector 或 Python 檔案。以既有本機管理憑證再次
執行新版 CLI 的只讀 inspect，固定 Preview metadata 符合設定、來源請求數為 0，
共用 guard 仍 paused、blockLevel=2、unresolved=false，冷卻期限未變。這不是專用 PAT
的再次驗證，也不代表來源已恢復可用。

## 本機驗證

```bash
npm run typecheck
npm test
npm run build -- --outDir /private/tmp/lingorm-bootstrap-candidate-dist --emptyOutDir
netlify functions:build --src netlify/functions --functions /private/tmp/lingorm-bootstrap-functions-build
```

來源測試全部使用 fake fetch／clock／store。另驗 workflow YAML／Bash、公開入口的依賴
隔離，以及 import CLI／建立匿名 session 時沒有 HTTP。前端產物與同一 main 基準逐檔
比較；Functions manifest 應只有 config、locations、exchange-rates、exchange-rates-fetch，
且封包沒有橘標抓取檔案。本次 617 項 Node 測試、typecheck、Vite build、Functions
打包與 YAML／Bash 檢查均通過；前端產物與 main 基準逐檔相同，4 個 Function 封包
沒有橘標檔案。這些結果不代表已驗證 GitHub runner、PAT 權限或來源網路。

## 後續 bootstrap 與首次驗收

以下為本機驗證完成後的執行順序。提交／推送、開新 PR 與 main 合併按使用者授權進行，
保留 PR #8 開啟。

1. 將這份獨立變更送審，通過 CI 與必要的 Deploy Preview 驗收。
2. **最終進 main 的 squash／merge commit message** 包含 `[skip netlify]`，保留 GitHub CI。
   合併後核對實際 main commit 與 Netlify published deploy，確認正式發布基準未變。
3. 從 main 執行 `SuperRich 1965 manual verification`，先選 inspect。它驗 metadata／store
   讀取權限與狀態，來源請求數應為 0；control disabled／missing 與 guard paused 符合目前準備狀態。
4. 在已設定專用憑證的管理 shell 核對舊來源停止與冷卻，啟用固定 target、恢復 guard，
   再從 main 建立新的單店 probe run。CLI 不自動載入 `.env`；不偽造 GitHub 執行身分。

```bash
npm run fx:1965:actions:control -- status --target preview-reviewed
npm run fx:1965:actions:control -- source-status --target preview-reviewed
npm run fx:1965:actions:control -- enable --target preview-reviewed
npm run fx:1965:actions:control -- source-resume --target preview-reviewed
```

Probe 需 outcome=complete、sourceValidated=true、replayed=false、sourceSucceeded=1、
published=0；冷 session 的 token／rate 兩階段都 200，共 2 個來源請求，並通過 USD 100-50
與 TWD 1000-100 指定買入價解析。合法 cache hit 或歷史 replay 不算來源成功。
第一次 probe 會驗 job／guard 的實際寫入；inspect 成功不能單獨證明寫權限。

任一階段 403／429／challenge 都停止並保留冷卻；取消後結果不明則保持 paused，先查
source-status，不刪 guard 或換 target 重跑。此階段 probe 不發布 quote，Preview 頁面仍可能
沒有報價；通過後才另行接入單店發布，再驗 pilot／38 家及排程。

`[skip netlify]` 只影響該次部署事件，不能當成持續鎖住正式站。PR title 的標記只處理
Preview，不能代替最終 main commit 的標記；下一個未標記 commit 仍可能部署所有既有變更。
見 [Netlify 官方 skip 規則](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/#skip-a-deploy)
與 [GitHub 手動 workflow 條件](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。

## 日後整合 PR #8

PR #8 可繼續測試其前端與只讀 API。Bootstrap 進 main 後，整合時保留單一 collector 版本，
特別核對 package scripts、jsconfig 與其精確陣列測試；target 設定、兩項空設定測試及
target 模組註解與 PR #8 原提交不同，可能有 add/add 衝突。README／技術決策的新增段落
也應一起保留。不要為了處理衝突回復空 target、舊來源入口或搬動既有冷卻。
