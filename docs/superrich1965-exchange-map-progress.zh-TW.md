# SuperRich 1965（橘標）換匯地圖進度紀錄

> - 專案：Lingorm Bangkok Map
> - 建立日期：2026-09-09
> - 最後更新：2026-09-11
> - 目前里程碑：**M1、M2、M4 資料發布與 M3～M5 本機實作已完成**。38 筆 Place ID 與座標均完成審核；HERE 本機驗收通過，M3 部署首輪及 Google Maps 驗收待辦
> - 規格依據：[SuperRich 1965（橘標）USD／TWD 換匯地圖實作計畫](superrich1965-exchange-map-plan.zh-TW.md)
> - 審閱歷程：[審閱摘要](superrich1965-exchange-map-plan-revisions.zh-TW.md)

本文件只追蹤執行進度、驗證結果與待辦。資料模型、決策語意與階段設計以計畫文件為準；兩份衝突時先改計畫，再同步這裡。

**維護紀律**（沿用綠標進度檔的三條，避免變成第二份流水帳）：

1. 固定形狀，不寫流水帳：每個里程碑只有「完成條件 / 狀態 / 驗證 / 未解問題」。
2. 規格變動往上游走，這裡只記「已依計畫 §X.Y 完成」。
3. 全檔上限 200 行；超過就把已完成里程碑壓成一行結論。

---

## 里程碑總覽

| 里程碑 | 內容 | 使用者可見 | 狀態 |
| --- | --- | --- | --- |
| M1 | Phase A0（POST 可行性）+ Phase A1（來源契約與純解析） | 無 | **完成**：38 筆 Our Branch 收錄，E52-01 排除 |
| M2 | Phase B（Our Branch 建檔）+ 橘標對照 validator | 無 | **完成**：38 筆身份、文字與座標審核通過 |
| M3 | Phase C（排程、Blobs、breaker、控制旗標；預設停用） | 無 | **本機實作完成**；Deploy Preview 人工首輪待驗收 |
| M4 | Phase D1（前端品牌分派、三色 marker／cluster）+ 分店轉 `Published` | **本機可見** | **資料發布完成**；瀏覽器驗收待辦 |
| M5 | Phase E（測試補齊、README、ADR） | 無 | **本機完成** |

38 筆橘標分店已全部轉為 `Published`。本機開啟「顯示換匯點」後會顯示橘色 marker 與卡片；匯率列在橘標 API 尚未啟用或沒有可用快照時顯示暫無資料。

---

## M1 · Phase A0 — POST 可行性驗證

**完成條件**（計畫 §2.1、§6 A0）：本機及 Netlify Deploy Preview 的 `POST /spr/front/exchange-rate/get` 回傳 `200 / SUCCESS`，解析出可用的 USD／TWD，並保存請求與回應紀錄。

**狀態：已通過並完成本機收尾（2026-09-10）。** 本機與 Netlify 均有成功紀錄；後續 A1 分組核對也已完成（見下節）。正式排程穩定性屬 Phase C 驗收範圍。

**驗證：** 以下為使用者貼出的輸出，時間取自終端機提示（台北），僅作近似時間。請求設定、Ray ID、狀態、解析結果與原樣 probe JSON 見 [A0 實測紀錄](evidence/superrich1965-a0-2026-09-10.json)；來源 body 只有 probe 截取的片段，沒有完整封包存檔。收尾時未重新請求來源。

| # | 時間 | 環境 | 請求 | 結果 |
| --- | --- | --- | --- | --- |
| 1 | 09-10 07:23 | Netlify Preview #7 | `POST exchange-rate/get` | 403 HTML，含 `Just a moment...`；舊版未記錄 `cf-mitigated` |
| 2 | 09-10 08:03 | 使用者本機 | `POST exchange-rate/get` | 200、契約通過，USD 32.77／TWD 0.995 |
| 3 | 09-10 08:14 | Netlify Preview #7 | `GET branches?page=1&limit=5` | 403，`cf-mitigated: challenge` |
| 4 | 09-10 08:14 | Netlify Preview #7 | `POST exchange-rate/branch-list` | 200、契約通過，39 筆 |
| 5 | 09-10 08:14 | Netlify Preview #7 | `POST exchange-rate/get` | 200、契約通過，USD 32.77／TWD 0.995 |

第 3–5 筆是同一矩陣依序執行的請求。新舊 probe 的匯率 URL、method、body 與明訂 headers 相同；矩陣新增了前置請求與間隔。部署版本、實際出口 IP、連線與來源規則未獨立核實，因此這組結果只證明匯率 POST 在 Netlify 有成功案例。不能據此把先前 403 歸因於資料中心 IP、GET／POST 方法、某條端點規則或即時風險評分，也不能估計失敗頻率。

第 3 筆可由 `cf-mitigated: challenge` 確認為 Challenge Page；這個 header 不區分具體挑戰類型。缺少 `Retry-After` 也不能排除限流。參考 [Cloudflare 挑戰辨識](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/) 與 [觸發來源](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/)。

Ray ID 後綴 `BOS`／`CMH` 是 Cloudflare 資料中心代碼，不能據此確認使用者位置、住宅網路或兩次請求使用相同出口 IP。參考 [Cloudflare Cf-Ray 說明](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-ray)。

第 2、5 筆的 `sourceUpdatedAtMs` 都是 `1788951064201`，報價也相同；報價時間、快取時間與批次回應時間仍無法區分。沿用計畫 §2／§7.2：卡片先顯示「本次查詢時間」。

**收尾：**

- 已保存三次執行、共五筆上游請求結果；歷史 probe 實作可從 Git commit `f7239b6` 查閱。
- 已自工作區移除 `scripts/superrich1965-a0-probe.mjs` 與 `netlify/functions/superrich1965-a0-probe.mjs`，避免暫時診斷端點隨後續正式版本部署。
- 既有 Preview 尚未撤下；移除本機檔案不會改變已部署版本，需另行部署或清理。
- 已同步計畫狀態並修正缺乏證據的推論；原有 A1 工具與測試保留。

收尾驗證：`npm run typecheck` 通過；`npm test` 為 453 通過／0 失敗（含工作區原有的 16 項 A1 工具測試）；`npm run build` 通過。`git diff --check`、14 個文件相對連結、紀錄 JSON 與兩支 probe 的移除檢查通過；A1 工具與測試的檔案雜湊未變。正式地點快照未變，本次未執行 Notion 匯出或快照驗證。

**未解問題與交接：** A0 當時尚缺 GET 成功紀錄，A1 建檔已取得 `/branches` 與分組資料（見下節）。Phase C 依計畫 §5 定案挑戰辨識、403／429 退避、整輪停止條件與重試上限。A0 沒有驗證「某店受挑戰後繼續抓其他店」的策略，也未完成長期穩定性或全分店測試。

---

## M1 · Phase A1 — 來源契約與純資料解析

**完成條件**（計畫 §6 A1）：USD/TWD 分桶對應清楚；39 筆分店的 Our Branch／排除名單定案。

**狀態：完成（2026-09-10）。** 解析層與 39 筆分組／識別碼核對完成；實際收錄與排除清單見[逐店查證](superrich1965-branch-verification.zh-TW.md)。

**已完成：**

- `src/data/exchange-rates-1965.js`——純解析，無 network／DOM／storage。`parseBranchExchange1965()`、`parseBranchList1965()`、`parseRateText1965()`、`branchQuoteFailure1965()`、`normalizeBranchNo()`、`parseSourceUpdateTime()`。
- `tests/exchange-rates-1965-source.test.mjs`（29 測試）、`tests/fixtures/superrich1965/{exchange-rate-00,branch-list}.json`。
- 新模組加進 `jsconfig.json` 的 typecheck allowlist，並同批更新 `tests/typecheck-config.test.mjs`（該測試逐字斷言 include 陣列，兩者必須一起改）。

**解析層完成時的驗證紀錄**（A0 收尾的最新結果見上節）：

| 項目 | 結果 |
| --- | --- |
| `npm run typecheck` | 通過 |
| `npm test` | **437 通過 / 0 失敗**（新增 29 筆，綠標既有行為不受影響）|
| `npm run build` | **通過**（2026-09-10，使用者本機驗證，Vite 成功建置） |

**兩個實作面的決定：**

- `parseRateText1965()` 是綠標 `parseRateText()` 的**刻意複製**（計畫 §1 的「平行複製一份」），不是 import。代價是 BigInt 進位邏輯有兩份、可能長歪，因此補了 cross-module 等價測試逐一比對兩個 parser 在同一組輸入向量下的輸出，發散就紅燈。
- 兩個端點的 envelope 不一致（`exchange-rate/get` 回 `code:"SUCCESS"`、`branch-list` 回 `code:"200"`），寫成兩個獨立檢查，不共用「兩種都收」的 helper——共用會讓 `exchange-rate/get` 也放行 `"200"`。

**分組核對工具與實際核對（2026-09-10）：**

`scripts/superrich1965-branch-reconcile.mjs`——抓 `branch-groups` + `branches` + `exchange-rate/branch-list` 三個來源，用名稱交叉配對，輸出兩份**草稿**：

| 產出 | 性質 |
| --- | --- |
| `docs/superrich1965-branch-verification.zh-TW.md` | 審查報告，含逐筆配對層級與勾選欄；對應綠標的同名查證文件 |
| `data/superrich1965-branches.draft.json` | 草稿對照檔，**不是正式檔**；核對後刪掉 `_review`／`_draft` 才另存為 `superrich1965-branches.json` |

這支工具目前是本機 CLI。本次以可辨識 User-Agent 取得三個來源的成功回應，離線呼叫既有 reconcile 產生候選，逐筆核對後另建正式對照。工具原有重試策略未變，不視為 Phase C 排程策略的驗收。上表是 CLI 預設草稿產出；目前同名查證文件已改為正式建檔紀錄，重跑 CLI 會覆寫，執行前應另存或備份。

配對分五級：`exact`（正規化後相同）、`contained`、`token-subset`、`fuzzy`、`ambiguous`／`none`。**只有 `exact` 可以略過細看**，其餘全部進「需人工確認」表——符合計畫 §2.3 要求的逐筆核對，工具只提候選、不做決定。

**額外補上的防線：反向碰撞偵測。** 草稿對照檔以 `superrich1965-{officialId}` 為 key，若兩筆 `branch_no` 配到同一間分店會互相覆蓋，把某個 `branch_no` 掛到別間店名下——**而橘標的匯率回應不帶分店識別碼，事後完全查不出來**（計畫 §2 的 identity guard 缺口）。碰撞的項目會從草稿檔剔除、在報告最上方獨立列出、CLI 以 exit code 1 收場。

驗證：`tests/superrich1965-branch-reconcile.test.mjs` 16 個測試，用的是計畫 §2.3 記錄的真實名稱差異（`Central World`↔`CentralWorld`、`Big C Ratchadapisek`↔`Big C Place Ratchadapisek`、兩間 Emsphere 不可互換、`Ratchadamri 1`／`2` 不可互換），加碰撞偵測的正反案例。

**未解問題：**

1. 分組已定案：官方目錄 41 Our／12 Partner；39 筆報價清單中收錄 38 Our（A04），Terminal 21 Pattaya（106／E52-01）為 Partner，排除。
2. 87／94／95 三間 Our 未列於報價清單，無可用 branchNo，暫緩收錄；不影響目前 38 店的唯一對照。
3. **橘標補不上綠標那道 identity guard**：綠標每列都有 `branchCode` 可交叉核對，橘標的回應完全沒有分店識別碼，`branchNo` 只是從 caller 回填。唯一防線是 `data/superrich1965-branches.json` 正確——這放大了審閱意見 16，M2 的橘標 validator 不是可選項。
4. `data.update_time` 語意未驗證，已解析進 `sourceUpdatedAtMs` 但標註 UI 不得當作「官網報價時間」顯示（低優先，不卡任何 Phase）。

---

## M2 · Phase B — 分店建檔

**完成條件**（計畫 §6 B）：所有收錄分店有唯一對照、有效座標、來源連結；橘標對照檔與 `data/locations.csv` 收錄名單逐筆一致，且該驗證納入 pre-push gate。

**狀態：完成（2026-09-11）。** 38 筆正式建檔、Place ID、文字與座標均完成審核；[逐店查證與 Notion 連結](superrich1965-branch-verification.zh-TW.md)保存完整收錄／排除理由。

**驗證：**

- 38 筆全部建立在正式 data source；完成審核後為 `Published`、`Review Needed=false`、`Last Verified=2026-09-11`。Category 為 Currency Exchange，Type 與 Source Tags 依計畫留空，icon 為 💱。
- 回讀 760 個屬性、38 個 icon、38 個 parent 全通過。唯一文字正規化為 Notion 移除 id 71 泰文名稱的零寬空白，已記入[欄位證據](evidence/superrich1965-notion-records-2026-09-10.json)。
- exporter 匯出 219 筆；公開筆數為 199，橘標公開數為 38。
- `data/superrich1965-branches.json` 保存 38 組 Slug／officialId／branchNo／companyCode；修正 Baan Silom、Big C Ratchadapisek、MRT Rama 9 三組自動配對碰撞。證據保留原候選與正式結果。
- 橘標 validator 檢查雙向名單、唯一識別、來源對照、座標數值、類別與目的地；納入 `npm test` 與 `build.sh`，並補入既有 snapshot 核准 Slug 清單。
- `location:verify -- validate --all` 通過：schema 20/20、219/219 行一致、0 issues。64 個 Type 空白警告是計畫允許的 26 綠標＋38 橘標，未擅自歸入推薦主題。
- `location:verify -- validate --all`、快照、橘標／綠標對照與收藏相容性驗證通過。完整程式測試結果見 M5；瀏覽器視覺驗收仍待完成。

**審核結論：**

1. 38 筆 Google Place ID 已由 Places Details URL 的 CID 與官方 iframe CID 逐店完全比對；沒有把 CID 當 Place ID。13 筆待修正座標依使用者決議採用相同 Place ID 的 Places Details 座標，見 [發布審核證據](evidence/superrich1965-publication-review-2026-09-11.json)。
2. Central Ladprao 採官方三語 landmark 與 2026 官網公告一致的 1 樓；Baan Silom 依泰文 address 與三語 landmark 改為 1 樓 A25；Sanam Chai 依 BEM 官方資料改記 Phra Nakhon 區。The Old Siam Plaza 改採 OSM 明確標名為該分店、`bureau_de_change`、`brand=SuperRich` 的 node 11871723783 成對座標。
3. 64、65、67、69、74、76、77、80、83、86、92、93、112 已改採核對過的 Place ID 座標；38 筆正式頁面回讀皆為 `Published`、`Review Needed=false`、`Last Verified=2026-09-11`。87／94／95 不在當前報價清單，維持本期不收錄。

---

## M3 · Phase C — 排程、儲存與控制

**完成條件**（計畫 §6 C）：部署後人工觸發第一輪並核對成功。

**狀態：本機實作與單店連線驗證完成（2026-09-11）；尚未部署、啟用或產生正式快照。**

**已完成：** 新增獨立排程 function、唯讀 API、runner、source transport、snapshot/control/breaker 契約、Blobs 儲存與管理 CLI。使用固定 38 店對照，完全不在每輪抓 inventory 或猜分店；POST body 僅含 `A04` 與逐店 `branch_no`。Blobs store 與 keys 都使用 `exchange-rates-1965` 命名空間，旗標為 `EXCHANGE_RATES_1965_ENABLED`，未設定時不寫 storage、也不發上游請求。

定案：UTC `:00`／`:30`、併發 2、起始間隔 200ms、單次 5 秒、整輪 25 秒、全輪最多一筆 retry。403／429／Cloudflare challenge 立即停止，退避 6h→24h→第三次自動停用；一般失敗連三輪暫停 1h。`GET /api/exchange-rates-1965` 強制 `no-store`，只回傳當前 control version 且未過期的橘標快照。`sourceUpdatedAtMs` 僅保存，不供 UI 宣稱為官網報價時間。

**本機驗證：** 單店 POST 回 HTTP 200，約 0.19 秒；後端測試涵蓋固定 38 店、POST 內容、節流、challenge／429 中止、第三次封鎖自動停用、預設停用零請求、獨立 snapshot 與 store。`npm run typecheck`、`npm test`（479 通過／0 失敗）、`npm run build`、載入本機環境的 `bash build.sh` 及 `netlify functions:build --src netlify/functions` 皆通過；正式資料檢核為 schema 20/20、219/219 一致、0 issues（64 個空白 Type 為既定警告）。

**未解問題：** 依完成條件，仍須部署至 Deploy Preview，先核對預設停用，再人工啟用及觸發第一輪，確認 38 店快照、執行時間與實際 Netlify 出口穩定性；這一步需要另行部署授權。

---

## M4 · Phase D1 — 前端

**完成條件**（計畫 §6 D1）：綠標既有行為（含排序、cluster 著色）不受影響；橘標卡片顯示自己的匯率、時間與橘標官網連結；marker 與 cluster 在 Google/HERE 一致；任一品牌故障不影響另一品牌。

**狀態：本機程式與資料發布完成；HERE 瀏覽器驗收通過，Google Maps 驗收待辦。** 橘標使用 `state.exchange1965.*`、獨立 API／timer／expiry；單一換匯開關控制兩品牌，排序選項依品牌快照個別啟停。卡片依品牌分派面額、時間、公司名稱與官網連結；Google／HERE marker 與 cluster 均支援全綠、全橘、混合中性三態。

**本機驗證：** 橘標 payload 必須完整涵蓋 38 店且 branch identity 完全一致；混合品牌排序不跨品牌比價；停用或讓其中一品牌過期不會清除另一品牌；橘標卡片只有兩列且不含綠標官網連結。38 店已為 `Published`。2026-09-11 使用 HERE fallback 實測：開關開啟後顯示 199/199 筆，搜尋 SuperRich 1965 顯示 38/199 筆；38 張橘標面板、橘標 marker 與 cluster 均出現，marker／cluster 色值為 `rgb(242, 102, 34)`，38 張卡片均連到橘標官網且 0 張誤連綠標官網。

**未解問題：** 須完成 Google Maps 本機瀏覽器驗收；M3 Deploy Preview 仍需另行部署並人工觸發首輪匯率快照。

---

## M5 · Phase E — 測試與手冊

**完成條件**（計畫 §6 E）：混合品牌排序回歸測試、任一品牌故障隔離測試、cluster 三態著色回歸測試、橘標卡片不得出現綠標官網連結的回歸測試；README 與 ADR 更新。

**狀態：本機完成。** 新增橘標前端與混合品牌回歸測試，README、技術決策與本機驗收手冊已同步。`npm run typecheck`、`npm test`（485 通過／0 失敗）、`npm run build` 與 `git diff --check` 通過。

---

## M6 · 本機抓取與快照發布

**完成條件**（[本機抓取計劃](superrich1965-local-fetch-plan.zh-TW.md) P0–P6）：本機 CLI、發布守門、雲端抓取開關、測試與維運文件齊備；本機可用性須實測，不得以 mock 成功代替。

**狀態：程式、測試與文件完成（2026-09-11）；本機實測與正式切換未執行。**

**已完成：** 新增 `scripts/exchange-rates-1965-fetch.mjs`（`probe` / `run --dry-run` / `run --publish`，fail closed、無 `--force`）、source 的 pacing profile 注入（netlify 維持併發 2／200ms／5 秒／25 秒；local 為併發 1／1,500ms／5 秒／180 秒，`canRetry()` 與 pacing 同讀一份 profile）、runner 的 `runLocalExchangeRateFetch()`、contract 的 `exchange-rates-1965/last-attempt` 有界摘要與 `EXCHANGE_RATES_1965_FETCH_MODE=netlify|local`。本機狀態（執行鎖 + 冷卻）放在 gitignored 的 `.local-state/`，鎖只由持有者刪除。

定案：只有 `complete` 才以 ETag 條件寫入快照；partial／failed／blocked、控制版本變動、寫入衝突與「整輪成功但已過 `expiresAt`」都不覆寫舊報價、不延長壽命，失敗仍更新 breaker 與 `lastAttempt`。`FETCH_MODE=local` 時排程 function 在建立 store 前返回並記 INFO，公開 API 照常服務——它不能取代 `fx:1965:control -- disable`。本機 challenge 冷卻為 30 分鐘→6 小時→24 小時，刻意比遠端 breaker 溫和，因為它防的是人工反覆重跑。

**本機驗證：** 新增 `tests/exchange-rates-1965-local-fetch.test.mjs`（23 項，全部使用 fake fetch／clock／store，不打真實來源、不寫正式 Blobs），涵蓋參數 fail closed、兩種 profile、單店 challenge 不 retry 且零遠端寫入、本機冷卻與執行鎖、遠端 breaker 冷卻、dry-run 不動遠端、發布成功、partial／challenge／ETag 衝突／已過期不覆寫、抓取中控制版本變動放棄發布、較舊摘要不覆蓋較新、`FETCH_MODE` 閘門。`npm run typecheck` 與 `npm test`（509 通過／0 失敗）皆過。

**已修正的四個複審問題（2026-09-11）：** dry-run 整輪失敗曾回報 `collected`（現在只有 `complete` 才是成功，其餘為 `not_published`）；本機冷卻曾寫死 `retryAfterMs: null` 而忽略來源的 `Retry-After`（現已傳遞）；probe／dry-run 曾被 `control.enabled` 擋住（診斷不再受公開開關影響，但仍尊重遠端冷卻且零遠端寫入）；發布前的到期檢查曾使用抓取結束時間，未計入其後的 control 重讀往返（改在寫入當下讀時鐘）。四項各有對應回歸測試。

**2026-09-12 複驗：** 已檢查上述四項修正及對應回歸測試；macOS 工作區的 `npm run typecheck`、`npm test`（509 通過／0 失敗）及 `npm run build` 均通過，先前 Linux 橋接環境的 build 驗證缺口已補齊。

**範圍說明：** 保留成功快照與 `lastAttempt` 摘要由本機 runner 實作；既有 Netlify runner 的快照發布策略未在此版改動。採用本機模式前仍須完成 `FETCH_MODE=local` 的部署及略過驗收。

**未解問題：** 新 CLI 尚未從本機對真實來源跑過 `probe` 或 `run --dry-run`，因此**本機可用性仍未驗證**。正式切換（設定 `FETCH_MODE=local` 並部署、啟動本機 collector）與可選的 launchd 排程都留待授權後執行。
