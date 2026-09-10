# SuperRich 1965（橘標）換匯地圖進度紀錄

> - 專案：Lingorm Bangkok Map
> - 建立日期：2026-09-09
> - 最後更新：2026-09-10
> - 目前里程碑：**M1 進行中；A0 已通過最小 POST 可行性驗證並完成本機收尾**。A1 解析層完成，分組核對仍待執行；排程穩定性與失敗處理待 Phase C
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
| M1 | Phase A0（POST 可行性）+ Phase A1（來源契約與純解析） | 無 | **進行中**：A0 已收尾，A1 解析層完成，分組核對待執行 |
| M2 | Phase B（Our Branch 建檔，`Paused`）+ 橘標對照 validator | 無 | 未開始 |
| M3 | Phase C（排程、Blobs、breaker、控制旗標；預設停用） | 無 | 未開始 |
| M4 | Phase D1（前端品牌分派、三色 marker／cluster）+ 分店轉 `Published` | **上線** | 未開始 |
| M5 | Phase E（測試補齊、README、ADR） | 無 | 未開始 |

M1–M3 對使用者零可見變更，可安全停在任一處。M4 中途停會留下半成品 UI。

---

## M1 · Phase A0 — POST 可行性驗證

**完成條件**（計畫 §2.1、§6 A0）：本機及 Netlify Deploy Preview 的 `POST /spr/front/exchange-rate/get` 回傳 `200 / SUCCESS`，解析出可用的 USD／TWD，並保存請求與回應紀錄。

**狀態：已通過並完成本機收尾（2026-09-10）。** 本機與 Netlify 均有成功紀錄；M1 仍需完成 A1 分組核對。正式排程穩定性屬 Phase C 驗收範圍。

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

**未解問題與交接：** A1 需取得 `/branches` 與分組資料；本次沒有使用者本機 GET 的成功紀錄。Phase C 依計畫 §5 定案挑戰辨識、403／429 退避、整輪停止條件與重試上限。A0 沒有驗證「某店受挑戰後繼續抓其他店」的策略，也未完成長期穩定性或全分店測試。

---

## M1 · Phase A1 — 來源契約與純資料解析

**完成條件**（計畫 §6 A1）：USD/TWD 分桶對應清楚；39 筆分店的 Our Branch／排除名單定案。

**狀態：解析層完成（2026-09-09）；A0 已收尾，`groups[]` 分組核對仍需取得 `/spr/front/branches` 後執行。**

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

**分組核對工具已交付（2026-09-10），待使用者執行：**

`scripts/superrich1965-branch-reconcile.mjs`——抓 `branch-groups` + `branches` + `exchange-rate/branch-list` 三個來源，用名稱交叉配對，輸出兩份**草稿**：

| 產出 | 性質 |
| --- | --- |
| `docs/superrich1965-branch-verification.zh-TW.md` | 審查報告，含逐筆配對層級與勾選欄；對應綠標的同名查證文件 |
| `data/superrich1965-branches.draft.json` | 草稿對照檔，**不是正式檔**；核對後刪掉 `_review`／`_draft` 才另存為 `superrich1965-branches.json` |

這支工具目前是本機 CLI。A0 #3 只記錄了 Netlify GET 的失敗，本機 GET 是否成功仍待實測。工具內建 2s／5s 的挑戰重試屬目前實作，A0 未驗證其成效，不能直接當成 Phase C 的排程策略。

配對分五級：`exact`（正規化後相同）、`contained`、`token-subset`、`fuzzy`、`ambiguous`／`none`。**只有 `exact` 可以略過細看**，其餘全部進「需人工確認」表——符合計畫 §2.3 要求的逐筆核對，工具只提候選、不做決定。

**額外補上的防線：反向碰撞偵測。** 草稿對照檔以 `superrich1965-{officialId}` 為 key，若兩筆 `branch_no` 配到同一間分店會互相覆蓋，把某個 `branch_no` 掛到別間店名下——**而橘標的匯率回應不帶分店識別碼，事後完全查不出來**（計畫 §2 的 identity guard 缺口）。碰撞的項目會從草稿檔剔除、在報告最上方獨立列出、CLI 以 exit code 1 收場。

驗證：`tests/superrich1965-branch-reconcile.test.mjs` 16 個測試，用的是計畫 §2.3 記錄的真實名稱差異（`Central World`↔`CentralWorld`、`Big C Ratchadapisek`↔`Big C Place Ratchadapisek`、兩間 Emsphere 不可互換、`Ratchadamri 1`／`2` 不可互換），加碰撞偵測的正反案例。

**未解問題：**

1. 39 筆的實際 Our Branch 收錄數（39 是上限，可能更少）——執行上述工具後定案。
2. `code:"E52-01"`（Terminal 21 Pattaya，`company_code:"E52"`）算不算 Our Branch，隨 1 一起定案。芭達雅不在曼谷都會區，另需確認目的地歸屬。
3. **橘標補不上綠標那道 identity guard**：綠標每列都有 `branchCode` 可交叉核對，橘標的回應完全沒有分店識別碼，`branchNo` 只是從 caller 回填。唯一防線是 `data/superrich1965-branches.json` 正確——這放大了審閱意見 16，M2 的橘標 validator 不是可選項。
4. `data.update_time` 語意未驗證，已解析進 `sourceUpdatedAtMs` 但標註 UI 不得當作「官網報價時間」顯示（低優先，不卡任何 Phase）。

---

## M2 · Phase B — 分店建檔

**完成條件**（計畫 §6 B）：所有收錄分店有唯一對照、有效座標、來源連結；橘標對照檔與 `data/locations.csv` 收錄名單逐筆一致，且該驗證納入 pre-push gate。

**狀態：未開始**（等 M1 的 Our Branch 名單定案）。

**未解問題：**

1. `scripts/validate-superrich-mapping.mjs` 只認綠標，橘標需要新增 `scripts/validate-superrich1965-mapping.mjs`（審閱意見 16）。
2. 建檔要用的 `GET /spr/front/branches` 在 A0 #3 收到挑戰頁；可用的取得方式與本機 GET 結果仍待確認。正式匯率排程使用固定分店對照，不依賴每輪抓取這份 GET 清單。

---

## M3 · Phase C — 排程、儲存與控制

**完成條件**（計畫 §6 C）：部署後人工觸發第一輪並核對成功。

**狀態：未開始。**

**未解問題：** cron 頻率、單輪併發、逾時／重試預算要等 M1 的實際 Our Branch 數確定後才能填（39 只是上限估算）。挑戰辨識、403／429 退避、整輪停止條件與快照到期驗收依計畫 §5 定案；A0 的後續成功不代表可以放寬既有停止條件。獨立 Blobs 命名空間 `exchange-rates-1965/*`，不與綠標共用。

---

## M4 · Phase D1 — 前端

**完成條件**（計畫 §6 D1）：綠標既有行為（含排序、cluster 著色）不受影響；橘標卡片顯示自己的匯率、時間與橘標官網連結；marker 與 cluster 在 Google/HERE 一致；任一品牌故障不影響另一品牌。

**狀態：未開始。所有設計決定已定案**（計畫 §7.1 第 5–8 點）：cluster 三態、單一 sort select 取兩品牌聯集、排序 key 拆開、`state.exchange1965.*` 單一巢狀物件。

**未解問題：** 無開放決定；動工前重讀計畫 §3.2／§3.3／§4.4 與審閱意見 13–18。

---

## M5 · Phase E — 測試與手冊

**完成條件**（計畫 §6 E）：混合品牌排序回歸測試、任一品牌故障隔離測試、cluster 三態著色回歸測試、橘標卡片不得出現綠標官網連結的回歸測試；README 與 ADR 更新。

**狀態：未開始。**
