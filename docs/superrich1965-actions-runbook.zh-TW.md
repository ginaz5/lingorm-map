# SuperRich 1965：Actions 手動驗證與維運

更新：2026-10-20。本機程式與 mock 已實作；尚未設定遠端 target、專用 PAT、
GitHub Environment、source guard 或執行 workflow。正式網站保持原部署。
計畫與證據見 [實作計畫](superrich1965-github-actions-plan.zh-TW.md)及
[實作前調查](superrich1965-actions-research-2026-10-20.zh-TW.md)。

## 已完成與目前預設

- 新增 `fx:1965:actions`：inspect／probe／publish，以及獨立的 actions:control 管理工具。
- 新 workflow 只接受手動 inspect／probe，不提供 publish、push／PR 自動抓價或 schedule。
- `config/exchange-rates-1965-actions-targets.json` 的 targets 故意為空；任何未設定 target
  都在讀 credentials、Netlify metadata 或來源之前失敗，不回退 production。
- CLI 不自動載入 `.env`，避免默用日常管理 token。遠端設定時使用專用、有到期日的 PAT；
  憑證只放專用執行環境或 GitHub Environment，不放設定檔、命令參數或對話。
- 用戶已同意日後沿用泰國 08:00～22:30 每半小時更新；目前不啟用排程，夜間報價仍按期撤下。

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

未設定 target 時，下列只讀命令預期以 `target_not_configured` 失敗：

```bash
npm run fx:1965:actions -- inspect --target preview-reviewed
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
