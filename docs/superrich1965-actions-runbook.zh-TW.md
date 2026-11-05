# SuperRich 1965：GitHub Actions 取價（外部觸發＋備援排程）

更新：2026-11-05。為節省 Netlify compute credits，正式取價改由本 workflow 執行；
Repository 為 public，GitHub-hosted 標準 runner 分鐘數不計費。

- **主要觸發：外部排程**（例如 cron-job.org）每半小時呼叫 `workflow_dispatch` API，
  UTC 01:00～15:30（泰國 08:00～22:30）。現行 main 已接受此觸發，不需部署。
- **備援：GitHub 內建 cron** `7,37 1-15 * * *`，須 repository variable
  `EXCHANGE_RATES_1965_SCHEDULE_ENABLED` 精確為 `true`（job 與 CLI 兩層檢查），
  只能執行 `publish-all-python --target production`。2026-10-22／23 實測此 workflow 的
  GitHub cron 約 50 輪只觸發 4 輪、最晚延遲 86 分鐘，**不可當主要觸發**。
  與主要觸發落在同一 UTC 半小時，前一輪成功時備援輪次全為 cache hit、零來源請求。
- [Netlify scheduler／worker](superrich1965-netlify-runbook.zh-TW.md) 保留為最後備援，平時 collector 保持 disabled。

正常維運入口見[文件索引](README.md)，歷史 rollout 與失敗調查見[封存索引](archive/README.md)。

## 身分與執行邊界

- Workflow：`.github/workflows/exchange-rates-1965.yml`，接受 `workflow_dispatch`（人工或外部排程）與受 variable 控制的備援 `schedule`，固定 repository 與 main。
- Environment 沿用 `superrich1965-preview` 名稱；Secret `NETLIFY_AUTH_TOKEN` 與 variable `NETLIFY_SITE_ID` 使用既有專用設定。名稱不代表 PAT 權限只限 Preview 或單一 store。
- `preview-reviewed` 綁定已審閱的 immutable Preview；`production` 必須符合 site／main／production，並以 Environment variable `EXCHANGE_RATES_1965_PRODUCTION_COMMIT` 綁定目前已核對、實際發布的 40 字元 commit。
- 不從目前 main 自動推導正式網站 SHA。網站換版後先核對 production metadata，再更新 GitHub binding；metadata 不符便停止。
  **每次正式部署後都必須更新此 variable**，否則下一輪以 exit 2（`target_metadata_mismatch`）失敗、不取來源；舊報價依原時間到期。
- Netlify collector 啟用時，Actions 以 `netlify_collector_active` 零來源略過。兩者共用 source guard、epoch、冷卻、lease、unresolved marker 與 operation ledger。
- Token 只留在記憶體；HTTP 使用 Python／Safari helper，JS 管理 parser、mapping、token 生命週期與逐店發布。本機只保留管理控制工具；舊 `fx:1965:fetch` 完整快照取價 CLI 已退役。

## 從 Netlify collector 切換至 Actions

1. 依 Netlify 手冊 `status`／`disable` 停用目前正式 deploy 的 collector，等待既有 worker 結束。
2. 核對正式網站實際 SHA，更新 Environment variable `EXCHANGE_RATES_1965_PRODUCTION_COMMIT`。
3. 執行一次 production inspect，再手動 `publish-all-python`，核對 38 店公開 cache。
4. 設定外部排程（下節），核對下一個 `workflow_dispatch` run 的摘要與公開 cache。
5. 備援 cron 合併到 main 後，可將 `EXCHANGE_RATES_1965_SCHEDULE_ENABLED` 設為 `true`。

停用：暫停外部排程工作，並把該 variable 改為 `false`（或刪除），不需 commit 或部署。

## 外部排程設定（cron-job.org 範例）

1. GitHub 建立 fine-grained PAT：Repository access 只選 `ginaz5/lingorm-map`，
   Permissions 只給 **Actions: Read and write**，設定到期日。PAT 只存於外部排程服務，不進 Git 或 Netlify。
2. 新增工作：每 30 分鐘，時區 UTC，時段 01:00～15:30（cron `0,30 1-15 * * *`）。
3. Request：

   ```text
   POST https://api.github.com/repos/ginaz5/lingorm-map/actions/workflows/exchange-rates-1965.yml/dispatches
   Authorization: Bearer <PAT>
   Accept: application/vnd.github+json
   X-GitHub-Api-Version: 2022-11-28
   Content-Type: application/json

   {"ref":"main","inputs":{"action":"publish-all-python","target":"production"}}
   ```

4. 成功回應為 HTTP 204；401／403 表示 PAT 過期或權限不足。開啟外部服務的失敗通知。

觸發只決定「何時」；身分、main-only、production SHA 綁定、source guard、冷卻、lease、
`netlify_collector_active` 互斥與 concurrency 都由 workflow／CLI 執行，外部服務無法繞過。
PAT 外洩的最壞情況是他人額外觸發本 workflow：同半小時內的重複輪次為 cache hit，
來源受 guard 與冷卻保護；發現時立即撤銷 PAT。

## 手動取價

1. 依 Netlify 手冊核對目前正式 deploy，停用其 collector。確認既有 worker 已結束，沒有未結案來源、有效 lease 或尚未結束的冷卻。
2. 核對正式網站的 ready／main／production／實際 SHA，更新 GitHub Environment 的 production binding。保持既有 quote control 與 source guard 歷史，不重新 bootstrap。
3. 執行 production inspect，確認 target、control、guard 與部署相符；inspect 不取來源或寫入報價。
4. 若 source guard 是 paused，完成停止／冷卻／unresolved 查核後，才以管理工具明確 source-resume。
5. 執行全店發布。每輪完成後核對摘要、逐店結果、公開 cache 與保護狀態，再決定下一輪。

```bash
npm run fx:1965:netlify:control -- status --deploy <current-deploy-id>
npm run fx:1965:netlify:control -- disable --deploy <current-deploy-id>
```

下列 workflow 每次只選一項執行；先完成 inspect：

```bash
gh workflow run exchange-rates-1965.yml --repo ginaz5/lingorm-map --ref main -f action=inspect -f target=production
```

| action | 固定範圍 | 發布 |
| --- | --- | --- |
| inspect | 身分／control／guard | 否，零來源零寫入 |
| publish-all-python | mapping 全部 38 店 | 是 |

分階段上線用的 probe／單店／五店模式已於 2026-10-24 移除。全店發布：

```bash
gh workflow run exchange-rates-1965.yml --repo ginaz5/lingorm-map --ref main -f action=publish-all-python -f target=production
```

不接受任意 URL、Slug、scope、force 或 checkout ref。來源只使用 Python 傳輸。
既有有效 cache hit 可合法略過來源；不得清快取或重標時間製造全新覆蓋。

## 結果與故障處理

核對 requested／published／sourceSucceeded／cacheHit／failed／notAttempted、
sourceValidated 與 replayed。只有完成發布的逐店結果及有效 quote 才代表對外可用；
部分成功不能寫成全店成功。cache hit 或歷史 replay 不算新的來源驗收。
公開 API 的方法、控制版本與時間檢查見[匯率資料契約](exchange-rate-contract.zh-TW.md)。

| Exit code | 意義 |
| --- | --- |
| 0 | 要求結果完成或合法 cache hit；另核對 sourceValidated／replayed |
| 1 | 新來源失敗、部分完成、storage／發布／保護狀態失敗 |
| 2 | 參數、身分或 target／憑證設定不符 |
| 3 | paused／cooldown／busy／disabled 等零來源略過 |

串行逐店間隔 2～5 秒，整輪應用預算 12 分鐘、workflow job 20 分鐘。
Token 更新會保留 30 秒安全邊界；已知 token 接近到期時先在無來源 lease 下等待。
token GET 的 Python 逾時可在同一 quote 內重試一次，來源請求與診斷上限為 3；
rate POST、HTTP 錯誤與 challenge 不重試。詳細例外與原因見
[技術決策](../note/TECH_DECISIONS.md#2026-10-23橘標來源逾時放寬與-token-逾時單次重試)。

403／429／challenge 即停止並保留跨 target 冷卻。unknown outcome 不因 lease 過期
自動解鎖；先 source-pause 並檢查 source-status，無法確認時保持 paused。
不刪 guard、換 epoch、清 breaker 或換 runner 來繞過保護。
狀態查核可用專用 shell 的既有憑證；正式 target 另須已核對的 SHA 環境變數：

```bash
npm run fx:1965:actions:control -- status --target production
npm run fx:1965:actions:control -- source-status --target production
```

管理工具不自動載入日常 `.env`；憑證不放命令參數或 Git。必要的 source-pause／
source-resume／人工 reconciliation，須先查明實際來源結果與精確 epoch／lease 身分。

## 改回 Netlify 排程（備援）

先暫停外部排程、將 `EXCHANGE_RATES_1965_SCHEDULE_ENABLED` 改為 `false`，等待 Actions 完成，核對共同 guard
沒有 lease／unresolved，依 Netlify 手冊核對目前部署與 collector binding；部署或 quote
controlVersion 改變時重新 bind，再 enable。確認下一個真正 schedule receipt 與 38 店公開 cache。
Netlify collector 啟用時 Actions 會以 `netlify_collector_active` 零來源略過，不會兩邊發布。
網站回滾不會停止來源工作或還原 Blobs；先停止 collector，需要中止來源時另 source-pause。
