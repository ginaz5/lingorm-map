# SuperRich 1965（橘標）換匯地圖進度紀錄

> - 專案：Lingorm Bangkok Map
> - 建立日期：2026-09-09
> - 最後更新：2026-09-10
> - 目前里程碑：**M1 停住——Phase A0 未通過**（Netlify 環境的 POST 被 Cloudflare Managed Challenge 擋下，403）。A1 解析層已完成但暫時無用武之地；後續方向待決定
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
| M1 | Phase A0（POST 可行性）+ Phase A1（來源契約與純解析） | 無 | **進行中**——A1 解析層完成，A0 未執行 |
| M2 | Phase B（Our Branch 建檔，`Paused`）+ 橘標對照 validator | 無 | 未開始 |
| M3 | Phase C（排程、Blobs、breaker、控制旗標；預設停用） | 無 | 未開始 |
| M4 | Phase D1（前端品牌分派、三色 marker／cluster）+ 分店轉 `Published` | **上線** | 未開始 |
| M5 | Phase E（測試補齊、README、ADR） | 無 | 未開始 |

M1–M3 對使用者零可見變更，可安全停在任一處。M4 中途停會留下半成品 UI。

---

## M1 · Phase A0 — POST 可行性驗證

**完成條件**（計畫 §2.1、§6 A0）：在 **Netlify Deploy Preview 的 Function 環境**對 `POST /spr/front/exchange-rate/get` 拿到真實 200／SUCCESS 回應、且能解析出可用的 USD／TWD 數字，並存下 request／response 紀錄。本機終端機成功只是前置檢查，不能取代這一步。

**狀態：❌ 未通過（2026-09-10，Step 2 於 Deploy Preview #7 實測）。**

Claude 執行不了這兩步（審閱意見 19）——cloud container 與裝置端 sandboxed shell 對 `superrich1965.com` 的 GET／POST 都是 connection failure，且 `AGENTS.md` 規定不主動 deploy——故由使用者執行、Claude 判讀。

### Step 2 實測結果（`deploy-preview-7--lingorm-map.netlify.app`）

```json
{ "ok": false, "httpStatus": 403, "contentType": "text/html; charset=UTF-8",
  "elapsedMs": 174, "looksLikeChallenge": true, "retryAfter": null,
  "cfRay": "a38a2c0a0bc189da-CMH",
  "bodySnippet": "<!DOCTYPE html>...<title>Just a moment...</title>..." }
```

**判讀：Cloudflare Managed Challenge，不是流量限制。**

| 證據 | 意義 |
| --- | --- |
| `403` + `text/html` + `Just a moment...` | Cloudflare 互動式挑戰頁，需執行 JS 並回送 challenge token 才放行 |
| `elapsedMs: 174` | 秒拒，不是排隊、不是逾時 |
| `retryAfter: null` | 沒有「稍後再試」語意——退避、重試、circuit breaker 都救不了 |
| `cfRay: ...-CMH` | 請求由美國資料中心出去（Netlify Functions 的執行環境），不是使用者所在地 |

**這不是架構問題**：綠標的 `api.superrichthailand.com` 用同一套 Netlify Functions 排程在 production 跑得好好的。差別在 1965 這個端點前面有 Cloudflare bot management，綠標沒有。

**probe 的判斷正確**：`looksLikeChallenge` 把驗證頁跟真實 API 回應分開了，沒有把 403 HTML 誤判成單純的 API 錯誤，也沒有把它當成可重試的暫時性失敗。

**待補：Step 1（本機終端機）的結果尚未記錄**——這決定成因是「IP 信譽」還是「端點規則」，見未解問題 1。

**依計畫 §6 A0 的規定停住**：沒過就要重新評估整個排程可行性，不進 A1 剩餘工作。

**已交付的兩支 probe（暫時性，A0 記錄完即刪；Netlify 那支不可 merge 到 `main`）：**

| 檔案 | 用途 | 執行方式 |
| --- | --- | --- |
| `scripts/superrich1965-a0-probe.mjs` | Step 1 本機前置檢查；同時 export `probeExchangeRatePost()` 供 Step 2 重用 | `node scripts/superrich1965-a0-probe.mjs` |
| `netlify/functions/superrich1965-a0-probe.mjs` | Step 2 Deploy Preview 驗證（**真正的完成條件**） | 推 branch 後打 `/.netlify/functions/superrich1965-a0-probe` |

probe 的 `ok` 判定不只看 HTTP 200：要 response 能被解析層解出可用的 USD／TWD 數字才算過，並會嗅出 Cloudflare interstitial（HTML content-type／`Just a moment`／`challenge-platform`），避免把驗證頁誤判成成功。已用 stub fetch 離線驗過 happy path 與 challenge path 兩條分支。

**未解問題：**

1. **Step 1（本機、住宅 IP）到底過了沒？** 最關鍵的缺口。本機過而 Netlify 沒過 → 成因是資料中心 IP 信譽；兩邊都沒過 → 成因是端點規則或請求特徵，跟 IP 無關。兩者的後續完全不同。
2. **同一支 Netlify function 打 GET `/spr/front/branches` 會不會過？** 先前從別的環境打 GET 是乾淨回 JSON 的。GET 在 Netlify 過、POST 不過 → 是這個端點的規則；GET 也 403 → 是整個網域對資料中心 IP 的政策。加十行 probe、重推一次 preview 就能分辨。
3. probe 用的是可辨識的自訂 `User-Agent`（計畫 §2.1 的自我要求），這是我們自己引入的變數，可能被 bot management 扣分。

**不採取的路線：** 繞過 Cloudflare 挑戰——偽裝瀏覽器 `User-Agent`、用 headless browser 解 challenge、走住宅代理。網站在這個端點掛上 Managed Challenge，是營運方對「不歡迎自動存取」的明確表態，比 robots.txt 更具體；繞過它等同規避存取控制，不在本專案的做法範圍內。這條界線也適用於未來任何「換個方式再試試看」的提案。

---

## M1 · Phase A1 — 來源契約與純資料解析

**完成條件**（計畫 §6 A1）：USD/TWD 分桶對應清楚；39 筆分店的 Our Branch／排除名單定案。

**狀態：解析層完成（2026-09-09）；`groups[]` 分組核對未做（需 A0 通過後連線取得 `/spr/front/branches`）。**

**已完成：**

- `src/data/exchange-rates-1965.js`——純解析，無 network／DOM／storage。`parseBranchExchange1965()`、`parseBranchList1965()`、`parseRateText1965()`、`branchQuoteFailure1965()`、`normalizeBranchNo()`、`parseSourceUpdateTime()`。
- `tests/exchange-rates-1965-source.test.mjs`（29 測試）、`tests/fixtures/superrich1965/{exchange-rate-00,branch-list}.json`。
- 新模組加進 `jsconfig.json` 的 typecheck allowlist，並同批更新 `tests/typecheck-config.test.mjs`（該測試逐字斷言 include 陣列，兩者必須一起改）。

**驗證：**

| 項目 | 結果 |
| --- | --- |
| `npm run typecheck` | 通過 |
| `npm test` | **437 通過 / 0 失敗**（新增 29 筆，綠標既有行為不受影響）|
| `npm run build` | **通過**（2026-09-10，使用者本機驗證，Vite 成功建置） |

**兩個實作面的決定：**

- `parseRateText1965()` 是綠標 `parseRateText()` 的**刻意複製**（計畫 §1 的「平行複製一份」），不是 import。代價是 BigInt 進位邏輯有兩份、可能長歪，因此補了 cross-module 等價測試逐一比對兩個 parser 在同一組輸入向量下的輸出，發散就紅燈。
- 兩個端點的 envelope 不一致（`exchange-rate/get` 回 `code:"SUCCESS"`、`branch-list` 回 `code:"200"`），寫成兩個獨立檢查，不共用「兩種都收」的 helper——共用會讓 `exchange-rate/get` 也放行 `"200"`。

**未解問題：**

1. 39 筆要用 `/spr/front/branches` 的 `groups[]` 核對，才知道實際 Our Branch 收錄數（39 是上限，可能更少）。
2. `code:"E52-01"`（Terminal 21 Pattaya，`company_code:"E52"`）算不算 Our Branch，隨 1 一起定案。
3. **橘標補不上綠標那道 identity guard**：綠標每列都有 `branchCode` 可交叉核對，橘標的回應完全沒有分店識別碼，`branchNo` 只是從 caller 回填。唯一防線是 `data/superrich1965-branches.json` 正確——這放大了審閱意見 16，M2 的橘標 validator 不是可選項。
4. `data.update_time` 語意未驗證，已解析進 `sourceUpdatedAtMs` 但標註 UI 不得當作「官網報價時間」顯示（低優先，不卡任何 Phase）。

---

## M2 · Phase B — 分店建檔

**完成條件**（計畫 §6 B）：所有收錄分店有唯一對照、有效座標、來源連結；橘標對照檔與 `data/locations.csv` 收錄名單逐筆一致，且該驗證納入 pre-push gate。

**狀態：未開始**（等 M1 的 Our Branch 名單定案）。

**未解問題：** `scripts/validate-superrich-mapping.mjs` 只認綠標，橘標需要新增 `scripts/validate-superrich1965-mapping.mjs`（審閱意見 16）。

---

## M3 · Phase C — 排程、儲存與控制

**完成條件**（計畫 §6 C）：部署後人工觸發第一輪並核對成功。

**狀態：未開始。**

**未解問題：** cron 頻率、單輪併發、逾時／重試預算要等 M1 的實際 Our Branch 數確定後才能填（計畫 §5，39 只是上限估算）。獨立 Blobs 命名空間 `exchange-rates-1965/*`，不與綠標共用。

---

## M4 · Phase D1 — 前端

**完成條件**（計畫 §6 D1）：綠標既有行為（含排序、cluster 著色）不受影響；橘標卡片顯示自己的匯率、時間與橘標官網連結；marker 與 cluster 在 Google/HERE 一致；任一品牌故障不影響另一品牌。

**狀態：未開始。所有設計決定已定案**（計畫 §7.1 第 5–8 點）：cluster 三態、單一 sort select 取兩品牌聯集、排序 key 拆開、`state.exchange1965.*` 單一巢狀物件。

**未解問題：** 無開放決定；動工前重讀計畫 §3.2／§3.3／§4.4 與審閱意見 13–18。

---

## M5 · Phase E — 測試與手冊

**完成條件**（計畫 §6 E）：混合品牌排序回歸測試、任一品牌故障隔離測試、cluster 三態著色回歸測試、橘標卡片不得出現綠標官網連結的回歸測試；README 與 ADR 更新。

**狀態：未開始。**
