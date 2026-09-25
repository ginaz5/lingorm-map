# 橘標匯率：本機抓取與快照發布實作計劃

日期：2026-09-11。交接對象：Claude Opus 5。

狀態：P0–P6 已於 2026-09-11 實作完成（程式、測試、文件），見[進度紀錄 M6](superrich1965-exchange-map-progress.zh-TW.md)。**尚未**對真實來源做本機實測，也未修改正式資料、切換 `FETCH_MODE`、部署或安裝排程。本文件以下內容保留為當初的計劃原貌。

## 目標與採用理由

為個人專案提供低成本、由自己掌控的橘標匯率更新方式：本機 Node.js 抓取 SuperRich 1965 公開匯率，驗證成功後寫入既有 Netlify Blobs；前端繼續讀 `/api/exchange-rates-1965`。

不以聯絡官網、購買代理服務或搬到另一個雲端作為必要條件。本機可用性必須實測，不能保證能消除 Cloudflare challenge。

已知證據：

- 使用者提供的 2026-09-11 泰國時間 20:45 執行，第一店 `officialId:56` 回 HTTP 403、`cf-mitigated: challenge`、HTML；整輪只請求一次，沒有 retry。Ray ID 為 `a3971d9499035cd4-CMH`。
- 後續執行零來源請求，屬程式自己的 breaker 冷卻。該次期限為 `2026-09-11T19:45:54.810Z`（泰國時間 9 月 12 日 02:45:54），不是官網宣告的解封時間。
- [A0 實測紀錄](evidence/superrich1965-a0-2026-09-10.json) 保存了相同 URL、body、明訂 headers 的本機成功及 Netlify 成功／失敗結果。這支持先驗證本機方案，但不能證明出口 IP 是唯一原因，也不能證明先呼叫其他端點能解鎖。

## 工作邊界

- 先讀專案 `AGENTS.md`、`README.md`、`note/TECH_DECISIONS.md`、`note/LOCAL_TESTING.md` 及相關橘標程式；先確認工作樹，保留既有變更。
- 保持 Vanilla JavaScript、ES modules、JSDoc/checkJs；沿用現有解析與 snapshot contract，不重寫報價算法。
- 只改橘標管線。綠標、Notion 地點資料、CSV、收藏 slug、地圖 provider 不在這次修改範圍。
- 維持目前 38 店 mapping、USD `100-50` 與 TWD `1000-100`。執行時以已驗證 mapping 為準，不從官網重新猜分店。
- 不新增公開寫入 API；發布使用既有 server-side 管理憑證與 `createAdminStore()`。
- 不將 Cookie、token、環境變數值或完整 challenge HTML 放入 log、fixture 或文件。
- 本輪以程式、測試、文件及本機驗證為交付。依 repository 規則，不自行 commit、push、部署、切換正式設定或安裝持續排程；先備妥可審閱成果與操作命令。

## 計劃表

| 階段 | 實作工作 | 主要檔案 | 完成條件 |
| --- | --- | --- | --- |
| P0 現況與設計核對 | 確認 source、runner、control、breaker、API 與前端到期契約；核對本機 Node 與必要變數是否存在，不輸出值 | 既有橘標模組、A0 evidence | 記錄目前行為、預計差異及實測是否受冷卻限制 |
| P1 本機單店探測 | 新增 CLI `probe`，預設只查 mapping 中 `officialId:56`；只回診斷及解析摘要，不發布 | 新增 `scripts/exchange-rates-1965-fetch.mjs`、`package.json` | 成功須為 JSON、正確 envelope、USD/TWD 均可解析；遇 challenge 即停且退出碼非零 |
| P2 慢速完整抓取 | 橘標 source 支援注入 pacing／deadline profile；本機併發 1、最小起始間隔 1,500ms、單次 5 秒、整輪 180 秒、全輪最多一次暫時性錯誤 retry | `_shared/exchange-rates-1965-source.mjs`、CLI | 38 店身份與覆蓋正確；本機 profile 不改變既有 Netlify 預設；失敗與 deadline 可預期 |
| P3 快照發布與失敗保留 | 新增明確 `--publish` 模式；完整成功才以 ETag 條件寫入，其他結果保留舊 snapshot；另存有界的最近執行摘要 | `_shared/exchange-rates-1965-runner.mjs`、contract/storage/control CLI | disabled、blocked、control 變動、ETag 衝突、過期均不可錯誤發布；失敗不刷新舊匯率時間 |
| P4 雲端抓取獨立開關 | 新增僅控制 Scheduled Function 是否抓取的環境設定，與公開報價 enabled 分開 | `exchange-rates-1965-fetch.mjs`、文件 | local 模式下雲端零來源請求、零 store 寫入；API 仍能提供有效 snapshot |
| P5 測試與人工驗收 | 補關鍵回歸測試，跑 typecheck/test/build；有條件時做一次單店及一次完整 dry-run | 新增 CLI 測試、既有橘標 backend/source/runtime/UI 測試 | 清楚區分 mock 驗證、本機實測、正式發布；來源被擋不得宣稱成功 |
| P6 維運與交接 | 記錄手動發布、切換、回復與可選本機排程步驟；更新現行技術文件 | `README.md`、`note/TECH_DECISIONS.md`、`note/LOCAL_TESTING.md`、橘標進度文件 | 另一位開發者可照文件操作；電腦休眠、斷網、到期及停用行為說清楚 |

## CLI 與來源抓取契約

以下命令名稱是待新增的介面，不是目前已可執行的命令：

```bash
# 單店診斷，不發布
npm run fx:1965:fetch -- probe

# 完整抓取與驗證，不發布匯率快照
npm run fx:1965:fetch -- run --dry-run

# 明確寫入正式 site-wide store；正式執行屬切換／驗收步驟
npm run fx:1965:fetch -- run --publish
```

- 缺少命令、互斥旗標、未知參數均 fail closed；不得預設發布。
- 預設維持可辨識的既有 User-Agent；不以偽裝瀏覽器 headers 作為修復前提。
- probe 與 dry-run 也是真實來源請求：共用本機持久化冷卻與執行鎖，失敗後不得靠反覆重跑探測。這兩種模式可寫本機執行狀態，但不可寫遠端 control、breaker、snapshot。
- 本機狀態存於 gitignored 的專案專用目錄；鎖需原子取得，說明異常退出後的恢復方式，避免刪掉仍在執行的鎖。
- 若已設定管理憑證，可讀取正式 breaker；未到期時不打來源。沒有憑證的 probe 不會知道遠端冷卻，需明確提示這個限制，不可據此繞過已知封鎖。
- 403、429、`cf-mitigated: challenge` 立即終止，不 retry；尊重 `Retry-After`。本機／發布路徑都保留既有退避意圖，不增加 `--force` 清除封鎖功能。
- pacing、retry 時間預算、deadline 均取同一有效 profile；特別檢查現有 `canRetry()` 寫死的 timeout 與 gap 常數，不得只改請求端造成判斷不一致。
- 本機完整 dry-run 成功後再採用本機方案。若第一店仍被 challenge，停止該輪實測，保留工具、測試與證據，不反覆更換 headers 或出口試撞。
- 最近執行摘要只保留時間、模式、結果、請求數、分店成功／失敗數與有界 diagnostics；需區分 `collected`、`published`、`not_published`、`blocked` 等語意。沿用既有 status 也可以，但不得讓 `published` 掩蓋來源失敗。

## 發布、控制與競態

1. 發布前先驗證參數、mapping 與 `NETLIFY_SITE_ID`、`NETLIFY_AUTH_TOKEN` 是否齊備；憑證不足時先失敗，避免抓完才發現不能發布。
2. `--publish` 必須要求有效且 enabled 的既有 control，不替使用者自動 enable，也不自動建立正式 control。
3. 先檢查遠端及本機冷卻；沿用 controlVersion 與 breaker 一致性檢查。不得以從雲端換成本機為由重設未到期封鎖。
4. 抓取前保存 controlVersion、snapshot ETag；發布前重讀 control。若停用、版本變動或 enabledAt 晚於此次抓取起點，放棄發布。
5. MVP 只發布 `complete`：每店 USD/TWD 皆有效且完整覆蓋 mapping。partial、failed、blocked 不覆寫 snapshot；成功的部分資料可記在摘要，不混入舊輪報價。
6. 保留上一份 snapshot 只代表保留原資料，不修改其 runId、查詢時間、有效期限或 controlVersion；即使留在 Blobs，API 仍須拒絕過期或舊 controlVersion 的資料。
7. 發布前檢查新 snapshot 尚未到期。全輪成功但完成／上傳太晚，一樣不得當成可用新資料發布。
8. 維持 ETag 條件寫入；遇衝突不盲目 retry。完整來源成功但 snapshot 寫入失敗，不應宣稱 published 或誤清 breaker。
9. 發布模式的失敗仍更新適用的 breaker 與最近執行摘要；摘要不得含整份原始 response。新增 `lastAttempt` key 時，一併更新 status CLI、型別與測試，避免較舊執行覆盖較新摘要。
10. 本機鎖避免同機重疊；本方案不承諾多台 collector。操作文件指定同時間僅一台本機 collector，並要求切換完成後才啟動持續排程。ETag 防止覆寫，不能避免重複來源請求。

## 停掉雲端抓取，但繼續提供匯率

建議新增 `EXCHANGE_RATES_1965_FETCH_MODE=netlify|local`：

- 未設定預設 `netlify`，維持既有部署行為；不合法值回報明確設定錯誤並停止抓取。
- Scheduled Function 在 `local` 時，於建立 store／讀寫 control 與 breaker／呼叫來源之前退出，記錄例如 `external_fetcher` 的正常略過結果。更新 logger，避免把預期略過記成 ERROR。
- 此設定只由 Scheduled Function 使用；本機 CLI 不應因讀到 `local` 而禁止自身執行。
- `/api/exchange-rates-1965` 仍依既有 control.enabled 提供有效 snapshot，不需要新增公開 API 欄位。
- **不能用 `fx:1965:control disable` 代替這個開關**：目前 disable 會讓前端也拿不到快照。
- 環境設定需要部署後生效。切換驗收須确认已部署的 Function 在 local 模式零來源請求，再啟動本機 collector，不能只修改 `.env` 就當正式環境已切換。

## 到期時間與可選排程

現有 contract 並非「成功後固定可用 30 分鐘」：

```text
nextUpdateAt = attemptedAt 之後的下一個 UTC :00／:30
expiresAt = nextUpdateAt + 90 秒
```

- MVP 維持這個 contract，不改 schema、不延長舊報價壽命。CLI 要輸出 expiresAt 與發布時剩餘有效時間。
- 手動更新可先使用，但不能描述成全天即時服務；電腦關機、休眠或漏跑後，前端會按既有規則顯示「暫無報價」。
- 本機穩定後，可另行啟用每小時 `:00`、`:30` 的排程，讓成功更新盡量在 90 秒寬限內完成。1.5 秒起始間隔抓 38 店約有 55.5 秒的起始跨度，另外還有來源延遲與上傳時間，不能保證一定無空窗。
- 若抓取超過 90 秒，舊 snapshot 到期至新 snapshot 發布之間允許短暫「暫無報價」。不要把觸發時間改到 `:02`／`:32` 卻宣稱可以無縫更新。
- 整輪 180 秒是執行上限，不是寬限時間。任何未完成整輪都不發布；跨半小時邊界時用實際 attemptedAt 計算有效期限。
- P6 只提供適合 macOS 的排程範本與安裝／卸載步驟，不在實作過程自動安裝。獨立排程要載入正確 Node 與專案路徑，保留執行鎖並輪替有界 log。
- 如果日後想每小時或每天只抓幾次，需另外設計更新週期、到期與前端文案，不能只把 schedule 改慢。

## 必要驗收

| 情境 | 預期 |
| --- | --- |
| probe 第一店 challenge | 一次來源請求、無 retry、無遠端寫入、本機冷卻留存、退出碼非零 |
| 冷卻中再執行／同機重疊 | 零來源請求，輸出明確略過原因 |
| dry-run 38 店成功 | 完整驗證與摘要，遠端快照／control／breaker 均不變 |
| 全店成功且 control 穩定 | 原子發布正確 snapshot；API 可讀、USD/TWD 對應正確 |
| partial／全失敗／challenge | 不覆蓋已有 snapshot，不延長期限；發布模式正確更新 breaker／執行摘要 |
| 既有 snapshot 已過期或版本不符 | 即使檔案仍存在，API／前端不顯示舊數字 |
| 抓取期間 disable／重新 enable | 舊執行不能把快照或 breaker 寫到新的控制版本 |
| ETag 衝突／上傳失敗／已過期 | 不宣稱發布成功，不覆寫較新資料，不誤重設 breaker |
| FETCH_MODE=local | 雲端排程無來源請求、無 store 寫入、正常略過 log；有效匯率 API 照常服務 |
| 預設 netlify profile | 保留原併發 2、200ms、5 秒／25 秒與 retry 限制；只有文件明訂的發布失敗保留策略改變 |
| 綠標回歸 | 綠標控制、抓取、報價與排序不受影響 |
| 電腦休眠／離線／錯過排程 | 不偽造更新時間，快照如期到期，恢復後可手動重跑 |

新增 CLI 需列入 `jsconfig.json` 的 include。測試採 fake fetch／clock／store，正常測試不可呼叫真實來源或寫入正式 Blobs。

完成時執行：

```bash
npm run typecheck
npm test
npm run build
```

正式切換／發布後，另驗證 API 回應、前端查詢時間、到期行為及下一輪更新；這些不得以單元測試通過代替。

## 失敗備案與交付要求

若本機也無法取得 JSON，交付可重現診斷與未發布原因，將本機可用性標成未通過。半自動「使用者正常瀏覽官網後匯入回應」列為後續選項，本輪不自動擴大實作；匯入必須保存 request 中的分店識別與實際查詢時間，因上游 response 自身沒有分店識別，不能把一份報價套用全部分店。

完成報告要包含：修改檔案、實際可用命令、測試結果、實測摘要、正式設定是否仍未變更、切換與回復步驟、尚待完成的上線驗收。更新舊橘標計劃／技術決策中與新策略衝突的現行描述，保留 A0 歷史證據原貌。

回復方式：停掉本機排程並確認沒有執行中的 collector，再將 FETCH_MODE 改回 netlify 並部署；維持既有 control 與冷卻，不清除 breaker、不復活過期快照。

## 可直接交給 Claude 的指令

> 請依 `docs/superrich1965-local-fetch-plan.zh-TW.md` 實作橘標本機匯率抓取與 Netlify Blobs 快照發布。先讀 AGENTS.md 及計劃中的必要文件，再完成 P0～P6 的程式、測試與文件。優先沿用既有解析器、contract、ETag 與控制機制，保持綠標不受影響。單店／完整 dry-run 的真實實測要尊重已知冷卻，且不得把 mock 成功當成來源可用。若本機仍遭 challenge，完成可獨立驗證的工作並明確記錄阻礙，不反覆試撞。正式發布、部署、切換環境設定及安裝持續排程先備妥可審閱的操作步驟，依專案規則留待執行授權。不要 commit、push 或自動擴大到付費服務／瀏覽器匯入方案。
