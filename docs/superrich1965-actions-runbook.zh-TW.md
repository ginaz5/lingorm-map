# SuperRich 1965：GitHub Actions 手動備援

更新：2026-10-24。現行自動取價由 [Netlify scheduler／Python background worker](superrich1965-netlify-runbook.zh-TW.md)
執行。GitHub workflow 僅保留 main-only 手動操作，沒有 cron；CLI 也拒絕任何 schedule
事件，舊 repository variable `EXCHANGE_RATES_1965_SCHEDULE_ENABLED` 已不再讀取。正常維運入口見
[文件索引](README.md)，歷史 rollout 與失敗調查見[封存索引](archive/README.md)。

## 身分與執行邊界

- Workflow：`.github/workflows/exchange-rates-1965.yml`，只接受 `workflow_dispatch`、固定 repository 與 main。
- Environment 沿用 `superrich1965-preview` 名稱；Secret `NETLIFY_AUTH_TOKEN` 與 variable `NETLIFY_SITE_ID` 使用既有專用設定。名稱不代表 PAT 權限只限 Preview 或單一 store。
- `preview-reviewed` 綁定已審閱的 immutable Preview；`production` 必須符合 site／main／production，並以 Environment variable `EXCHANGE_RATES_1965_PRODUCTION_COMMIT` 綁定目前已核對、實際發布的 40 字元 commit。
- 不從目前 main 自動推導正式網站 SHA。網站換版後先核對 production metadata，再更新 GitHub binding；metadata 不符便停止。
- Netlify collector 啟用時，Actions 以 `netlify_collector_active` 零來源略過。兩者共用 source guard、epoch、冷卻、lease、unresolved marker 與 operation ledger。
- Token 只留在記憶體；HTTP 使用 Python／Safari helper，JS 管理 parser、mapping、token 生命週期與逐店發布。本機只保留管理控制工具；舊 `fx:1965:fetch` 完整快照取價 CLI 已退役。

## 切換至手動備援

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

## 恢復 Netlify 排程

等待 Actions 完成，核對共同 guard 沒有 lease／unresolved，依 Netlify 手冊核對
目前部署與 collector binding；部署或 quote controlVersion 改變時重新 bind，再 enable。
確認下一個真正 schedule receipt 與 38 店公開 cache。GitHub 維持手動。
網站回滾不會停止來源工作或還原 Blobs；先停止 collector，需要中止來源時另 source-pause。
