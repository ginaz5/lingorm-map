# SuperRich 1965：Netlify 排程與背景取價

橘標改由 Netlify Scheduled Function 在泰國時間 08:00～22:30 每半小時派送背景工作。
排程為 UTC `0,30 1-15 * * *`；台灣時間為 09:00～23:30。排程函式只派送，
完整取價與逐店發布在 Background Function 中執行，整輪應用預算 12 分鐘。
實際部署、切換及定時驗收狀態見[部署驗收文件](superrich1965-netlify-cutover-2026-10-23.zh-TW.md)，
不以程式存在表示已啟用。

## 綁定與安全界線

- 公開三個匯率 API 仍只讀快取；新 runtime API 只回目前路由的部署身分。
- Netlify collector 預設不啟用。quote store 另存 server-only collector control，
  必須明確綁定 deploy ID、main commit、quote controlVersion 並啟用。
- Scheduler 與 worker 每次來源／發布前重查啟用狀態與目前部署。正式站換版後，
  舊綁定會停止；核對新部署並重新綁定後才能繼續。
- Worker 只接受目前綁定的 HMAC 簽章，且每個半小時 slot 只能派送／開始一次。
  簽章金鑰只存 Blobs，不回傳 status、不進 log、前端或 Git。
- 來源延用共同 source guard、原 epoch、冷卻／breaker 歷史、CAS lease 與 unresolved
  marker；不因切換平台而 bootstrap、輪替或清冷卻。
- Python／Safari helper 固定使用現有 38 店 mapping、parser、token 生命週期、
  逐店 2～5 秒間隔，遇失敗即停、不新增來源 retry 或 Node fallback。唯一例外：
  token callback GET 若因單次 25 秒逾時失敗，同一 quote 內重試一次（見
  `note/TECH_DECISIONS.md` 2026-10-23）；rate POST 與其他失敗不重試。
- GitHub workflow 保留 main-only 手動操作，不再有 cron。Netlify control 啟用時，
  GitHub collector 也會以 `netlify_collector_active` 零來源略過，避免兩邊發布。

## Python 打包

`build.sh` 執行 `node scripts/prepare-superrich1965-python.mjs`，下載固定
CPython 3.12.15 Linux x86_64 GNU stripped runtime，核對固定 SHA-256，並驗證
相對符號連結不離開 runtime 目錄。檔案放在忽略的 `.runtime/superrich1965/`。
只有 worker 的 `included_files` 納入 Python、helper 與 mapping；不提交 binary。
Linux build 另以該 Python 匯入 `ssl`／`urllib.request` 驗證可執行。
Netlify 新函式明確使用 Node 22；取價 HTTP 由 Python 執行。

## 管理操作

管理 CLI 使用本機 `NETLIFY_SITE_ID` 與 `NETLIFY_AUTH_TOKEN`，不輸出其值。
`--deploy` 必須是目前已 ready 的同站部署；正式 target 必須是目前已發布的 main。
Preview 使用獨立 deploy store，正式使用原有 site-wide quote store，不搬 Preview 報價。

```bash
npm run fx:1965:netlify:control -- status --deploy <deploy-id>
npm run fx:1965:netlify:control -- bind --deploy <deploy-id>
npm run fx:1965:netlify:control -- enable --deploy <deploy-id>
npm run fx:1965:netlify:control -- dispatch --deploy <deploy-id>
npm run fx:1965:netlify:control -- disable --deploy <deploy-id>
```

`bind` 預設 disabled，保留正式 quote control；只會在空的 Preview 明確建立測試
quote control。已啟用的 collector 必須先 disable 才能重新綁定。quote control
重新啟用而更換 controlVersion 後，也必須重新 bind。

`dispatch` 為已驗證 target 的人工派送，仍受同一 slot CAS、來源 guard、目前部署
與營業執行時段限制；不能 force 或重跑既有 slot。HTTP 202 只是工作已派送。
`status` 顯示當前 slot 的實際終態與 requested／published／sourceSucceeded／cacheHit／
failed／notAttempted 等摘要，判斷完成須看 receipt 與公開 cache。

## 正式切換順序

1. 功能分支完成測試與 Deploy Preview；綁定、啟用 Preview 並人工派送全店，
   核對 38 店逐店發布、公開 cache、來源保護及零來源重播。
2. 記錄 production control、共同 guard 與目前正式 deploy。停用 GitHub repository
   variable `EXCHANGE_RATES_1965_SCHEDULE_ENABLED`，確認沒有執行中的 Actions。
3. 發布 main 新部署；新 Netlify collector 尚未綁定時不會取價。
4. 驗證正式 runtime API、公開 cache、前端，bind／enable 新正式 deploy。
5. 人工派送驗證正式發布，再核對至少兩輪真正的 schedule receipt 與 38 店公開 cache。
   若人工派送使用了當前 slot，該 slot 的自動派送會零來源略過；不當作定時驗收。

網站再部署或回滾前先 disable Netlify collector；需要中止來源時另 source-pause。
緊急撤價使用既有 quote control disable。這些控制不清除來源保護歷史。
若需使用 GitHub 手動備援，先 disable Netlify collector，核對目前正式 SHA 並更新
GitHub Environment 的 production binding；恢復 GitHub 自動 cron 必須另外還原 workflow。
