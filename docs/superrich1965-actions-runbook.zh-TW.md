# SuperRich 1965：Actions 抓取與 Netlify 快取維運

更新：2026-10-22。Netlify 橘標 API 只讀快取，GitHub Actions 以 Python／Safari
匿名取價，JS 管理 token、parser、mapping、lease、source guard 與發布。
Chromium、Netlify 橘標背景來源入口與兩個 FETCH_MODE／SOURCE_TRANSPORT 開關已退役。

## 現行入口與驗收證據

Preview 五店 [39617098664](https://github.com/ginaz5/lingorm-map/actions/runs/39617098664)
全新取價／發布，6 次來源 HTTP；後續全店
[39618515018](https://github.com/ginaz5/lingorm-map/actions/runs/39618515018) 新取／發布 33 店、
cacheHit 5 店，34 次來源 HTTP，總覆蓋 38 店有效 USD／TWD。全部 HTTP 200、無 replay，
兩個 API 與快取一致；中英文、列表、HERE popup、USD／TWD 排序通過。
舊 quote 已按原期限到期。PR #8 已於台灣時間 2026-10-22 07:19 合併並部署正式站；
main `e88e8b90d46194faa9f8ca5179efd89655d7c802`、production deploy
`6ad94882c583f63d0a5bc49b` 已核對。專用 PAT production inspect
[39693020146](https://github.com/ginaz5/lingorm-map/actions/runs/39693020146)
為零來源／零發布；正式單店
[39693213469](https://github.com/ginaz5/lingorm-map/actions/runs/39693213469)
新取及發布 1 店、2 次來源 HTTP；正式五店
[39693450584](https://github.com/ginaz5/lingorm-map/actions/runs/39693450584) 新取／發布 4 店、
cacheHit 1 店、5 次來源 HTTP。兩輪 quote／只讀 API 與零讀取副作用驗收通過。
正式全店 [39694052646](https://github.com/ginaz5/lingorm-map/actions/runs/39694052646)
跨過刷新邊界，38 店全新取／發布、0 cache hit、39 次來源 HTTP、sourceValidated=true，
38 店 API／quote 比對及零讀取副作用通過。正式 Google 地圖、popup、中英文及
USD／TWD 排序已實測，HERE 的隔離及離線到期範圍詳見
[正式上線紀錄](superrich1965-production-release.zh-TW.md)。
人工全店完成後先 pause；台灣時間 2026-10-22 07:41 已核對排程開關為 true、
guard resumed、無 lease／unresolved，control／epoch／blockLevel=2 均不變。
排程已啟用，首兩輪預定台灣時間 09:00／09:30，實際 schedule 結果仍待驗收。

沿用 main-only Environment `superrich1965-preview` 與既有專用 PAT Secret、site ID
variable。名稱沿用，實際可供兩個明確 target；不代表 PAT 只限單一 store。
不以本機日常 `.env` 管理 token 取代 workflow 專用 Secret，不輸出任何 token。

`preview-reviewed` 仍綁定 immutable Preview；新 PR deploy 不繼承舊快取。
`production` 固定 site／main／production，`commitPolicy: environment-reviewed` 由該
Environment 的 `EXCHANGE_RATES_1965_PRODUCTION_COMMIT` 綁定已核對、實際發布的完整
小寫 40 字元 SHA。缺少或不符便停止；網站換版後須核對並更新綁定。正式每店開始及
發布前重新核對部署。Workflow commit 與網站 target commit 分別記錄，不能自動推導。

| action | 固定範圍 | 發布 |
| --- | --- | --- |
| inspect | 身分／control／guard | 否，零來源零寫入 |
| probe-python | superrich1965-58（A04／36） | 否 |
| publish-python | 同上單店 | 是 |
| publish-five-python | 58、56、57、59、60 | 是 |
| publish-all-python | mapping 全部 38 店 | 是 |

Workflow 的 `target` 明確選 `preview-reviewed` 或 `production`，預設仍是 Preview。
正式只接受 Python 取價；禁止任意 URL、slug、scope、force 或 checkout ref。
例如以下指令必須逐輪驗收後才執行下一個，不能直接整組連跑：

```bash
gh workflow run exchange-rates-1965.yml --repo ginaz5/lingorm-map --ref main -f action=inspect -f target=production
gh workflow run exchange-rates-1965.yml --repo ginaz5/lingorm-map --ref main -f action=publish-python -f target=production
gh workflow run exchange-rates-1965.yml --repo ginaz5/lingorm-map --ref main -f action=publish-five-python -f target=production
gh workflow run exchange-rates-1965.yml --repo ginaz5/lingorm-map --ref main -f action=publish-all-python -f target=production
```

## 正式切換與排程

1. 整合 main，重跑測試、checkJs、Vite／Functions、CSV／收藏／mapping 與新版 Preview。
2. 正式上線合併不加 `[skip netlify]`，核對 ready／main／production／實際 SHA 及只讀 API。
3. 綁定正式 SHA，使用專用 PAT 跑 production inspect；排程開關仍為 false／未設定。
4. 備份正式 control／breaker／gate／job／cache 與共用 guard，建立獨立正式 control。
   不搬 Preview quote／control，不重標時間，不重新 bootstrap source guard。
5. 冷卻已到期、無來源工作／lease／unresolved 才 source-resume。人工單店→五店→全店，
   每輪結束先 source-pause。如實記錄新來源／發布／cacheHit，不清快取強迫重抓。
6. 驗 38 slug、指定面額、版本、有效期、cache GET 與 38 branch POST；讀取前後狀態一致。
   驗中英文、列表、Google／HERE popup、排序及到期撤價，不能只以 green workflow 驗收。
7. 人工驗收通過才開排程並恢復 guard，再核對至少兩輪實際 schedule 的來源／發布／coverage。

Repository variable `EXCHANGE_RATES_1965_SCHEDULE_ENABLED` 必須明確為 `true`；job 與 CLI
兩層檢查，預設不執行。Schedule 固定 production／`publish-all-python`，核對 repo、main
及 UTC cron `0,30 1-15 * * *`（泰國 08:00～22:30，每天 30 輪）。預定觸發可能延遲。
手動 dispatch、純 cache hit 或歷史 replay 不能代替真實定時取價驗收。

管理命令使用 `node --env-file-if-exists=.env scripts/exchange-rates-1965-actions-control.mjs`
加上 `status|enable|source-status|source-resume|source-pause --target production`；正式 target
另須先設定已核對的公開 SHA 環境變數。停用為 `disable --target production --reason manual`。

串行來源間隨機等 2～5 秒、token 僅存記憶體，保留 12 分鐘應用／20 分鐘 job、共用
concurrency、lease、CAS、取消與 ledger。每店成功獨立發布，失敗停止，舊 quote 保留到期。
共同 sourceEpoch、blockLevel=2 與冷卻歷史保留，成功不清升級；403／429／challenge
可能升第 3 級暫停。Unknown 不因租約到期解鎖，不重試或換 runner／介面來繞過保護。

緊急先關排程並 source-pause；報價內容有疑慮時 disable production control 撤價。
網站回滾不會停 Actions 或還原 site-wide Blobs，須另操作上述控制。保留冷卻與 ledger，
不恢復退役的 Netlify 來源入口。Bootstrap 的 `[skip netlify]` 只略過該次部署。
如正式部署已失配，source-pause 可使用仍通過 metadata 核對的 `preview-reviewed`；
共同 guard 與 target 無關。不要為了讓管理指令通過而將正式 SHA 綁到未審閱部署。

參考：[GitHub schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)、
[Netlify deploy](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)。

## 原 2026-10-21 準備歷史

以下僅保留 bootstrap 前的準備紀錄；「尚未驗收／無 publish」等當時描述已由上方現況取代。

## 已完成與目前預設

- 新增 `fx:1965:actions`：inspect／probe／publish，以及獨立的 actions:control 管理工具。
- 新 workflow 只接受手動 inspect／probe，不提供 publish、push／PR 自動抓價或 schedule。
- `config/exchange-rates-1965-actions-targets.json` 目前只設定已核對的 preview-reviewed；
  任何未設定 target 都在讀 credentials、Netlify metadata 或來源之前失敗，不回退 production。
- CLI 不自動載入 `.env`，避免默用日常管理 token。遠端設定時使用專用、有到期日的 PAT；
  憑證只放專用執行環境或 GitHub Environment，不放設定檔、命令參數或對話。
- 用戶已同意日後沿用泰國 08:00～22:30 每半小時更新；目前不啟用排程，夜間報價仍按期撤下。

## PR #8 本次準備紀錄

- Preview deploy ID：`6ad779f97644e6fb5b04b05c`，context：`deploy-preview`。
- Branch：`codex/superrich1965-on-demand`；commit：`74b9013494b94201bd0841ee8090f583c7994288`。
- 固定測試網址：[此部署的 Preview](https://6ad779f97644e6fb5b04b05c--lingorm-map.netlify.app/)。
  PR alias 若因後續 push 指向其他部署，Actions 仍寫入上述固定部署，須使用固定網址驗收，
  或另行核對後重新綁定。
- 快取 GET 回 200、空 quotes；單店 `superrich1965-58` POST 回 503 unavailable、
  Retry-After 60，沒有建立 control、breaker、gate 或 job，也沒有來源請求。
- `superrich1965-preview` Environment 已建立，deployment branch policy 只允許 main；
  `NETLIFY_SITE_ID` 已設定，`NETLIFY_AUTH_TOKEN` Secret 已確認存在。
  GitHub 不回傳 Secret 值，PAT 的實際權限與到期日仍須後續驗證。
- 已查核並停用本分支全部 10 個退役前 Preview／branch 部署的來源 control。
  操作只 CAS 寫 control；原 breaker、gate、job 逐一比對未變。未使用會重設 breaker
  歷史的一般 disable 流程。正式站目前部署不含橘標來源入口，正式 control 未修改。
- 共用 source guard 已建立，保持 paused、沒有 lease 或 unresolved attempt；保留
  blockLevel=1 與原 blockedUntil=`2026-10-19T20:50:01.138Z`，不因歷史冷卻已過期而清除。
  一次性退役及 paused bootstrap 使用既有本機管理憑證，未將該憑證移交 GitHub；
  Actions 使用使用者另設的專用 PAT Secret，實際存取權限仍待 runner inspect 驗證。
- 正式發布基準：deploy `6aba5d63729551000809bfa5`、commit
  `9eeb498112230102c3cb39510247ad445bfb8582`。尚未合併 PR #8、推送 main 或啟動新部署。
- 使用者已決定保留 PR #8 開啟，先不合併；下節的 main 合併 bootstrap 尚未授權。
  目前 main 只有既有 CI Test，不能沿用它直接執行新 collector。若要在 PR #8 保持開啟時
  做 GitHub runner 來源驗證，須另行審閱獨立 bootstrap 方案；不自行放寬 main-only
  Environment、執行身分檢查，或偽造 GitHub 環境變數。本次 6 個檔案變更尚未 commit／push。

## 先完成本機審閱

```bash
npm run typecheck
npm test
npm run build
netlify functions:build --src netlify/functions --functions /private/tmp/lingorm-actions-functions-build
```

測試使用 fake fetch／clock／store，不發真實 SuperRich 請求或改正式 Blobs。
另外檢查 workflow YAML、Bash 語法、固定 action SHA、main／Environment 限制；
本機語法檢查不代表 GitHub 實際執行已通過。

本次驗證：794 項 Node 測試、typecheck、Vite build、Functions 打包通過；
workflow YAML／Bash 與文件連結檢查通過。全部來源流程使用 mock，未執行遠端 workflow。

目前未設定 production target，下列只讀命令預期以 `target_not_configured` 失敗：

```bash
npm run fx:1965:actions -- inspect --target production
```

這是 fail-closed 驗證，不能當作來源或 Blobs 網路成功。

## 不部署正式網站的 workflow bootstrap

GitHub 的 workflow_dispatch 要求 YAML 已存在 main。依本專案的自動部署設定，
一般合併 main 也會部署正式網站，因此 bootstrap 必須單獨核對：

1. 先在 feature branch 完成程式、mock、審閱與必要 Preview 驗收。
2. 準備經審閱的合併／squash commit，**最終進 main 的 commit message** 包含
   `[skip netlify]`。不用 `[skip ci]`，保留 GitHub CI。
3. 合併後確認實際 main commit 保留該標記、Netlify 沒有發布新的 production deploy，
   再使用 main 的手動 workflow。這些步驟尚未執行。

PR title 的標記只處理 Preview；不能拿它代替最終 main commit 的部署標記。
下一個沒有標記的 commit 仍會部署包含先前略過的所有變更；手動部署也不受此標記禁止。
後續推送／合併前仍要檢查這個界線，不能將 skip 當成持續鎖住正式站。
[Netlify 官方 skip 規則](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/#skip-a-deploy)

## 設定專用環境與明確 Preview

先檢查專用 PAT 實際能存取的 Netlify 範圍及到期日；固定 siteID／deployID 是程式限制，
不能當作 PAT 本身已被限制到單一 store 的證明。
GitHub Environment 名稱為 `superrich1965-preview`，Selected branches 明確只允許 main：

| 類型 | 名稱 |
| --- | --- |
| Environment Secret | NETLIFY_AUTH_TOKEN |
| Environment Variable | NETLIFY_SITE_ID |

Secret 只在執行 CLI 的 step 注入，不在 npm ci／checkout 使用。
本機管理指令也需要專用 shell 的 NETLIFY_SITE_ID／NETLIFY_AUTH_TOKEN；不要把值放進 Git。

選擇**已部署只讀 API 的新 Preview**，核對其不可變 deploy ID、branch、完整 40 字元 commit
及 context=deploy-preview。不要使用 alias 當 ID，或把已知舊來源部署重新當作 target。
程式會拒絕先前兩個來源部署，並在每次開 store 前向固定 Netlify API 核對 metadata。

設定檔範本如下，所有佔位字串必須換成已核對的真實身分；不能直接當成有效設定：

```json
{
  "schemaVersion": 1,
  "siteID": "b5ac142c-7e21-4910-90f7-1719a9d90d5d",
  "targets": {
    "preview-reviewed": {
      "kind": "preview",
      "deployID": "<24-character-deploy-id>",
      "branch": "<reviewed-branch>",
      "commit": "<40-character-commit-sha>",
      "context": "deploy-preview"
    }
  }
}
```

Preview 更新成新 deploy ID 後必須受控重新綁定，不搬舊 quote／controlVersion 或重標時間。
本階段不新增 production target，也不依賴把舊 Preview promote 成正式部署。

## 控制與 source guard 初始化

下列都是維運操作；需完成上述 target／憑證與舊來源工作查核後才執行。
來源工作不自動建立 target control 或 source guard。

```bash
npm run fx:1965:actions:control -- status --target preview-reviewed
npm run fx:1965:actions:control -- source-status --target preview-reviewed
```

先確認舊 Netlify source Functions／本機 collector 停止。舊 immutable Preview 即使當下
沒有 lease，也仍可能有可被呼叫的來源 API；不能只看「沒有正在跑的工作」就啟用 Actions。
Bootstrap 讀 production、兩個已知舊 Preview 與新 target 的 breaker／gate／job。
固定 legacy store 若已有 enabled control，會以 legacy_source_enabled 拒絕；缺 control 時
仍須人工核對舊 env 不會自動啟用。其他相關舊部署也必須納入人工查核，不能視為不存在。
舊 metadata／狀態無法讀取、資料損壞或仍有工作都停止，不跳過該 store。

已確實完成停止查核後：

```bash
npm run fx:1965:actions:control -- source-bootstrap --target preview-reviewed --confirm-legacy-stopped
```

這會保留已知較晚 blockedUntil、較嚴格 blockLevel／失敗歷史，建立 **paused** guard；
既有 guard 不覆蓋。enabled target 不代表 source guard 已啟用，兩者分開控制。
待原冷卻結束、身分及工作狀態都已確認後，再準備：

```bash
npm run fx:1965:actions:control -- enable --target preview-reviewed
npm run fx:1965:actions:control -- source-resume --target preview-reviewed
```

source-resume 不清冷卻或換 sourceEpoch；有未結案來源就拒絕。Actions 運行期間不與
未整合共同 guard 的舊 CLI 並行；需要回復舊工具時，先暫停 Actions 並核對共同冷卻。

## 首次手動 probe

由 main 執行 `SuperRich 1965 manual verification`：先選 inspect，再選 probe。
Workflow 固定選 preview-reviewed／superrich1965-58（A04／36），不接受任意 URL 或分店。
本機 source CLI 會驗 GitHub repository／run ID／commit／ref／event，不能直接當普通
本機取價指令；不要偽造 GitHub 環境變數來跳過執行界線。

驗收同時看 JSON／GitHub summary：

- outcome=complete、exitCode=0、sourceValidated=true、replayed=false。
- sourceSucceeded=1、published=0；冷 session sourceRequestCount=2，token／rate 兩個 stage 都 200。
- parser 已驗 USD 100-50 與 TWD 1000-100；缺任一指定買入價不能通過。
- branches/{slug} 與 snapshot 沒有新增報價；job／lease／必要保護狀態仍會持久化。

cache_hit、sourceRequestCount=0、sourceValidated=false 不算來源網路驗收。
同一 GITHUB_RUN_ID 的 rerun 只回歷史結果，本 attempt 來源 0；失敗 replay 保留原 exit 1，
不因當前 cooldown 改成綠色略過。新的驗證需新手動 run，且仍遵守冷卻與刷新資格。
來源 token／rate 任一階段 403／429／challenge 都停止；不改 runner／target 或刷新 token 重試。

## 結果、取消與故障處理

| Exit code | 意義 |
| --- | --- |
| 0 | 要求結果完成或合法 cache hit；仍須看 sourceValidated／replayed |
| 1 | 新來源失敗、部分完成、storage／發布／保護狀態失敗 |
| 2 | 參數、身分或 target／憑證設定不符 |
| 3 | 既有 paused／cooldown／busy／disabled 等零來源略過；workflow 明確顯示 skipped |

Guard 損壞／讀取失敗不是正常 skip。已發來源但結果未結案時，lease 過期仍阻止新請求，
保持 unknown_outcome。不要刪 guard、改 epoch 或清 breaker；先 source-status 核對。
必要時先 source-pause；已知 403 仍保留冷卻，即使同時取消或 target control 改變。

人工 reconciliation 只在 paused、lease 已過期、epoch／lease ID 精確匹配後接受。
核對來源紀錄後，將下列 outcome 明確換成 blocked／failed／complete 之一；complete
表示已確認來源完成或無新封鎖，不表示發布報價，也不自動 resume：

```text
npm run fx:1965:actions:control -- source-pause --target preview-reviewed
npm run fx:1965:actions:control -- source-reconcile --target preview-reviewed --epoch <uuid> --lease-id <uuid> --outcome <reviewed-outcome> --confirm-source-reviewed
```

若無法確認來源結果，繼續 paused。Reconcile 保留原冷卻並記有限稽核，之後仍須另行
查核及 source-resume；不要把這個操作當成重跑捷徑。

## Probe 通過後的下一階段

程式已支援明確 publish single／pilot／all，但**目前 workflow 不提供發布選項**。
須先完成 probe 與 Preview 發布方式審閱，再以受控手動 workflow 接入：

```text
fx:1965:actions publish --target preview-reviewed --scope single
fx:1965:actions publish --target preview-reviewed --scope pilot
fx:1965:actions publish --target preview-reviewed --scope all
```

pilot 固定 58／56／57；all 是正式 mapping 的 38 家，不接受任意 Slug 清單。
每家成功獨立發布，隨機間隔 2～5 秒；失敗停整輪，已成功與未到期舊報價保留。
首次發布後核對 cache GET、單店只讀 POST、列表及 Google／HERE，再驗 38 家。
舊完整 snapshot API 保留相容性，不會自動合成 Actions 的逐店新資料。

整輪 12 分鐘、job 20 分鐘；token＋rate 同店共用 12 秒來源 timeout／15 秒 deadline。
來源成功與發布成功分開統計；sourceValidated=true 不代替 published／逐店終態驗收。
正式切換、專用 production target、泰國 08:00～22:30 時段與半小時排程均留待後續驗收，
目前不自動發布或啟用。夜間過期撤價，地點／收藏／官網連結仍可使用。
