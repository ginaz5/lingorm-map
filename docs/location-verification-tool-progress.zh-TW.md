# 地點檢核工具進度紀錄

> - 專案：Lingorm Bangkok Map
> - 建立日期：2026-07-19
> - 最後更新：2026-07-20
> - 目前階段：Phase B 暫緩；正式地點改由 localhost 唯讀 Candidate 工具輔助、Notion 手動維護
> - 狀態：正式 schema 現為 17 欄；新契約、preflight、export bridge 與唯讀 UI 已同步，既有未核准資料 drift 仍 fail-closed
> - 設計依據：[地點檢核工具設計紀錄](location-verification-tool-design.zh-TW.md)

本文件只追蹤實際執行進度、驗證結果、run IDs、待辦與完成門檻。資料模型、決策語意、安全原則與階段設計以設計文件為準；若兩份文件衝突，應先更新設計文件，再同步本文件。

---

## 1. 範圍與安全邊界

- Phase A CLI 的歷史寫入能力仍由既有 runner 邊界保護；現行 localhost UI
  完全唯讀，不再暴露 PoC 或正式 Candidate／Review／Apply／座標修正寫入。
- 正式 `Locations` 已完成獨立核准的 additive schema migration、單頁 canary 與 97 筆 Review Needed 初始化；Candidate、人工決定、apply 或 Status 遷移仍須依逐筆流程與各自確認點執行。
- 正式 read／write token 已分離；正式 write helper 必須同時取得
  `NOTION_FORMAL_WRITE_API_KEY`、formal data source allowlist，以及單頁階段旗標或
  workflow 中該頁該段的 preview ticket／UI confirmation。缺少任一條件時
  fail-closed。
- `validate --all` 使用兩支最小權限 integration：`NOTION_API_KEY` 只分享給 PoC；`NOTION_FORMAL_READ_API_KEY` 只能有 Read content capability，且只分享給正式 `Locations`。不得把 PoC integration 分享給正式資料庫。
- `production-preflight` 與正式 queue preview 只使用 `NOTION_FORMAL_READ_API_KEY`；沒有 `--write`／`--confirm`，也不讀取 `NOTION_FORMAL_WRITE_API_KEY`。
- Resolver 只提供候選，不能自動將資料設為 `Published`。
- 沒有維護者的明確決定，不執行 `Accept Candidate` 或 `Keep Current`。
- PoC 可以修改完整 98 筆資料，但不得批次偽造 `Last Verified`、`Place ID Checked At`、`Verification Note` 或 `Coordinate Type`。
- 依 2026-07-19 官方 Places API policy，採 place-id-only persistence：
  - 可以保存 Candidate Place ID 與本系統的 workflow metadata。
  - 不保存 Places API 回傳的名稱、地址、Lat/Lng、營業狀態、距離、排名或 match score。
  - `Candidate Distance (m)` 已從設計與 PoC schema 移除。

### Notion 識別資料

| 項目 | ID／連結 |
|---|---|
| 正式 database | `ec7c23158ea283fda548813eb677e2bd` |
| 正式 data source | `e55c2315-8ea2-837d-9637-07c1118486c8` |
| 正式 `Locations` | <https://app.notion.com/p/ec7c23158ea283fda548813eb677e2bd> |
| `Locations (PoC)` database | `c74cd23a88f44aec83038f8437226f5e` |
| `Locations (PoC)` data source | `eefc0f40-698c-4870-97b7-e8860091f668` |
| `Locations (PoC)` | <https://app.notion.com/p/c74cd23a88f44aec83038f8437226f5e> |
| `Locations (Production Rehearsal)` database | `3a2c23158ea2817982ded6ed65bbbed8` |
| `Locations (Production Rehearsal)` data source | `173c23158ea283d8a33f876f53663251` |
| `Locations (Production Rehearsal)` | <https://app.notion.com/p/3a2c23158ea2817982ded6ed65bbbed8> |

---

## 2. 目前成果摘要

| 項目 | 狀態 | 結果 |
|---|---|---|
| 寫入前完整基線 | 完成 | 98 筆、98 個唯一 Slug、17 個正式欄位與正式 `Locations` 差異 0 |
| 本機 apply 核心 | 完成初版 | canonical revisions、PoC allowlist、place-id-only Payload、`pending → completed` patch |
| 檢核工具測試 | 完成 | 全專案 260/260、typecheck 與 production build 通過 |
| PoC schema | 完成 | 28 properties：17 個正式欄位 + 11 個檢核／恢復欄位 |
| Status options | 完成 | `Draft` / `Published` / `Paused` / `Inactive` |
| Derived views | 完成 | `待檢核`、`需要研究`、`已完成`、`過期或失敗` |
| 98 筆保守狀態遷移 | 完成 | 寫入全部成功，沒有失敗頁面 |
| 首筆 canary | 完成 | The Siam Hotel：`Keep Current` + `Exact` |
| Phase A 正式資料庫保護 | 通過 | 簽核時正式為 98 筆；1 個觀察到的正式欄位差異精確命中 append-only 核准，未核准欄位差異 0 |
| 實際 local runner CLI | 多決策真實執行完成 | resolve dry-run／write 與 apply dry-run／confirm 已實作；八筆真實 canary 已完成 |
| 真實決策 canary | 完成 | 四筆 `Keep Current`，以及 `Reject Candidate`、`Need Research`、`Could Not Find`、`Deactivate` 各一筆 |
| 失敗／重試／crash recovery | 完成 Phase A 範圍 | resolver response-loss、apply pending resume、completed response-loss、完成後重放、跨 process lock 與 stale-lock operator 已測試 |
| `validate --all` | 99 筆正式 live run 完成，結果 PASS | 六項全部通過；7 個核准正式差異、0 個未核准差異；零 Notion write |
| Phase A evidence audit | 技術門檻通過 | 必測案例、PoC write containment、place-id-only persistence 與 artifacts 掃描完成 |
| localhost operator UI | 已收斂為唯讀 | 只列 Review Needed、legacy Candidate dry-run、正式資料／來源、下一筆與 UI 內全量資料對帳；沒有 Notion write route |
| Notion Button webhook | 暫緩 | 維護者決定先以 Phase A 本機流程逐筆驗證 Location |
| Phase C0 正式只讀盤點 | 完成 | 正式目前 99 筆；相對 Phase A baseline 新增 `khlong-bang-luang-floating-market`，沒有移除 Slug |
| Production Rehearsal | 完成建立與基線比對 | 正式／複本各 99 筆，99 個唯一 Slug，17 欄逐筆差異 0 |
| Production preflight | 完成 read-only live run | 正式 17 欄完整、目標 workflow 0/11；正確回報 `BLOCKED`，零 Notion write |
| 現行 `validate --all` | PASS | 29 個觀察差異全數命中 exact approvals；retirement contract 與其餘 6 個 layer 全過、issues 0 |
| Rehearsal additive schema | 完成 | 新增 11 欄，共 28 properties；legacy＋target Status options 並存 |
| Rehearsal Review Needed 初始化 | 完成 | 99/99 update 成功；TRUE 98、FALSE 1、mapping mismatch 0 |
| Rehearsal canary／rollback | 完成 | 32Bar X `Verified → Paused → Verified`；回讀通過，17 欄差異回到 0 |
| 遷移期 app 相容 | 完成 | Parser 支援 9 個 legacy＋target status；UI 只呈現 `Verified`／`Needs Review`／`Published` |
| Versioned snapshot gate | 完成 | 至少 98 筆＋98 個受保護 Slug；raw status、座標與 `Published` 導航門檻 fail-closed |
| 99 筆 cutover baseline | 完成 | 新增 1 Slug、移除 0、未核准欄位差異 0；live read-only 二次驗證 hash 一致 |
| 正式 schema migration | 完成 | 17→28 欄；保留 6 個 legacy Status、追加 3 個 target Status；99 筆正式欄位 hash 未變 |
| 第一筆正式 page canary | 完成 | Khlong 只寫 `Review Needed: FALSE→TRUE`；Status 維持 Draft，正式欄位 hash 未變，confirm 重跑為 no-op |
| 正式 queue 初始化受限 route | 正式執行完成 | 97/97 TRUE patch 與逐筆回讀成功；最終 TRUE 98／FALSE 1，mapping mismatch 0，confirm 重跑為 no-op |
| 正式 localhost 單頁 UI | 歷史 canary 完成 | 舊的單頁／單階段寫入模式已從現行 UI server 移除 |
| 正式 localhost 自助佇列 | 現行唯讀模式完成 | 只載入 Review Needed；Candidate dry-run 不發 write ticket，Review／Apply／座標修正 API 不存在 |
| 正式 legacy resolver 實跑 | 完成且零寫入 | KAEW BOUTIQUE：existing Place ID candidate、距離約 2,367 m（high）；connector 回讀 Candidate／Review／Apply 欄位仍空白 |
| 正式 schema 28→20 欄精簡 | 完成 | 99 筆 archive、15 筆 Apply Metadata、1 筆 Candidate；page patch 0；精確 DROP、20 欄 readback、live validation 與 UI 走查均通過 |
| 正式 schema 20→17 欄精簡 | 程式同步完成 | 退役 `Branch Group`、`Coordinates Approx`、`Rejected Place IDs`；current contract 17/17、live preflight READY、UI 可載入，零 Notion write |

### 2.1 正式 8 欄退役進度

本輪使用
[`location-verification-formal-property-retirement-20260720.json`](location-verification-formal-property-retirement-20260720.json)
作為不可執行的 pre-drop archive／preview；它不單獨構成 Notion mutation
授權。

已完成：

- [x] 建立固定 8 欄 allowlist 與精確 `DROP COLUMN` 字串。
- [x] 以正式 read-only key 讀取 99 筆並逐頁保存 8 欄原值。
- [x] 封存 15 筆完整 `Apply Metadata`；archive hash 為
  `sha256:148750bda6efaa7c3c356ffcce04d3a1eba834c968ceffbc9575a5177c4803e9`。
- [x] 封存唯一 `channel-3-thailand-ch3` Candidate 的 Summary、Maps URL 與
  place-id-only Payload。
- [x] 確認兩筆 `Representative` 的重要語意已存在 `Verification Note`，不需
  補寫。
- [x] 確認 13 筆 `Place ID Checked At` 都不晚於 `Last Verified`，不需日期
  patch。
- [x] 最終 page patch 數為 `0`。
- [x] 正式 localhost queue response 與 UI 移除 retired property 依賴；Candidate
  仍只在當次 dry-run 記憶體顯示。
- [x] `production-preflight` 改以 16 個現行正式欄位＋4 個維護欄位判斷。
- [x] validator 新增 hash-bound retirement contract；只有 artifact、
  cutover baseline、99 Slug、8 欄 archive、DDL 與 plan hash 全部吻合時，才會
  在正式 baseline 對帳中忽略已退役的 `Origin`。其他 16 個正式欄位仍
  fail-closed。
- [x] retirement／runner／validator／read-only UI targeted tests 93/93。
- [x] 全專案 tests 260/260、typecheck 與 production build 通過。

精確 plan：

- Plan hash：
  `sha256:9f54c25c1aae25890e84bf4b3bc813b1f255c5a3376729b982d51d3b8fc260c8`
- DDL：
  `DROP COLUMN "Candidate Summary"; DROP COLUMN "Candidate Maps URL"; DROP COLUMN "Candidate Payload"; DROP COLUMN "Review Decision"; DROP COLUMN "Apply Metadata"; DROP COLUMN "Origin"; DROP COLUMN "Coordinate Type"; DROP COLUMN "Place ID Checked At"`
- Notion page patch：`[]`
- 本輪 Notion page write：`false`
- 本輪 Notion schema update：`1`

live `validate --all` 的 retirement layer 首次已 PASS，但 baseline layer 另外
發現以下 9 個現值差異。維護者其後確認全部都是刻意修改並要求保留：

| Slug | 欄位 | 目前契約值 | Notion 現值 |
|---|---|---|---|
| `bang-di-kai-hat-yai` | Status | `Verified` | `Published` |
| `butterbear-cafe-emsphere` | Coordinates Approx | `TRUE` | `FALSE` |
| `butterbear-cafe-emsphere` | Lat | `13.72` | `13.7322392` |
| `butterbear-cafe-emsphere` | Lng | `100.575` | `100.5668772` |
| `butterbear-cafe-emsphere` | Status | `Verified` | `Published` |
| `cafe-ban-nok-by-ple-venus` | Status | `Verified` | `Published` |
| `channel-3-thailand-ch3` | Google Maps URL | `https://www.google.com/maps/search/?api=1&query=Channel+3+Thailand+Bangkok` | `https://maps.app.goo.gl/CTfAHfTTBmHV7MYS6` |
| `yoru-omakase` | Coordinates Approx | `TRUE` | `FALSE` |
| `yoru-omakase` | Status | `Could Not Find` | `Inactive` |

DROP 前待辦與完成條件：

- [x] 維護者確認上述 9 個 Notion 現值均為刻意修改並要求保留。
- [x] 建立 9 筆 exact-value append-only approval entries；immutable approvals
  由 19 增為 28，cutover approval 維持 1，全部 `syncPoc=false`。
- [x] 重新 live 執行 `validate --all`：觀察差異 29、核准差異 29、未核准差異
  0、issues 0、全部 7 個 layer PASS。
- [x] 跑完整 test suite、typecheck 與 production build。
- [x] 正式 DROP 前重新 fetch data source schema，確認仍是同一 data source、
  28 欄且 8 個目標欄位全部存在、型別符合預期。
- [x] 重新封存 live 99 筆；archive hash 與 plan hash 均未改變。
- [x] 維護者明確核准上述 plan hash 與精確 DDL。
- [x] 執行一次 schema update，隨即 readback；正式 schema 為 20 欄，8 個
  退役欄位均不存在。
- [x] DROP 後 `validate --all` PASS，正式 Review Needed queue 與一筆 Candidate
  dry-run 瀏覽器走查通過。

DROP 後完成證據：

- Notion connector 獨立 readback：database
  `ec7c23158ea283fda548813eb677e2bd`、data source
  `e55c2315-8ea2-837d-9637-07c1118486c8`，schema property count `20`。
- live `validate --all`：PoC 98 筆、正式 99 筆、retired formal properties
  8；baseline、approvals、retirement、slug、target、PoC、formal 全部 PASS，
  issues 0，觀察差異 29、核准差異 29、未核准差異 0。
- localhost 唯讀 UI：載入 83 筆 `Review Needed`；選取
  `channel-3-thailand-ch3` 後完成 legacy Candidate dry-run，並在 UI 內完成
  全量資料對帳。Candidate 只存在當次回應，沒有寫入 Notion。
- browser console 的 error／warning 均為 0。

---

## 3. 寫入前基線

基線檔案：

- [`location-verification-poc-baseline-20260719.json`](location-verification-poc-baseline-20260719.json)
- [`location-verification-formal-cutover-baseline-20260719.json`](location-verification-formal-cutover-baseline-20260719.json)

保存內容：

- 98 筆 `Locations (PoC)` page URL。
- 98 個唯一且非空的 Slug。
- 每筆 17 個正式欄位。
- 正式與 PoC database／data source IDs。
- 保存時正式 `Locations` 與 `Locations (PoC)` 的逐欄差異數：`0`。

99 筆 cutover baseline 另行保存，沒有覆寫 Phase A 98 筆 immutable baseline：

- baseline ID：`formal-cutover-20260719-99`。
- 正式 data source：`e55c2315-8ea2-837d-9637-07c1118486c8`。
- Content SHA-256：`sha256:f6d3a8ec7fef47f61b25d68229eefd3554bd9cc6f75f4b61776ef80a5afe2e3f`。
- 相對舊 baseline：新增 `khlong-bang-luang-floating-market`；移除 0。
- 既有欄位差異：只接受 `formal-change-20260719-dear-december-cafe-notes-en-01`；未核准差異 0。
- `npm run location:cutover:capture -- --verify ...` 已再次唯讀正式資料，99 筆與 content hash 完全一致；沒有 Notion write。

寫入前分布：

| Status | 正式 Locations | Locations (PoC) |
|---|---:|---:|
| `Verified` | 81 | 81 |
| `Needs Review` | 16 | 16 |
| `Could Not Find` | 1 | 1 |

---

## 4. PoC schema 與 Views

### 4.1 新增的 11 個 properties

人工可見：

- `Review Needed`
- `Candidate Summary`
- `Candidate Maps URL`
- `Coordinate Type`
- `Review Decision`
- `Verification Note`
- `Last Verified`

技術／恢復：

- `Candidate Payload`
- `Apply Metadata`
- `Rejected Place IDs`
- `Place ID Checked At`

未建立：

- `Candidate Distance (m)`
- `Apply Decision` Button

### 4.2 Views

| View | View ID | 目前結果 |
|---|---|---:|
| `Default view` | `dd69f5b5cb98478ebb3fb5062f060120` | 98 |
| `待檢核` | `3a2c23158ea281a19326000c4c520079` | 95 |
| `需要研究` | `3a2c23158ea281c1a7bd000c78e0de23` | 0 |
| `已完成` | `3a2c23158ea281f68fc1000c6ec250b1` | 2 |
| `過期或失敗` | `3a2c23158ea28111ad0e000c035c6465` | 0 |

---

## 5. 全量保守狀態遷移

所有 98 筆 page update 都成功。每筆 migration patch 只包含：

- `Status`
- `Review Needed`

沒有在 migration patch 中修改名稱、座標、Place ID、Maps URL、來源或其他正式欄位。

遷移後、canary 套用前：

| Status | 筆數 |
|---|---:|
| `Paused` | 97 |
| `Inactive` | 1 |

兩筆 canary 套用後：

| Status | 筆數 |
|---|---:|
| `Published` | 2 |
| `Paused` | 95 |
| `Inactive` | 1 |

這是 PoC 的技術遷移，不代表 97 筆 legacy UI 資料已重新確認。未通過新流程的資料一律保持不在 UI 呈現的 `Paused`。

---

## 6. 首筆 canary 完整紀錄

### 6.1 地點與人工決定

- Page：[The Siam Hotel](https://app.notion.com/p/3a1c23158ea2817e9960c9ef2669721d)
- Slug：`the-siam-hotel`
- Review Decision：`Keep Current`
- Coordinate Type：`Exact`
- 人工備註：

```text
人工確認 The Siam Hotel 官網與 Google Maps 指向同一間 Dusit 河畔飯店；候選 Place ID 與目前一致，既有座標與候選差 4 公尺，保留目前資料。
```

### 6.2 Run IDs 與時間

- reviewRunId：`review-1d35e94f-2e1c-4352-b804-ebe49171f703`
- actionRunId：`action-7a6cbf32-bcca-4062-861c-38e20e536954`
- Candidate resolvedAt：`2026-07-19T06:42:26.471Z`
- Candidate reviewExpiresAt：`2026-08-18T06:42:26.471Z`
- Apply pending updatedAt：`2026-07-19T06:57:41.478Z`
- Apply completed updatedAt：`2026-07-19T06:58:24.291Z`
- Notion `Last Verified`：`2026-07-19T06:58:00.000Z`
- Notion `Place ID Checked At`：`2026-07-19T06:58:00.000Z`

完整秒與毫秒保留在 `Apply Metadata` 與 append-only `Verification Note`；Notion Date property 儲存時正規化至分鐘。

### 6.3 Candidate 與 apply 結果

Candidate：

- Payload envelope：`lv2:`
- `schemaVersion = 2`
- `result = place_id_candidate`
- Candidate Place ID 與正式 Place ID 相同。
- Payload 未包含名稱、地址、Lat/Lng、營業狀態、距離或 match score。

Apply：

```text
pending → completed
```

最終狀態：

- `Status = Published`
- `Review Needed = FALSE`
- `Coordinate Type = Exact`
- `Apply Metadata.state = completed`
- Candidate Summary、Candidate Maps URL、Candidate Payload、Review Decision 已清除。
- 正式 Lat/Lng、Google Place ID 與既有 Google Maps URL 保持不變。
- `Verification Note` 保留人工理由、decision、reviewRunId 與 actionRunId。

---

## 7. 程式與驗證

新增／更新：

- [`scripts/location-verification-core.mjs`](../scripts/location-verification-core.mjs)
- [`scripts/location-verification-runner.mjs`](../scripts/location-verification-runner.mjs)
- [`scripts/location-verification-validator.mjs`](../scripts/location-verification-validator.mjs)
- [`scripts/location-verification-ui-server.mjs`](../scripts/location-verification-ui-server.mjs)
- [`tools/location-verification-ui/index.html`](../tools/location-verification-ui/index.html)
- [`tools/location-verification-ui/app.js`](../tools/location-verification-ui/app.js)
- [`tools/location-verification-ui/styles.css`](../tools/location-verification-ui/styles.css)
- [`location-verification-formal-change-approvals.json`](location-verification-formal-change-approvals.json)
- [`tests/location-verification-core.test.mjs`](../tests/location-verification-core.test.mjs)
- [`tests/location-verification-runner.test.mjs`](../tests/location-verification-runner.test.mjs)
- [`tests/location-verification-ui-server.test.mjs`](../tests/location-verification-ui-server.test.mjs)
- [`tests/location-verification-validator.test.mjs`](../tests/location-verification-validator.test.mjs)
- [`.env.example`](../.env.example)
- [`package.json`](../package.json)

核心已涵蓋：

- PoC data source allowlist。
- Legacy → target Status 的保守 mapping。
- canonical basis／workflow revisions。
- schemaVersion 2、`lv2:` envelope 的 place-id-only Candidate Payload。
- `lv1:` envelope 的 Apply Metadata。
- `pending` 與 `completed` patch。
- `Keep Current`、`Accept Candidate`、`Reject Candidate`、`Need Research`、`Could Not Find`、`Deactivate` 的 patch 規則。
- 過期候選阻擋。
- Accept 不從 Places response 寫入 Lat/Lng。
- Notion REST page read 與 PoC data source allowlist。
- 現有 Place ID refresh；dry-run 可在 Places API (New) 權限不足時 fallback，write 固定使用已核准的 legacy Places。
- Text Search 多筆結果保守轉為 `ambiguous`，不自動採用第一筆。
- 重複 Place ID query 與預設阻擋。
- dry-run 預設模式與完整 patch 預覽。
- resolve write 只轉換五個 Candidate workflow 欄位；不接受正式欄位。
- write 前第二次讀取並核對 17 個正式欄位、basis／workflow revision 與既有 Candidate。
- write 後重新讀取並核對 Candidate patch 與正式欄位。
- Notion 已套用 patch 但 response 遺失時，以同一 reviewRunId 重新讀取恢復。
- 頁面已有 Candidate Payload／Summary／Maps URL 時拒絕覆蓋。
- apply dry-run 重新讀取頁面並驗證人工決定、Candidate Payload、期限及 basis／workflow revisions。
- apply dry-run 使用同一 actionRunId 預覽 `pending` 與 `completed` patches，不寫入 Notion。
- apply confirm 寫入前再次讀取並對帳，先只寫 `Apply Metadata.state = pending`，再以單一最終 PATCH 套用正式結果、清除 Candidate 欄位並改為 `completed`。
- pending 重試沿用原 actionRunId 與 timestamp；完成後重放直接回傳既有成功結果，不建立第二個 action。
- apply 最終 PATCH 回應遺失時重新讀取 `completed` 對帳；確定最終 PATCH 未完成時保留 `pending` 供安全重試。
- 寫入後核對正式欄位、Candidate 清除、run IDs、Verification Note 與日期；Notion Date property 以實際分鐘精度比較，完整時間保留在 metadata／audit note。
- `Accept Candidate`、`Reject Candidate` 在 apply 當下重新 query Place ID；resolver 後才產生的重複資料也會在 pending 前阻擋。
- `Inactive` 不得透過舊 apply request 回到 `Published`；已在 `Rejected Place IDs` 的候選不得 Accept／Reject。
- 每個 `apply --confirm` 先以 page ID 在作業系統暫存目錄建立跨 process 原子 lock file；另一個 CLI 在任何 Notion read/write 前 fail-closed。正常完成與錯誤路徑都會釋放 lock；stale lock 使用 `lock inspect` 與明確 `lock clear --confirm`，不自動搶鎖。
- lock clear 只接受 same-host、owner PID 已不存在且 metadata 完整的 schemaVersion 2 lock；active、remote、malformed、PID 不明或 inspection 後 token 改變都拒絕。短暫 maintenance guard 會阻擋同時的新 lock acquisition。
- `validate --all` 讀取保存基線、PoC 與正式資料，依序檢查 target invariants、98-Slug 完整性、PoC 正式欄位差異的 completed action trace，以及正式 17 欄 baseline drift；發現問題只回報並以非零狀態結束，不寫入或自動修正。
- PoC 與正式查詢分別使用 `NOTION_API_KEY` 與 `NOTION_FORMAL_READ_API_KEY`；缺少任一支 token 時，在發出 Notion query 前 fail-closed。自動化測試確認整條 validate 路徑沒有 `PATCH`。
- 原始 baseline 以 SHA-256 綁定 append-only 正式變更核准 manifest。每個 `Slug + field` 的第一筆 `fromValue` 必須等於 immutable baseline，後續核准必須從上一個核准值接續；只有鏈尾的精確 canonical value 可通過。`syncPoc` 在 Phase A 必須為 `false`。

驗證結果：

| 檢查 | 結果 |
|---|---|
| `npm run test:location-verification` | 88/88 通過 |
| `npm test` | 212/212 通過 |
| Production build | 通過 |
| 設計文件 code fences／禁用術語／trailing whitespace | 通過 |
| 完整 `npm test` | 176/178；兩個既有 theme/mobile UI 測試失敗，與本次檢核工具修改無關 |
| `npm run typecheck` | 既有 `src/map.js` 兩個 theme 型別錯誤；本次未修改該檔 |

Phase A 已完成：local runner、真實決策 canary、recovery、stale-lock operator、98 筆全量對帳、技術 evidence audit 與維護者操作流程簽核均已通過。Phase B 已由維護者決定暫緩。

### 7.1 漢王廟真實 resolve dry-run

執行指令：

```bash
npm run location:verify -- resolve \
  --page 3a1c23158ea2810c9814d95050c65916 \
  --dry-run
```

執行紀錄：

- Page：[漢王廟 (Han Wang Miao)](https://app.notion.com/p/3a1c23158ea2810c9814d95050c65916)
- Slug：`han-wang-miao`
- Data source：`eefc0f40-698c-4870-97b7-e8860091f668`
- 執行前狀態：`Status = Paused`、`Review Needed = TRUE`
- result：`place_id_candidate`
- candidateSource：`existing_place_id`
- verificationMethod：`places_refresh`
- API mode：`places_legacy`
- reviewRunId：`review-3a41eee7-3c82-4fd5-98c0-db50b556e5d0`
- resolvedAt：`2026-07-19T07:39:43.907Z`
- reviewExpiresAt：`2026-08-18T07:39:43.907Z`
- basisRevision：`sha256:25e03b5761b08c9f436ec6ded7314072dcfdc804087cc6c203500455a2f43ee6`
- workflowRevision：`sha256:b900c85753abcf28349fe103806c105dbf9b3dc847be73f889cac74edf947746`
- 目前與候選 Place ID：`ChIJV1IuJt-Y4jARPT2vTiO3JvM`
- proposed summary：`[Candidate Ready]`
- runner 結果：`NOTION_WRITE_PERFORMED=false`

Places API (New) 的 Place ID refresh 回覆 HTTP 403，因此 runner 使用專案既有、已確認可運作的 legacy Places endpoint 完成當次互動。這個 fallback 不改變 place-id-only persistence 邊界。

執行後重新讀取 Notion：

- `Status` 仍為 `Paused`。
- `Review Needed` 仍為 TRUE。
- Candidate Summary、Candidate Maps URL、Candidate Payload 與 Review Decision 仍為空。
- 正式 Place ID、Lat、Lng 與 Maps URL 均未改變。
- 沒有將 Places API 回傳的名稱、地址、Lat/Lng、營業狀態、距離或排名寫入 Notion、Git 或 snapshot。

### 7.2 漢王廟真實 resolve write

執行指令：

```bash
npm run location:verify -- resolve \
  --page 3a1c23158ea2810c9814d95050c65916 \
  --write
```

執行紀錄：

- Page：[漢王廟 (Han Wang Miao)](https://app.notion.com/p/3a1c23158ea2810c9814d95050c65916)
- Slug：`han-wang-miao`
- Data source：`eefc0f40-698c-4870-97b7-e8860091f668`
- result：`place_id_candidate`
- candidateSource：`existing_place_id`
- verificationMethod：`places_refresh`
- API mode：`places_legacy`
- reviewRunId：`review-1f3ae462-b875-4db9-b685-ccf791a0eff3`
- resolvedAt：`2026-07-19T07:54:13.145Z`
- reviewExpiresAt：`2026-08-18T07:54:13.145Z`
- basisRevision：`sha256:25e03b5761b08c9f436ec6ded7314072dcfdc804087cc6c203500455a2f43ee6`
- workflowRevision：`sha256:b900c85753abcf28349fe103806c105dbf9b3dc847be73f889cac74edf947746`
- 目前與候選 Place ID：`ChIJV1IuJt-Y4jARPT2vTiO3JvM`
- recoveredAfterWriteError：`false`

實際 PATCH 只包含：

- `Review Needed = TRUE`
- `Candidate Summary = [Candidate Ready]`
- `Candidate Maps URL`
- place-id-only `Candidate Payload`
- 清空 `Review Decision`

runner 寫後讀取與獨立 Notion 讀取均確認：

- Candidate patch 與預覽完全一致。
- Candidate Payload 保存上述完整 reviewRunId、兩種 revisions 與 review expiry。
- `Status` 仍為 `Paused`。
- 17 個正式欄位全部不變。
- 沒有寫入 Places API 回傳的名稱、地址、Lat/Lng、營業狀態、距離或排名。
- Notion 獨立讀取時間：`2026-07-19T07:54:14.513Z`。

同一命令第二次執行時，在 Places 呼叫與 Notion PATCH 前拒絕：

```text
Refusing overwrite: existing candidate workflow fields: Candidate Payload, Candidate Summary, Candidate Maps URL
```

### 7.3 漢王廟人工決定與 apply dry-run

依維護者明確指示，只更新下列三個 Notion properties：

- `Review Decision = Keep Current`
- `Coordinate Type = Exact`
- `Verification Note = 人工確認 Google Maps 候選與漢王廟為同一地點；候選 Place ID 與目前一致，保留目前正式資料。`

寫入前後均重新讀取頁面；Candidate Payload、Candidate Maps URL、Candidate Summary、Status 與其他正式欄位未因這次人工欄位更新而改變。

執行指令：

```bash
npm run location:verify -- apply \
  --page 3a1c23158ea2810c9814d95050c65916 \
  --dry-run
```

執行紀錄：

- actionRunId：`action-4f8712e3-3e5b-42d6-ae85-382201baccb6`
- reviewRunId：`review-1f3ae462-b875-4db9-b685-ccf791a0eff3`
- Candidate result：`place_id_candidate`
- Review Decision：`Keep Current`
- Coordinate Type：`Exact`
- dry-run timestamp：`2026-07-19T08:11:50.401Z`
- pending preview：`Apply Metadata.state = pending`
- completed preview：`Apply Metadata.state = completed`
- 唯一預期正式欄位變更：`Status = Published`
- runner 結果：`NOTION_WRITE_PERFORMED=false`

completed preview 另外包含：

- `Review Needed = FALSE`
- `Last Verified` 與 `Place ID Checked At`
- append-only Verification Note audit entry
- 清除 Candidate Summary、Candidate Maps URL、Candidate Payload 與 Review Decision
- 不包含 Lat、Lng 或 Google Place ID patch

dry-run 後獨立重新讀取 Notion，確認：

- `Apply Metadata` 仍為空。
- `Status` 仍為 `Paused`。
- `Review Needed` 仍為 TRUE。
- Candidate workflow 欄位與人工決定仍保留。
- 沒有套用 pending 或 completed patch。

### 7.4 漢王廟真實 apply confirm

執行指令：

```bash
npm run location:verify -- apply \
  --page 3a1c23158ea2810c9814d95050c65916 \
  --confirm
```

實際 action：

- actionRunId：`action-fad3de42-8537-4502-b52a-7b28c668a33a`
- reviewRunId：`review-1f3ae462-b875-4db9-b685-ccf791a0eff3`
- decision：`Keep Current`
- Apply Metadata updatedAt：`2026-07-19T08:30:48.094Z`
- Notion `Last Verified`：`2026-07-19T08:30:00.000Z`
- Notion `Place ID Checked At`：`2026-07-19T08:30:00.000Z`

runner 先寫入只包含 `Apply Metadata.state = pending` 的 PATCH，再用單一最終 PATCH 寫入：

- `Apply Metadata.state = completed`
- `Status = Published`
- `Review Needed = FALSE`
- `Last Verified` 與 `Place ID Checked At`
- 保留人工理由並追加兩個 run IDs 的 `Verification Note`
- 清除 Candidate Summary、Candidate Maps URL、Candidate Payload 與 Review Decision

Notion connector 與 runner 回讀確認：

- `Coordinate Type = Exact` 保留。
- 正式 Lat `13.73288`、Lng `100.51218`、Google Place ID `ChIJV1IuJt-Y4jARPT2vTiO3JvM` 與既有 Google Maps URL 均未改變。
- 唯一正式欄位差異是 `Status: Paused → Published`。
- Candidate workflow 欄位已清除，Apply Metadata 與 Verification Note 均含相同 actionRunId／reviewRunId。

首次最終回讀發現 Notion Date property 會把秒與毫秒正規化至分鐘，因此舊的精確 timestamp 字串比較雖然所有寫入已完成，仍回報兩個日期不一致。runner 已改為依 Notion 的分鐘精度驗證日期，metadata 與 audit note 仍保留完整 `2026-07-19T08:30:48.094Z`。

修正後再次執行相同 `--confirm`，runner 從 `Apply Metadata.state = completed` 與 Verification Note 對帳到原 action，回傳：

```text
LOCATION VERIFICATION — APPLY ALREADY COMPLETE
NOTION_WRITE_PERFORMED=false (idempotent replay)
```

沒有建立第二個 action，也沒有重複追加 Verification Note 或改寫日期。

### 7.5 四筆真實多決策 canary

維護者指定四筆 `Locations (PoC)` page，並明確決定：

| Page | Review Decision | Coordinate Type | reviewRunId | actionRunId | 最終狀態 |
|---|---|---|---|---|---|
| [Tribe Sky Beach Club](https://app.notion.com/p/3a1c23158ea2810ea1ddffc9c982fd21) | `Keep Current` | `Representative` | `review-a26ab6f3-587a-4bcf-97cd-0322a6d7a423` | `action-5e6df0d7-1bb5-4548-8566-b4383530f281` | `Published` |
| [SkyRise Adventures](https://app.notion.com/p/3a1c23158ea281b0a1b8ee0ce2200de8) | `Keep Current` | `Exact` | `review-4416ae50-695c-4944-a3f9-c482f682f946` | `action-28fe9f8c-16b9-41d8-82f6-1746a2a61c04` | `Published` |
| [ข้ามันบ้านนอก by บ้านนอกคอกนาเขาใหญ่](https://app.notion.com/p/3a1c23158ea2812897a7fb956ab44526) | `Could Not Find` | 不適用 | `review-2d6d30df-31dc-4ecf-9b21-75a164a4462a` | `action-205abbd0-e6c0-4ee1-8df2-76ef3829b6ae` | `Inactive` |
| [Yoru Omakase](https://app.notion.com/p/3a1c23158ea281abbefdd205a02861bb) | `Deactivate` | 不適用 | 不適用 | `action-07772f4c-ad38-49a3-abf5-fb202521af89` | `Inactive` |

執行流程與結果：

- 四筆 resolver 均使用 legacy Places API；Candidate 寫入後均由 runner 對帳，正式欄位未變。
- `by` resolver 結果為 `ambiguous`；維護者仍依人工決定選擇 `Could Not Find`。這符合設計中「不強制 result = no_candidate」的規則。
- Yoru 的 Places refresh 顯示目前 Place ID 對應地點永久停業；維護者先把測試 page 調回 `Paused`，再明確選擇 `Deactivate`。
- 首次 apply dry-run 發現 Tribe 與 SkyRise 缺少 `Coordinate Type`，因此沒有執行任何 confirm；維護者補充決定後才重跑。
- 第二輪四筆 apply dry-run 全數通過，預期唯一正式欄位變更分別為 `Paused → Published`、`Paused → Published`、`Paused → Inactive`、`Paused → Inactive`。
- 四筆 `apply --confirm` 均完成 `pending → completed`，`Completed patch matched = true`、`Formal fields matched = true`，沒有進入恢復路徑。
- 最終獨立回讀確認四筆皆為 `Apply Metadata.state = completed`、`Review Needed = FALSE`，Candidate Summary、Candidate Maps URL、Candidate Payload 與 Review Decision 均已清除。
- Tribe 與 SkyRise 已寫入 `Last Verified`、`Place ID Checked At`；`by` 與 Yoru 已寫入 `Last Verified`。Notion 顯示時間均正規化為 `2026-07-19T09:16:00.000Z`，完整時間仍保留於 audit metadata。
- 本輪只寫入 `Locations (PoC)`；沒有將 Places API 回傳的名稱、地址、座標、營業狀態、距離或排名保存到 Notion、log、Git 或 snapshot。

### 7.6 Reject Candidate 與 Need Research 真實 canary

維護者授權先從剩餘 `Paused` pages 以 legacy resolver dry-run 篩選，再對 shortlist 明確確認決策。為了讓 dry-run 可直接指定 legacy API，CLI 新增：

```bash
npm run location:verify -- resolve \
  --page <page-id-or-url> \
  --dry-run \
  --places-api legacy
```

這段最初實作時，`--places-api` 允許 `auto` 或 `legacy`，預設為 `auto`，而 `resolve --write` 固定 legacy。2026-07-19 維護者其後決定所有後續 resolver 都使用 legacy；CLI 現在預設 legacy，且明確拒絕 `auto`。內部保留 Places New 相容測試，但不作為操作入口。

篩選階段：

- 從 `待檢核` view 讀取 92 筆尚未完成的 `Paused` pages。
- 先對名稱含糊、來源要求確認、座標標為近似或有分店風險的子集執行 dry-run。
- 第一批實際執行 10 筆，全部顯示 `API mode = places_legacy` 與 `NOTION_WRITE_PERFORMED=false`。
- 維護者確認 Bang Di Kai Hat Yai 作為 `Reject Candidate`、Yua Cafe & Dining 作為 `Need Research`，篩選工具沒有代替維護者決策。

最終執行：

| Page | Review Decision | reviewRunId | actionRunId | 最終狀態 |
|---|---|---|---|---|
| [Bang Di Kai Hat Yai](https://app.notion.com/p/3a1c23158ea281f9af17e44b479532ff) | `Reject Candidate` | `review-7fa782f4-8604-4767-a4ff-025d52209fe2` | `action-e29ce8d4-fc0a-4533-a44c-500d79b11793` | `Paused`、`Review Needed = TRUE` |
| [Yua Cafe & Dining](https://app.notion.com/p/3a1c23158ea281ed8a2ac2799a0d010b) | `Need Research` | `review-6b4c72b1-095d-4446-afc9-ea3bc1a55586` | `action-d4e21689-032b-47fc-a49d-771599f9b29b` | `Paused`、`Review Needed = TRUE` |

回讀結果：

- 兩筆 resolver write 均使用 legacy Places、`Candidate patch matched = true`、`Formal fields unchanged = true`。
- 兩筆 apply dry-run 的預期正式欄位變更均為空 `{}`，通過後才執行 confirm。
- Bang Di 完成後，候選 Place ID 已追加至 `Rejected Place IDs`；Candidate Summary、Maps URL、Payload 與 Review Decision 已清除，正式資料保持不變。
- Yua 完成後刻意保留 Candidate Summary、Maps URL、Payload 與 `Review Decision = Need Research`，繼續留在研究佇列；沒有加入拒絕清單。
- 兩筆皆為 `Apply Metadata.state = completed`，Verification Note 保留維護者理由與 action／review run IDs。
- 兩筆 confirm 均為 `Completed patch matched = true`、`Formal fields matched = true`，未進入恢復路徑。

### 7.7 `validate --all` 與三層全量對帳

可重複執行的命令：

```bash
npm run location:verify -- validate --all
```

驗證器採 fail-closed、只回報、不自動修正，並執行三層檢查：

1. 對全部 PoC page 執行 target Status、Candidate Payload、Candidate lifecycle、日期、座標、Place ID 與 review invariants。
2. 核對基線、PoC 與正式資料仍為同一組 98 個唯一 Slug；PoC 相對保守 migration 的每個 17 欄正式欄位差異，必須能追溯到 `Apply Metadata.state = completed`、允許該欄位的決定及含 actionRunId 的 `Verification Note`。
3. 使用獨立 read-only integration 讀取正式 `Locations`，核對 98 筆、17 個正式欄位與 immutable baseline 加上精確值核准鏈相符。

2026-07-19 實際執行狀態：

- 65/65 自動化測試通過，包含三層通過／失敗案例、分頁查詢、雙 token 隔離、含標題 Notion URL 的 page ID 正規化、正式核准鏈、validate 路徑零 PATCH，以及 page lock 的 active／stale／malformed／競態案例。
- 正式 data source ID 與 17 欄 schema 已另由 Notion connector 確認正確。
- 原 PoC token 查詢正式 data source 會得到 404，證明它沒有正式資料權限，符合原本安全邊界。
- `NOTION_FORMAL_READ_API_KEY` 設定後已實際讀取完整 PoC 與正式資料，各為 98 筆。
- 首輪出現 36 筆 `POC_PAGE_ID_DRIFT`；只讀診斷確認為 URL 標題尾端的十六進位字元污染 page ID parser，並非 Notion page 真的更換。改為優先比較 API `page.id`、URL fallback 只取最後 32 個十六進位字元後，回歸測試與 live rerun 均通過 98-Slug layer。
- 首次有效 live 結果為正式 baseline drift FAIL，唯一差異是 `dear-december-cafe / Notes EN`：目前正式值移除了基線中的 `MIRROR member` 與結尾 `✓ Visited.`。
- PoC 分布為 `Published = 4`、`Paused = 92`、`Inactive = 2`。保守 migration 共有 98 個 Status 差異；其後 5 個正式欄位差異全部可追溯到 completed action。
- 維護者確認這是刻意修改，並決定保留原始 baseline、只核准目前精確值、PoC 暫不同步。新增 `location-verification-formal-change-approvals.json`，以原始 baseline SHA-256 綁定 append-only 核准鏈。
- 最終 rerun：baseline contract、formal approval contract、98-Slug integrity、target invariants、PoC action reconciliation 與 formal baseline drift 全部 PASS。
- 正式層觀察到 1 個相對 immutable baseline 的差異、1 個精確值核准、0 個未核准差異；manifest 的核准數為 1。
- 最終輸出為 `NOTION_WRITE_PERFORMED=false`、`VALIDATION_RESULT=PASS`。

### 7.8 stale page lock operator 與 KAEW BOUTIQUE 實跑

本機 operator 指令：

```bash
npm run location:verify -- lock inspect --page <page-id-or-url>
npm run location:verify -- lock clear --page <page-id-or-url> --confirm
```

- `lock inspect` 只讀取作業系統暫存目錄的 page lock，不讀寫 Notion。
- `lock clear` 不會自動判斷後直接刪除；除了明確 `--confirm`，只允許 metadata 完整、`schemaVersion = 2`、屬於本機 hostname 且 owner PID 已不存在的 stale lock。
- active、remote、malformed、PID 無法判斷，以及 inspect 後 lock token 被替換的情況一律 fail-closed 並保留原 lock。
- clear 期間建立短暫 maintenance guard；同時啟動的新 apply 在任何 Notion read/write 前即被阻擋。
- `apply --confirm` 建立的新 lock 會記錄 hostname；正常結束與 runner 錯誤仍會釋放 lock。

2026-07-19 對 [KAEW BOUTIQUE](https://app.notion.com/p/ginalin/KAEW-BOUTIQUE-475c23158ea282dfbf3d019ead10ba0d?source=copy_link) 實際執行 `lock inspect`：

- 正規化 page ID：`475c23158ea282dfbf3d019ead10ba0d`。
- 結果：`state = absent`、`clearable = false`，沒有殘留 apply lock。
- 因為沒有 lock，所以未執行 `lock clear --confirm`；本次沒有本機 lock write，也沒有 Notion read/write。
- inspect 後再次執行 `validate --all`，PoC／正式各 98 筆、全部 contract／layer PASS、issues 0、`NOTION_WRITE_PERFORMED=false`。

### 7.9 Phase A 最終 evidence audit

2026-07-19 完成 Phase A 技術 evidence audit。`Phase A／B 必測案例` 中，Button、webhook delivery、外部 durable store 與 automation pause 屬於 Phase B，不列入本機 Phase A gate；其餘本機案例均有自動化測試、live validator 或真實 canary 證據。

| Phase A 證據群組 | 證據 | 結果 |
|---|---|---|
| 初始基線與完整性 | immutable baseline 保存 98 筆、98 個唯一 Slug、17 個正式欄位；`validate --all` 同時對帳 baseline／PoC／正式 | 通過 |
| dry-run 與 write containment | CLI 預設 dry-run；非 PoC parent 在任何 write 前失敗；resolver／apply patch converter 使用欄位 allowlist | 通過 |
| Resolver 與 Candidate lifecycle | existing Place ID refresh、legacy fallback、ambiguous、no candidate、重複 Place ID、既有 Candidate 拒絕覆蓋與 concurrent Candidate 測試 | 通過 |
| place-id-only persistence | core 拒絕 Places 名稱、地址、Lat/Lng、營業狀態、距離、排名與分數；live target validator 對全部 98 筆執行相同 Payload contract | 通過 |
| 六種決定與狀態轉移 | core／runner 測試涵蓋 Accept、Keep Current、Reject、Need Research、Could Not Find、Deactivate；八筆真實 canary 涵蓋所需人工結果 | 通過 |
| revision、期限與重放 | expired、basis／workflow revision、Rejected Place ID、Inactive 舊請求、completed replay 與 completed state drift 均 fail-closed | 通過 |
| 冪等、response loss 與 crash recovery | resolver response-loss、pending resume、completed response-loss、跨 process lock、active／stale／malformed／token replacement lock | 通過 |
| target UI eligibility | 四種 Status、Candidate lifecycle、日期、座標、Place ID、12 個月 refresh 與 completed action trace 由 validator 檢查 | 通過 |
| 網站快照與 UI 邊界 | snapshot schema／98-Slug 測試與 public status allowlist 測試，確認不在 UI 呈現的資料不被前端渲染 | 通過 |
| 最終 live gate | PoC／正式各 98 筆；全部 contract／layer PASS、issues 0、未核准正式差異 0、零 Notion write | 通過 |

Notion write containment 稽核：

- 全 repo 實際 Notion `PATCH` 只有 `location-verification-runner.mjs` 的 Candidate write 與 Apply write 兩個呼叫點。
- CLI 不接受 data source ID 參數；固定 allowlist 為 `eefc0f40-698c-4870-97b7-e8860091f668`。
- 流程入口先拒絕非 PoC expected ID，讀頁後再核對 page parent；本次 audit 另讓兩個內部 `PATCH` helper 在送出 request 前再次直接驗證 PoC ID。
- 自動化測試確認 production data source、非 allowlist page 與正式 read token 都無法進入 write；`validate --all` 的 query 路徑沒有 `PATCH`。
- PoC integration 實測無法查詢正式資料庫；正式驗證 integration 為 read-only。Phase A 當時的正式 live drift 只有 1 個維護者已核准的刻意內容修改，沒有工具 action trace 冒充正式 write。

Places content persistence 稽核：

- `Candidate Payload` 的禁止鍵與 discriminated-union validator 同時用於 write 前與 98 筆 live validation。
- Candidate converter 只允許五個 workflow 欄位；Apply 不會把 Places Lat/Lng 寫入正式座標。
- Resolver 的名稱、地址、Places Lat/Lng、營業狀態與距離只存在當次 process 記憶體並直接顯示於互動 terminal；沒有持久化 log 或 snapshot sink。
- `docs/` 與 `data/` 掃描未發現 resolver 的暫時候選輸出格式，也未發現帶禁止鍵的 `lv2:` Payload。測試檔內的 `Example Address` 等內容是合成 fixture，不是真實 Places response。
- runner 唯一的檔案寫入是作業系統暫存目錄中的 apply lock 與 maintenance metadata，不包含地點或候選內容。

最終重跑：

- `npm run test:location-verification`：65/65 通過。
- `npm run location:verify -- validate --all`：全部 PASS、issues 0、`NOTION_WRITE_PERFORMED=false`。
- `npm run build`：通過。
- 完整 `npm test`：176/178；仍只有既有 theme／mobile UI 兩項失敗，與 location verification 無關。

### 7.10 Phase B 暫緩與 32Bar X 完整檢核流程

2026-07-19 維護者決定：

- 暫緩 Phase B，不建立 Notion Button、webhook 或外部 durable store。
- 先持續使用已完成簽核的 Phase A 本機流程逐筆驗證 Location。
- 後續 resolver dry-run 與 write 一律使用 legacy Places API；CLI 預設與唯一允許的 `--places-api` 值均為 `legacy`。

從 `Locations (PoC)` 的 `待檢核` view 選擇 32Bar X：

- Page：<https://app.notion.com/p/32Bar-X-3a1c23158ea281fe9f05dc488851e7ce>
- Slug：`32bar-x`
- 選擇時狀態：`Paused`、`Review Needed = TRUE`、沒有 Candidate Payload 或 Review Decision。
- 選擇理由：已有 Place ID、座標不是近似值且沒有未完成 Candidate，適合作為下一筆低風險檢核。

執行：

```bash
npm run location:verify -- resolve \
  --page https://app.notion.com/p/3a1c23158ea281fe9f05dc488851e7ce \
  --dry-run \
  --places-api legacy
```

結果：

- `API mode = places_legacy`
- `result = place_id_candidate`
- `candidateSource = existing_place_id`
- 候選與目前 Place ID 相同：`ChIJWUGdH6yZ4jARaV06hryr5NE`
- `reviewRunId = review-99f0097e-79a8-4e1e-9368-f4cd11ac380a`
- `reviewExpiresAt = 2026-08-18T11:28:05.466Z`
- `NOTION_WRITE_PERFORMED=false`

維護者其後確認 Google Maps 候選與 32Bar X 為同一地點，並明確允許寫入 Candidate。實際執行：

```bash
npm run location:verify -- resolve \
  --page https://app.notion.com/p/3a1c23158ea281fe9f05dc488851e7ce \
  --write
```

Write 結果：

- 使用 legacy Places 重新解析，沒有沿用 dry-run 的暫時結果。
- `reviewRunId = review-ff2db23f-630d-4272-8ce6-3b4afed1a83b`
- `reviewExpiresAt = 2026-08-18T11:33:54.057Z`
- `result = place_id_candidate`
- `Candidate patch matched = true`
- `Formal fields unchanged = true`
- `Recovered after write error = false`
- `NOTION_WRITE_PERFORMED=true`

維護者授權後已寫入並回讀確認：

- `Review Decision = Keep Current`
- `Coordinate Type = Exact`
- `Verification Note = 人工確認 Google Maps 候選與 32Bar X 為同一地點；候選 Place ID 與目前一致，保留目前正式資料。`

接著執行 apply dry-run，結果：

- `reviewRunId` 與 Candidate write 一致。
- 預期唯一正式欄位變更為 `Status: Paused → Published`。
- 正式 Place ID、Google Maps URL、Lat／Lng 與其他正式內容保持不變。
- completed patch 會寫入實際驗證時間、完成 metadata 與 audit note，並清除 Candidate／Review Decision。
- `NOTION_WRITE_PERFORMED=false`

維護者明確授權後已執行 `apply --confirm`：

- `actionRunId = action-2c8416b1-efaa-4ed3-84aa-a3c468dd46c2`
- `reviewRunId = review-ff2db23f-630d-4272-8ce6-3b4afed1a83b`
- `decision = Keep Current`
- 最終 `Status = Published`、`Review Needed = FALSE`
- `Apply Metadata.state = completed`
- Candidate Summary、Maps URL、Payload 與 Review Decision 已清除。
- 正式 Place ID、Google Maps URL、Lat／Lng 與其他正式內容保持不變；唯一正式欄位變更為 Status。
- `Completed patch matched = true`
- `Formal fields matched = true`
- pending／completed recovery 均未觸發。

完成後重跑 `validate --all`：

- baseline、PoC 與正式資料各 98 筆。
- 所有 contract／layer PASS，issues 0。
- PoC 分布更新為 `Published = 5`、`Paused = 91`、`Inactive = 2`。
- completed-action 正式欄位差異由 5 增為 6，新增差異可追溯到本次 action。
- 正式資料仍只有 1 個已核准差異、0 個未核准差異。
- `NOTION_WRITE_PERFORMED=false`、`VALIDATION_RESULT=PASS`

### 7.11 localhost operator UI

維護者確認的範圍：

- 只在 localhost 執行。
- 載入完整佇列。
- 保留 Candidate write、人工決定 write、Apply confirm 三段獨立確認。
- Phase B Button webhook 繼續暫緩。

實作：

- `npm run location:verify:ui` 只綁定 `127.0.0.1:4317`；不接受 `0.0.0.0` 或自訂 host。
- UI 與公開網站分離，沒有加入 Vite production entry。
- 初始 bootstrap 讀取 `Locations (PoC)` 完整 98 筆；當次實測為待檢核 91 筆、已有 Candidate 1 筆。
- 提供待檢核、Candidate 與全部三種篩選；「全部」實際顯示 98 筆。
- Candidate preview／write 沿用 legacy resolver；人工決定 preview／write 新增三欄 allowlist 與 Verification Note append-only 檢查；Apply 沿用既有 page lock 與 `pending → completed`。
- 每段 confirm 必須持有同源 local session token、10 分鐘內的一次性 preview ticket 與該階段 confirmation；preview 後資料改變就 fail-closed。
- API response 與靜態資源使用 `no-store`、CSP、frame／origin 防護；API key 不傳入前端。
- Places Candidate 詳情只在當次畫面記憶體暫時顯示，切換地點或重載即清除；沒有 browser storage 或持久化 log。
- 已完成 action 且目前決定未改變時，UI 顯示完成並停用重複 Apply；若要建立下一個 action，必須先保存新的人工決定。

真實瀏覽器走查：

- 完整佇列為 98 筆，預設待檢核為 91 筆，Candidate 篩選為 1 筆。
- KAEW BOUTIQUE 執行 legacy resolver dry-run 成功；第一段 Candidate 對話框開啟後取消，沒有 Notion write。
- Yua Cafe & Dining 的 Candidate 與既有 `Need Research` action 正確呈現；第二段人工決定與第三段 Apply 對話框均開啟後取消，沒有 Notion write。
- UI 內三層全量驗證的 baseline、approvals、Slug、target、PoC、formal 六層全部 PASS。
- 886px 寬度沒有水平捲軸；前端 console 沒有 warning 或 error。

驗證：

- location verification tests：`74/74` 通過。
- production build：通過；本機 operator UI 沒有被打包進公開網站。
- 專案仍有 2 個既有 `src/map.js` theme typecheck 錯誤，與本次 UI 無關。

### 7.12 localhost operator UI 安全與操作優化

2026-07-19 依 review 建議完成一輪整體優化。本節的結果取代 7.11 的測試數與版面驗證狀態；未改變 Phase B 暫緩決定。

Candidate recovery：

- 新增 `/api/candidate-reset/preview` 與 `/api/candidate-reset/confirm`，confirmation 字串為 `RESET_CANDIDATE`，使用獨立 10 分鐘一次性 ticket。
- 有效、過期或損壞的 Candidate 都可 recovery；必須填寫 500 字元內的原因。
- 單一原子 PATCH 只清除 Candidate Summary、Candidate Maps URL、Candidate Payload、Review Decision，並保持 `Review Needed = TRUE`。
- 保存正式 17 欄、`Coordinate Type`、`Rejected Place IDs`、`Apply Metadata` 與既有 Verification Note；只追加 `candidate-reset` audit entry。
- Recovery 不會把 Candidate Place ID 加入拒絕清單；確定候選錯誤仍應走 `Reject Candidate`。
- preview／confirm 之間重新讀取並核對 formal snapshot 與完整 recovery guard；沿用跨 process page lock、response-loss recovery 與回讀驗證。`Apply Metadata.state = pending` 時 fail-closed。

人工決定與 Apply：

- Verification Note 在 UI 拆成唯讀歷史與本次新證據；server 安全 append。除 `Need Research` 外，本次新證據必填。
- Rich text 超過 2,000 字元時分成多個 Notion rich-text elements，最多 100 個，不再因整段超過 2,000 字元直接拒絕。
- Accept／Reject 只有在 Candidate 為有效、未過期的 `place_id_candidate` 時可用；Accept／Keep Current 要求 Coordinate Type。
- Apply dry-run 與最終 dialog 顯示 Status、Review Needed、Place ID／Maps URL、Rejected Place IDs、驗證時間、Candidate／Review Decision、Verification Note audit 與 `Apply Metadata` 的完整效果。
- Apply 成功且回傳 `Published`、`Review Needed = FALSE` 後，自動切換至 queue
  中下一筆待檢核地點；沒有下一筆時留在原頁並顯示完成提示。其他決策與未完成狀態
  都不自動跳轉，`Reject Candidate` 保留在原頁讓維護者重新 resolver。

同步、效能與介面：

- Candidate／review／apply／reset confirm 直接合併 server 回傳的單頁資料，不再於每次寫入後立刻重查完整 98 筆。
- 新增手動重新整理、最後同步時間與 60 秒 idle refresh；有未送出新證據或 preview ticket 時不自動刷新。
- local server 重啟造成 401 時，前端重新 bootstrap session 一次後重試原 request。
- 全量檢查改稱「全量資料對帳」，畫面分成三項前置檢查（baseline、approvals、target）與三層對帳（Slug、PoC、formal）；失敗時直接顯示完整 issue。
- ambiguous resolver 的每個暫時候選都使用自己的 Place ID 產生 Google Maps URL；距離風險旁明示「距離是提示，不是同一地點判定」。
- 移除 `body min-width: 760px`；中等寬度提早把 evidence 欄折到下方，760px 以下採單欄、可收合佇列、動作按鈕換行。
- 真實瀏覽器在 1280px 首次量到 28px 水平溢出；修正 breakpoint 後為 `innerWidth = 1280`、`scrollWidth = 1280`、overflow 0。760px 以下規則另由 CSS contract 與 DOM 結構確認；目前 browser control surface 無法覆寫 viewport 到精確 665px，因此不把它記為真實 665px 截圖證據。

安全回歸：

- ticket store 會主動清除過期 ticket 並限制最多 1,000 筆；expiry、replay、wrong stage 都有測試。
- 新增 preview／confirm signature drift、foreign Origin、oversized JSON body、401 session recovery contract 與 Candidate recovery route 測試。
- browser storage 掃描仍未發現 localStorage、sessionStorage 或 IndexedDB；operator UI 字串仍未進入 `dist`。
- 真實 UI 再次執行 98 筆全量資料對帳：三項前置檢查及三層對帳全部 PASS，issues 0；當次佇列為待檢核 90、Candidate 1、總數 98。
- Yua Cafe & Dining 實際完成 Candidate recovery preview 並開啟最終 recovery dialog；確認內容正確後取消，沒有 Notion write。

最新驗證結果：

| 檢查 | 結果 |
|---|---|
| `npm run test:location-verification` | 88/88 通過 |
| `npm run build` | 通過 |
| `npm run typecheck` | 通過 |
| `git diff --check` | 通過 |
| operator UI 是否進入 `dist` | 否 |
| 真實 98 筆全量資料對帳 | PASS；issues 0；零 Notion write |

### 7.13 Phase C0 Production Rehearsal 與正式 read-only preflight

2026-07-19 經維護者核准，Phase B 繼續暫緩，先建立 localhost-only Phase C0。這一輪只修改設計／程式、建立獨立 rehearsal clone 並執行正式 read-only dry-run；沒有修改正式 schema 或 page。

正式只讀盤點：

- 正式 `Locations` schema 仍為 17 個 legacy properties 與六種 legacy Status。
- 正式資料目前為 99 筆、99 個非空且唯一 Slug。
- 相對 Phase A immutable 98 筆 baseline，新增 `khlong-bang-luang-floating-market`，沒有移除 Slug。
- 既有 baseline 不改寫；98→99 差異先另存 Phase C0 artifact，其後已建立 99 筆 versioned cutover baseline。

Production Rehearsal：

- 由正式 database 複製出 [`Locations (Production Rehearsal)`](https://app.notion.com/p/3a2c23158ea2817982ded6ed65bbbed8)。
- database ID：`3a2c23158ea2817982ded6ed65bbbed8`。
- data source ID：`173c2315-8ea2-83d8-a33f-876f53663251`。
- Default view ID：`175c2315-8ea2-82ae-80e5-88f5a84e6eee`。
- 正式與 rehearsal 各 99 筆；以 Slug 對應比較 17 個正式欄位，missing 0、extra 0、field mismatch 0。
- 機器可讀結果保存於 [`location-verification-production-rehearsal-20260719.json`](location-verification-production-rehearsal-20260719.json)。

本機程式：

- 新增硬編碼正式／rehearsal data source IDs；既有 resolver／apply write helper 仍只允許 PoC。
- 新增 `production-preflight --page <formal-page> --dry-run`，只讀正式 `NOTION_FORMAL_READ_API_KEY`。
- 命令不接受 `--write` 或 `--confirm`，不呼叫 Places API，也不讀取 `NOTION_FORMAL_WRITE_API_KEY`。
- 預覽內容包含正式 page、17 欄完整性、11 個 workflow 欄位 readiness，以及 legacy Status 的保守初始化 patch。
- `validate --all` 在 query 前同時硬鎖 PoC 與正式 data source ID，避免 baseline 被改指向其他來源。

真實 preflight：

```text
npm run location:verify -- production-preflight \
  --page 3a2c23158ea281e7ae8bf62dd3244d26 \
  --dry-run
```

- Page：Khlong Bang Luang Floating Market。
- 正式欄位：17/17。
- 目標 workflow 欄位：0/11。
- 保守預覽：`Status = Draft`、`Review Needed = TRUE`。
- 結果：`PREFLIGHT_RESULT=BLOCKED`、exit code 2、`PRODUCTION_WRITE_ENABLED=false`、`NOTION_WRITE_PERFORMED=false`。

全量 fail-closed 驗證：

```text
npm run location:verify -- validate --all
```

- Baseline 98、PoC 98、正式 99。
- 唯一 issue：`FORMAL_SLUG_UNEXPECTED / khlong-bang-luang-floating-market`。
- baseline contract、formal approval contract、target invariants、PoC action reconciliation 與既有正式欄位核准差異仍通過。
- 結果為預期 `VALIDATION_RESULT=FAIL`；驗證器沒有自動修正或寫入。

本輪 location verification 自動化測試已由 83 增為 88，新增 production preflight CLI、read-only token、正式 allowlist、PoC page 拒絕、無 write mode，以及 baseline 正式來源被改指向時 query 前拒絕等覆蓋。

Rehearsal schema 與初始化：

- 新增 11 個 workflow properties，總 properties 由 17 增為 28；沒有建立 Button。
- Status options 採遷移期並存：原六個 legacy options 全保留，新增 `Published`、`Paused`、`Inactive`，`Draft` 共用。
- 沒有批次改 Status；99 筆只寫 `Review Needed`。
- 初始化寫入 99/99 成功；回讀為 TRUE 98、FALSE 1，逐筆與 legacy mapping 比較錯配 0。
- 建立 `Migration Audit` view，ID `3a2c2315-8ea2-818d-904e-000c715552aa`，只顯示 `Name / Slug / Status / Review Needed`。

32Bar X canary／rollback：

- canary run ID：`phase-c0-rehearsal-canary-20260719-32bar-x`。
- rehearsal page ID：`15ec23158ea28379a8c4012c425525ec`。
- 套用：`Status = Paused`、`Review Needed = TRUE`，加入明確 rehearsal-only note；回讀完全吻合。
- rollback：還原 `Status = Verified`、保持 `Review Needed = TRUE`、清除 canary note；回讀完全吻合。
- rollback 後重新比較正式與 rehearsal：99 筆、17 個正式欄位 mismatch 0；Review Needed mapping mismatch 0。
- Schema 不做 DROP rollback。新增欄位與 options 是 additive 且不影響 legacy app；事故時還原資料值並部署 legacy-compatible app，等 legacy Status 歸零及 rollback window 結束後才移除舊 options。

### 7.14 遷移期 app 相容與 99 筆 cutover baseline

網站相容更新：

- Parser 的 `LocationStatus` 支援九個遷移期值：六個 legacy values，加上 `Published`、`Paused`、`Inactive`；`Draft` 共用。
- 未知或空白值在 parser 仍 fail-closed 為 `Draft`，但 snapshot validator 會先檢查 raw CSV，拼字錯誤或空白不得通過部署。
- 遷移期 UI allowlist 為 `Verified`／`Needs Review`／`Published`；`Draft`、`Verifying`、`Could Not Find`、`Closed`、`Paused`、`Inactive` 與未知值均不在 UI 呈現。
- 地圖 marker 與列表使用同一個 `isPublicLocation`；target `Published` 呈現及其他 target／未知值不呈現已有 regression tests。

Snapshot gate：

- 新增 [`location-snapshot-policy-v1.json`](../data/location-snapshot-policy-v1.json)，以 `minimumRowCount = 98` 允許正常新增。
- 98 個 legacy Slug 仍由 `legacy-favorite-ids.json` 保護；少一個舊 Slug 即使補一個新 Slug仍失敗。
- 刪除／封存必須有包含 Slug、核准時間、核准者與原因的 deletion manifest。
- 所有 raw status 必須屬於遷移期 union；所有非空 Lat/Lng 必須合法且成對。
- `Published` 必須同時具有合法 Lat/Lng 與 Google Maps URL。
- 現行 98 筆快照驗證結果：98 個唯一 Slug、97 筆符合遷移期 UI 呈現資格。

Cutover baseline：

- 新增唯讀產生器 `scripts/capture-formal-cutover-baseline.mjs`，只讀 `NOTION_FORMAL_READ_API_KEY` 且硬鎖正式 data source。
- 產生器要求明確的 expected count 與新增 Slug allowlist，拒絕移除舊 Slug、未核准欄位 drift、重複 Slug、未知 Status 或來源重新導向。
- Artifact：[`location-verification-formal-cutover-baseline-20260719.json`](location-verification-formal-cutover-baseline-20260719.json)。
- Baseline ID：`formal-cutover-20260719-99`；row count 99。
- Content SHA-256：`sha256:f6d3a8ec7fef47f61b25d68229eefd3554bd9cc6f75f4b61776ef80a5afe2e3f`。
- Transition：新增 `khlong-bang-luang-floating-market`；移除 0；既有 Dear December 核准 1；未核准欄位差異 0。
- 建檔後再以 `--verify` 唯讀重抓正式 99 筆，content hash 完全一致；兩次命令均明確回報 `No Notion write was performed`。
- 全專案 212/212 tests、typecheck、production build 與 `git diff --check` 通過。

### 7.15 正式 schema mutation

2026-07-19 維護者開通正式 write access 並同意繼續。依先前約定，本次授權只涵蓋正式 schema mutation，不涵蓋第一筆正式 page write。

執行前：

- Notion connector 重新讀取正式 schema：17 個 properties、六個 legacy Status options、0 個 workflow properties。
- Production Rehearsal 重新讀取為 28 欄，確認正式 migration 的欄位型別與 select option 顏色完全沿用已通過 canary 的複本。
- `npm run location:formal-schema -- --dry-run` 結果為 17→28 欄、缺少 11 個 workflow fields、缺少 `Published`／`Paused`／`Inactive`。
- Dry-run 同時核對正式 99 筆與 cutover content hash；結果仍為 `sha256:f6d3a8ec7fef47f61b25d68229eefd3554bd9cc6f75f4b61776ef80a5afe2e3f`。

正式執行：

```text
npm run location:formal-schema -- --confirm
```

- 對 allowlisted 正式 data source 執行單一 schema PATCH。
- 新增 11 個 workflow properties，總欄位數由 17 增為 28。
- Status 全量保留六個既有 option ID，只追加 `Published`、`Paused`、`Inactive`。
- 命令沒有 page update 路徑；`NOTION_PAGE_WRITE_PERFORMED=false`。
- API 回讀為 28/28 欄、缺少 workflow field 0、缺少 target Status 0。
- 變更後再次查詢 99 筆；17 個正式欄位 content hash 與變更前完全一致。
- Notion connector 獨立回讀也確認欄位型別、Coordinate Type、Review Decision 與九個 Status options 正確。
- 再跑 schema dry-run 為 `SCHEMA_ALREADY_APPLIED=true`、patch properties 0，證明命令可安全重跑。
- Rollback 仍採非破壞方式：若 app 發生問題就回切 legacy-compatible 行為，不刪除新增欄位或仍在使用的 Status options。

正式單頁 read-only preflight：

- Khlong Bang Luang Floating Market 正式欄位 17/17、workflow 欄位 11/11。
- Proposed patch 仍為 `Status = Draft`、`Review Needed = TRUE`。
- `PREFLIGHT_RESULT=READY`，但 `Formal write credential consumed = false`、`NOTION_WRITE_PERFORMED=false`。
- 機器可讀紀錄：[`location-verification-formal-schema-migration-20260719.json`](location-verification-formal-schema-migration-20260719.json)。
- 本階段完成後：location verification 97/97、全專案 217/217 tests、typecheck 與 production build 通過。

### 7.16 第一筆正式 page write canary

維護者於 schema migration 完成後再次指示「繼續」，依既有分層授權約定，該指示只授權第一筆正式 page write，不包含批次初始化或後續檢核三段寫入。

Canary 固定範圍：

- Page：Khlong Bang Luang Floating Market。
- Page ID：`3a2c23158ea281e7ae8bf62dd3244d26`。
- Slug：`khlong-bang-luang-floating-market`。
- Data source：正式 allowlist `e55c2315-8ea2-837d-9637-07c1118486c8`。
- Before：`Status = Draft`、`Review Needed = FALSE`；其餘 workflow 欄位均空白。
- 唯一 proposed patch：`Review Needed = TRUE`。
- Rollback patch：`Review Needed = FALSE`。

安全實作：

- 新增 `location:formal-canary`，固定第一筆 canary page 與正式 data source。
- `--dry-run` 不讀取 write credential；`--confirm` 才允許一個 checkbox PATCH。
- Converter 拒絕 Status、其他 workflow 欄位、`Review Needed = FALSE` 或多欄 patch。
- Confirm 使用既有跨 process page lock，PATCH 前重新讀取並比對全部 17 個正式欄位與 11 個 workflow 欄位。
- 支援 response-loss recovery；只有回讀已精確套用單欄 patch時才視為成功。
- PATCH 後再次讀取 page 與 99 筆 cutover baseline；任何正式欄位差異都 fail-closed。

實跑結果：

- Dry-run：唯一 patch 為 `{"Review Needed":"__YES__"}`，零寫入。
- Confirm：`NOTION_PAGE_WRITE_PERFORMED=true`、`READBACK_VERIFIED=true`。
- After：`Status = Draft`、`Review Needed = TRUE`；其餘 workflow 欄位仍空白。
- Cutover content hash 前後均為 `sha256:f6d3a8ec7fef47f61b25d68229eefd3554bd9cc6f75f4b61776ef80a5afe2e3f`。
- Notion connector 獨立回讀確認 `Review Needed = TRUE`。
- 重跑 confirm：`MODE=confirm-noop`、proposed patch `{}`、`NOTION_PAGE_WRITE_PERFORMED=false`。
- 沒有使用 response-loss recovery，也不需要 rollback。
- 機器可讀紀錄：[`location-verification-formal-page-canary-20260719.json`](location-verification-formal-page-canary-20260719.json)。
- 本階段完成後：location verification 102/102、全專案 222/222 tests、typecheck 與 production build 通過。

### 7.17 正式 Review Needed 初始化唯讀預覽

第一筆 canary 通過後，只新增 read-only queue preview；沒有把前一階段授權延伸為批次寫入。

實作與防呆：

- 新增 `location:formal-queue-preview`，CLI 必須同時提供 `--dry-run` 與本機 `--output`。
- 命令只讀 `NOTION_FORMAL_READ_API_KEY`，不接受 `--confirm`，也不讀取正式 write credential。
- 正式 data source、99 筆數量、唯一 Slug、cutover content hash、Status mapping 與 11 個 workflow 欄位狀態全部 fail-closed。
- Legacy `Draft`／`Needs Review`／`Verifying`／`Verified` 預期 `Review Needed = TRUE`；`Could Not Find`／`Closed` 預期 FALSE；target 或未知 Status 直接拒絕。
- 除 `Review Needed` 外，任何已占用 workflow 欄位都會讓預覽停止，不會覆蓋現有檢核資料。

2026-07-19 正式 dry-run 結果：

- 99 筆，Status 分布：Verified 81、Needs Review 16、Draft 1、Could Not Find 1。
- 目前 Review Needed：TRUE 1、FALSE 98；預期：TRUE 98、FALSE 1。
- 完整資料集為 97 個 `FALSE → TRUE` patch、2 個 no-op、0 個 TRUE → FALSE patch。
- 兩個 no-op 是 Khlong（已由 canary 設為 TRUE）與 Yoru Omakase（Could Not Find，維持 FALSE）。
- 對「canary 後尚未處理的 98 頁」而言，是 97 個 TRUE patch、1 個 FALSE no-op。
- Cutover content hash 仍為 `sha256:f6d3a8ec7fef47f61b25d68229eefd3554bd9cc6f75f4b61776ef80a5afe2e3f`。
- `bulkFormalInitializationApproved=false`、`bulkConfirmRouteImplemented=false`、`notionWritePerformed=false`。
- 機器可讀預覽：[`location-verification-formal-review-queue-preview-20260719.json`](location-verification-formal-review-queue-preview-20260719.json)。
- 本階段完成後：location verification 105/105、全專案 225/225 tests、typecheck 與 production build 通過。

### 7.18 正式 Review Needed 受限 confirm route

維護者於唯讀預覽完成後指示「continue」。依前一階段說明，本次授權只涵蓋實作受限 confirm route 與重新 dry-run，不包含執行 97 筆正式 page PATCH。

執行契約：

- 新增 `location:formal-queue`；dry-run 只需 `--dry-run --output <new-json>`，不讀取 write credential。
- Confirm 必須同時提供固定 approval ID、live target plan SHA-256、`--max-writes 97` 與新的本機結果檔；缺一即在任何寫入前停止。
- Target plan hash 綁定正式 data source、cutover content hash、99 筆 page ID／Slug／Status、每頁 17 個正式欄位 snapshot hash 與預期 Review Needed；它不依賴目前 checkbox 是否已完成，因此部分成功後可安全重跑同一目標。
- Preview JSON 只供人與稽核閱讀，不作為 executable input；confirm 必須重新查詢正式 Notion 並重建同一 plan。
- 只允許 `Review Needed = TRUE` 的單欄 checkbox PATCH；FALSE、Status、Candidate 或其他 workflow／正式欄位一律被 converter 拒絕。
- 每頁依序取得跨 process lock，寫前重讀並核對 formal snapshot 與空白 workflow，寫後再次回讀；response loss 只有在回讀已精確套用時才視為恢復。
- 任一頁晚到 workflow drift 或正式欄位改變會停止後續寫入，並回報寫入嘗試數與已驗證數；已完成的 TRUE patch 可由同一 target plan 冪等重跑。
- 全部完成後重新查詢 99 筆、核對 cutover hash、target plan hash、剩餘 patch 0 與 no-op 99。

2026-07-19 live dry-run：

- Artifact：[`location-verification-formal-review-queue-execution-preview-20260719.json`](location-verification-formal-review-queue-execution-preview-20260719.json)。
- Target plan SHA-256：`sha256:ed588b6f5cbaa5a021d9cf5c7c7b3e9f19bf88ccda5862394df8ff1a409c0910`。
- Approval ID：`phase-c-formal-review-queue-initialization-20260719-v1`。
- 99 筆、97 個 TRUE patch、2 個 no-op、0 個 FALSE patch；Khlong 與 Yoru Omakase 仍是兩個 no-op。
- `WRITE_ATTEMPT_COUNT=0`、`WRITE_COUNT=0`、`NOTION_PAGE_WRITE_PERFORMED=false`。
- `bulkFormalInitializationApproved=false`、`bulkConfirmRouteImplemented=true`。
- CLI 在接觸 Notion 前先以 exclusive-create 保留 audit 路徑；confirm 執行中逐頁更新 checkpoint。中途失敗時不會把未知狀態誤報為零寫入，而會要求重新查詢 live Notion。
- 本階段完成後：16/16 焦點測試、location verification 113/113、全專案 233/233 tests、typecheck 與 production build 通過。

### 7.19 正式 Review Needed 批次初始化

維護者明確核准：「允許依上述 plan hash 寫入 97 筆 Review Needed」。實際 confirm 精確使用已預覽的 target plan：

- Target plan SHA-256：`sha256:ed588b6f5cbaa5a021d9cf5c7c7b3e9f19bf88ccda5862394df8ff1a409c0910`。
- Approval ID：`phase-c-formal-review-queue-initialization-20260719-v1`。
- Write ceiling：97。
- Result artifact：[`location-verification-formal-review-queue-confirm-result-20260719.json`](location-verification-formal-review-queue-confirm-result-20260719.json)。

執行結果：

- 97 個寫入嘗試、97 個已回讀確認的 `Review Needed = TRUE` PATCH。
- 已套用跳過 0、response-loss recovery 0、失敗 0。
- 每頁都先取得 lock、重新讀取並核對 formal snapshot／workflow，再執行單欄 PATCH 與寫後回讀。
- 完整 99 筆最終對帳：剩餘 patch 0、no-op 99。
- Cutover content hash 仍為 `sha256:f6d3a8ec7fef47f61b25d68229eefd3554bd9cc6f75f4b61776ef80a5afe2e3f`；target plan hash 也未變。
- 同一 plan 再跑 confirm 得到 `confirm-noop`、寫入嘗試 0、寫入 0；artifact：[`location-verification-formal-review-queue-confirm-noop-20260719.json`](location-verification-formal-review-queue-confirm-noop-20260719.json)。
- 獨立 Notion connector 查詢 99 筆：Review Needed TRUE 98、FALSE 1、mapping mismatch 0、其他 workflow 欄位占用 0、沒有下一頁。
- 本批次沒有修改 Status、日期、備註、Candidate、Place ID、Maps URL、座標或其他正式欄位。

### 7.20 localhost 正式單頁檢核 gate

批次 queue 完成後，將既有 PoC operator UI 延伸為正式單頁模式。本階段只實作、測試與執行 dry-run，沒有取得或執行 Candidate、人工決定、recovery 或 Apply 的正式寫入授權。

安全契約：

- `--target formal` 必須搭配唯一 `--page`；queue 只載入該頁，API 收到其他 page ID 時在 resolver／review／apply 前回傳 `403`。
- 預設 `writePolicy.mode = read-only`，所有正式 confirm route 均拒絕；前端 banner、按鈕文字與 disabled state 同步顯示。
- `--allow-formal-write` 只接受 `candidate`、`candidate-reset`、`review`、`apply` 其中一個值；不能用 `all`，也不能在 PoC 模式使用。
- 正式 read 使用 `NOTION_FORMAL_READ_API_KEY`；正式 PATCH 只能使用獨立 `NOTION_FORMAL_WRITE_API_KEY`。Runner 還要求 `allowFormalWrite = true` 並再次核對正式 data source。
- Preview ticket 綁定 target、stage、page 與 preview signature；正式 server 在 consume ticket 前先檢查本次 stage authorization。
- Resolver 也已納入跨 process page lock，與 review、recovery、apply 一致。
- Legacy Status 相容只對已驗證為正式 data source 的 `Verified`／`Needs Review`／`Verifying` 開放；PoC 不因此重新接受 legacy Status。

KAEW BOUTIQUE live dry-run：

- 啟動：`location:verify:ui -- --target formal --page 475c23158ea282dfbf3d019ead10ba0d`，沒有 `--allow-formal-write`。
- Resolver：`place_id_candidate`、`existing_place_id`、Place ID `ChIJBYSFdCSf4jARdKOd5TaytZY`；候選與目前 Place ID 相同。
- Google 候選地址：One Bangkok Entrance 3；相對正式座標距離約 2,367 m，風險標示 `high`。距離不自動決定同一地點或拒絕候選。
- UI 實際確認 Candidate／Review／Apply confirm 都 disabled；沒有進入任何確認對話框。
- 獨立 connector 回讀：Candidate 三欄、Review Decision、Verification Note、Apply Metadata 仍空白；`Review Needed = TRUE`、`Status = Verified` 未變。
- 結論：`NOTION_PAGE_WRITE_PERFORMED=false`；KAEW 尚待維護者核對地圖與位置語意，不能視為已驗證。
- 當時完整回歸：location verification 117/117、全專案 237/237、typecheck 與 production build 全部通過。

### 7.21 KAEW 身份確認與高距離座標 gate

維護者已確認 KAEW BOUTIQUE 指的是 One Bangkok／The Storeys B1。現有 Place ID
與 legacy resolver 候選一致，但正式座標 `13.745, 100.535` 與候選相距約
2,367 公尺，因此不能用 `Keep Current` 發布；`Accept Candidate` 也只會保留同一
Place ID，不能修正 Lat/Lng。

已完成：

- Candidate Payload 新增可選的 `coordinateReviewRequired` 布林 workflow
  metadata；不保存 Places Lat/Lng、距離、地址或名稱。
- 單一候選距離超過 500 公尺時，resolver 令旗標為 TRUE，Candidate Summary 加上
  `[Coordinate Correction Required]`。
- Apply core 對有旗標的 `Accept Candidate`／`Keep Current` fail-closed。
- UI 顯示明確阻擋，要求先以可追溯來源修正正式 Lat/Lng；若 Candidate 已保存，
  必須先 recovery，再重跑 resolver。
- 非 `Deactivate` 的人工決定必須先有有效且未過期的 Candidate，避免 UI 送出
  必然失敗的 review request。
- KAEW 在正式單頁 read-only UI 再次執行 legacy resolver，畫面實際顯示
  `Coordinate Correction Required`；Candidate／Review／Apply confirm 仍全部關閉。
- OpenStreetMap `way 608350816` 可作 One Bangkok 商業區的可追溯代表點來源，
  約為 `13.72709, 100.54728`；它不是 The Storeys B1 室內店面精確點，因此若採用
  應標為 `Representative` 並保留來源與 attribution。
- 本輪沒有 Notion write；正式座標、Source URLs、Coordinate Type、
  Verification Note 與 approval manifest 都尚未修改。
- 新 gate 完整回歸：location verification 119/119、全專案 239/239、
  typecheck 與 production build 全部通過。

下一個控制點不是 Candidate write，而是先核准 KAEW 的精確座標修正 patch；
修正後必須重新建立 basis revision，再重跑 Candidate 三段流程。

### 7.22 KAEW 正式座標修正與回讀

2026-07-20 維護者明確授權依 7.21 的精確 patch 寫入正式 Notion，並更新
formal approval manifest。執行範圍只包含四個正式欄位：

- `Lat`: `13.745` → `13.72709`
- `Lng`: `100.535` → `100.54728`
- `Coordinates Approx`: `TRUE` → `FALSE`
- `Source URLs`: 保留原始 Google Maps 線索，追加 One Bangkok 官方位置頁與
  OpenStreetMap way 608350816

固定 correction plan hash：
`sha256:f00933b6e29e482fda56f154a2921250d04d4a92a2573458ba371388d7a749df`。

執行與驗證結果：

- 寫入前由 Notion connector 重新讀取並確認 page、正式 data source 與四個舊值。
- 寫入期間持有同頁跨 process lock；只送出四個授權 property。
- Notion 寫後回讀精確命中新值；`Status = Verified`、`Review Needed = TRUE`，
  Candidate／Review／Apply 欄位仍空白。
- Approval manifest 新增 KAEW 的 Lat、Lng、Coordinates Approx、Source URLs
  四段 exact-value approval chain；既有 Dear December approval 保留。
- Live `validate --all`：approval contract、target、PoC reconciliation 與 formal
  drift 均 PASS；正式差異 5 筆、核准 5 筆、未核准 0。
- Slug layer 仍因既有第 99 筆 `khlong-bang-luang-floating-market` 相對 Phase A
  98-Slug immutable baseline 回報 FAIL；不是 KAEW patch 造成，未自動修正。
- 修正後再次執行 legacy resolver dry-run：同一 Place ID、距離 127m、
  `distanceRisk = medium`、`coordinateReviewRequired = false`、
  Summary `[Candidate Ready]`，且沒有 Candidate write。
- 機器可讀紀錄：
  [`location-verification-formal-coordinate-correction-kaew-20260720.json`](location-verification-formal-coordinate-correction-kaew-20260720.json)。

座標 patch 完成時的下一個獨立控制點是 KAEW Candidate stage；
`Coordinate Type = Representative` 與 Verification Note 仍留在後續 Review
stage，沒有在座標 patch 偷渡寫入。

### 7.22 KAEW 正式 Candidate stage

維護者已明確授權「允許 KAEW Candidate stage」。本控制點只開放 Candidate
寫入，沒有授權或執行 Review／Apply。

執行與驗證結果：

- 寫入前由 Notion connector 重新讀取 KAEW，確認 Candidate Summary、
  Candidate Maps URL、Candidate Payload、Review Decision、Verification Note
  與 Apply Metadata 都是空白。
- localhost server 只以
  `--target formal --page 475c23158ea282dfbf3d019ead10ba0d
  --allow-formal-write candidate` 啟動；queue 只包含 KAEW，write policy 只開放
  Candidate。
- resolver preview 使用 legacy Places API，結果為 `place_id_candidate`；
  候選 Place ID 與目前正式 Place ID
  `ChIJBYSFdCSf4jARdKOd5TaytZY` 相同，`coordinateReviewRequired = false`，
  Candidate Summary 為 `[Candidate Ready]`。
- confirm 時 server 重新執行 resolver、核對 preview signature 並持有同頁跨
  process lock；結果 `writePerformed = true`，新的 review run 為
  `review-5c0fc15b-126d-4dc5-bdb8-2cd144366b3c`。
- 獨立 Notion connector 回讀確認三個 Candidate 欄位已寫入且 Payload 有效；
  `Review Needed = TRUE`。`Lat = 13.72709`、`Lng = 100.54728`、
  `Coordinates Approx = FALSE`、正式 Place ID、Google Maps URL、Status 與來源
  均未改動，Review／Apply 欄位仍空白。
- Candidate confirm 完成後已立即關閉 Candidate-enabled server；獨立 connector
  回讀時已不再保留正式寫入模式。
- live `validate --all` 的 approval contract、target invariants、PoC
  reconciliation 與 formal baseline drift 均 PASS；未核准正式欄位差異為 0。
  整體仍只因既有第 99 筆
  `khlong-bang-luang-floating-market` 相對 immutable 98-Slug baseline 回報
  `FORMAL_SLUG_UNEXPECTED`，沒有任何 validator 寫入。

下一個獨立控制點是 KAEW Review stage。開始前必須由維護者確認 Review
Decision、`Coordinate Type = Representative` 與本次新證據文字；Apply 仍需在
Review 寫後回讀通過後另外授權。

### 7.23 KAEW 正式 Review stage

維護者已明確授權依下列內容執行 KAEW Review stage：

- Review Decision：`Keep Current`
- Coordinate Type：`Representative`
- 新證據：`人工確認 KAEW BOUTIQUE 為 One Bangkok／The Storeys B1
  同一地點；legacy Places 候選 Place ID 與目前一致；正式座標已依官方位置資訊與
  OSM 代表點修正。`

執行與驗證結果：

- 寫入前由 Notion connector 與正式單頁 bootstrap 重新讀取；Candidate 有效且
  未過期，`coordinateReviewRequired = false`，Review／Apply 欄位仍空白。
- localhost server 只以
  `--target formal --page 475c23158ea282dfbf3d019ead10ba0d
  --allow-formal-write review` 啟動；Candidate 與 Apply confirm 均未開放。
- Review preview 精確命中上述三項內容，並綁定 Candidate 的
  `review-5c0fc15b-126d-4dc5-bdb8-2cd144366b3c` review run。
- confirm 時 server 重新讀取正式頁、核對 formal snapshot／workflow revision
  與 preview signature，並在同頁跨 process lock 內只寫入 Review Decision、
  Coordinate Type 與 append-only Verification Note；結果
  `writePerformed = true`。
- 獨立 Notion connector 回讀確認三欄精確命中；Candidate 仍存在，
  `Review Needed = TRUE`、Apply Metadata 空白。Status、Place ID、Maps URL、
  Lat／Lng、Coordinates Approx 與來源都未改動。
- Review confirm 完成後已立即關閉 Review-enabled server。
- live `validate --all` 的 approval contract、target invariants、PoC
  reconciliation 與 formal baseline drift 均 PASS；未核准正式欄位差異為 0。
  整體仍只因既有第 99 筆 Slug 相對 immutable 98-Slug baseline 回報
  `FORMAL_SLUG_UNEXPECTED`，沒有 validator 寫入。

另以正式唯讀模式完成 Apply preview，尚未執行。下一個 Apply stage 預期效果：

- `Status`: `Verified` → `Published`
- `Review Needed`: `TRUE` → `FALSE`
- 寫入 Last Verified 與 Place ID Checked At
- 清除三個 Candidate 欄位與 Review Decision
- 保留既有 Verification Note，並追加本次 apply 稽核紀錄
- Apply Metadata 經 pending 完成為 completed

下一個獨立控制點是 KAEW Apply stage；必須取得維護者對上述完整效果的明確授權
後，才能重新啟動只開放 Apply 的正式單頁 server。

### 7.24 KAEW 正式 Apply stage

維護者已明確授權依 7.23 的完整 Apply preview 執行 KAEW Apply stage。

寫入前安全事件：

- 第一個 confirm request 使用錯誤 confirmation literal，server 在 ticket consume
  與 Notion write 前以 `Missing apply confirmation` 拒絕。
- 使用正確 confirmation 後，fail-closed preview signature gate 又在 Notion
  pending write 前拒絕：Apply preview 與 confirm 原本各自產生新的 actionRunId
  與時間，因此 exact patch signature 必然不同。
- 修正後，短效一次性 Apply ticket 會攜帶已預覽的 actionRunId 與時間；
  confirm 將同一 action identity 傳給 runner，仍會重新讀取頁面、重建
  pending／completed patch 並核對完整 signature。補上 runner 與 UI ticket
  regression tests；targeted 67/67、全專案 240/240、typecheck 與 production
  build 全部通過。
- 上述兩次拒絕都發生在 Notion write 前；KAEW 的 Apply Metadata 仍為空，沒有
  pending action 需要 recovery。

最終執行：

- fresh preview 的唯一正式欄位變更仍是 `Status: Verified → Published`；
  approval manifest 新增
  `formal-change-20260720-kaew-boutique-status-published-01`。
- confirm 沿用 preview action
  `action-4cdd3b91-5e97-4016-969d-fb5fd87cc6eb`，先寫 pending，再在同一最終
  patch 完成正式與 workflow 結果；`writePerformed = true`。
- 最終 `Status = Published`、`Review Needed = FALSE`；Last Verified 與 Place ID
  Checked At 已寫入。
- Candidate Summary、Candidate Maps URL、Candidate Payload 與 Review Decision
  已清除；`Coordinate Type = Representative` 保留。
- Verification Note 保留人工證據並追加相同 actionRunId／reviewRunId 的 apply
  audit；Apply Metadata 為 `completed`。
- Google Place ID、Maps URL、Lat／Lng、Coordinates Approx 與來源維持原值。
- Apply-enabled server 在成功後立即關閉；獨立 Notion connector 回讀精確命中
  上述狀態。
- live `validate --all`：formal approvals 6、observed formal changes 6、
  approved exact-value changes 6、unapproved differences 0；approval contract、
  target invariants、PoC reconciliation 與 formal drift 均 PASS。整體仍只因既有
  第 99 筆 Slug 回報 `FORMAL_SLUG_UNEXPECTED`。
- 機器可讀紀錄：
  [`location-verification-formal-apply-kaew-20260720.json`](location-verification-formal-apply-kaew-20260720.json)。

KAEW 已完成 Candidate、Review、Apply 三段正式控制流程；下一筆地點必須重新從
獨立 Candidate authorization 開始，不能沿用本次任何 ticket 或 write mode。

### 7.25 第 99 筆正式 Slug 契約修正

`khlong-bang-luang-floating-market` 並非錯誤或重複資料；它已在 Phase C0 經
read-only 盤點、rehearsal 比對與 versioned cutover capture 確認為合法正式新增。
問題是 `validate --all` 建立 cutover artifact 後仍只以 Phase A 的 98-Slug
membership 同時檢查 PoC 與正式庫，因此持續回報
`FORMAL_SLUG_UNEXPECTED`。

本次修正：

- 保留 Phase A immutable 98 筆 baseline，不覆寫舊檔、不把 PoC 筆數改成 99。
- `validate --all` 另載入
  [`location-verification-formal-cutover-baseline-20260719.json`](location-verification-formal-cutover-baseline-20260719.json)；
  重新計算 content SHA-256，並核對 formal data source、17 欄、
  previous baseline SHA-256、rowCount、added／removed Slugs 與唯一性。
- Slug layer 改為雙 membership：PoC 必須精確符合 immutable 98 Slugs；正式必須
  精確符合 cutover 99 Slugs。
- 既有 98 筆正式資料仍依 immutable baseline 加 formal approval chain 對帳；
  cutover 新增的 Khlong 頁則依 artifact 保存的 17 欄精確對帳。
- 沒有放寬未知新增：未列入 cutover 的第 100 筆仍為
  `FORMAL_SLUG_UNEXPECTED`；任何移除、cutover transition 或 hash 竄改都
  fail-closed。
- 新增 cutover 成功、transition mismatch 與 content hash mismatch 自動化測試；
  UI 與 CLI 的 layer 名稱改為 `PoC/formal Slug integrity`。Targeted tests
  80/80、全專案 242/242、typecheck 與 production build 全部通過。

正式 live read-only 結果：

- Immutable PoC baseline 98、formal cutover baseline 99。
- Locations (PoC) 98、formal Locations 99。
- baseline、approvals、Slug、target、PoC、formal 六層全部 PASS。
- formal observed changes 6、approved changes 6、unapproved differences 0。
- Issues 0、`VALIDATION_RESULT=PASS`、`NOTION_WRITE_PERFORMED=false`。

### 7.26 Khlong 正式 Candidate stage

維護者確認 legacy Google Maps 候選與 Khlong Bang Luang Floating Market 為同一
地點，並明確授權 Khlong Candidate stage。

執行結果：

- 寫入前由 Notion connector 確認 Candidate、Review、Apply 欄位全空；
  `Status = Draft`、`Review Needed = TRUE`、`Coordinates Approx = TRUE`。
- legacy resolver 以既有 Place ID
  `ChIJ3Wo3vEmY4jARGLbFN8BC7Yc` refresh；候選 Place ID 與目前一致，距離
  54m／low、duplicate 0、`coordinateReviewRequired = false`。
- 正式單頁 server 只開放 Candidate；confirm 時重新執行 resolver 並核對
  signature，結果 `writePerformed = true`，review run 為
  `review-2103687e-afa7-49c7-9b1b-32baff4e15e2`。
- 獨立 Notion connector 回讀確認 Candidate Summary、Maps URL 與 place-id-only
  Payload 有效；Status、Place ID、Lat／Lng、Coordinates Approx、來源、
  Review 與 Apply 均未改動。
- Candidate-enabled server 已關閉。live `validate --all` 的六層全部 PASS、
  issues 0、Notion write 0。

下一個獨立控制點是 Khlong Review stage。建議 `Review Decision = Keep Current`、
`Coordinate Type = Representative`；Verification Note 應記錄人工確認同一地點、
Place ID 一致，以及目前座標代表市場／運河社區範圍。Apply 仍需另行授權。

### 7.27 Khlong 正式 Review stage

維護者明確授權依 7.26 建議內容執行 Khlong Review stage。

執行結果：

- 寫入前由 Notion connector 與正式單頁 bootstrap 重新讀取；Candidate 有效且
  未過期，Review／Apply 欄位仍空白。
- 正式單頁 server 只開放 Review；preview／confirm 綁定
  `review-2103687e-afa7-49c7-9b1b-32baff4e15e2`，並寫入：
  - `Review Decision = Keep Current`
  - `Coordinate Type = Representative`
  - append-only Verification Note：人工確認同一地點、Place ID 一致，且目前座標
    代表市場／運河社區範圍。
- confirm 結果 `writePerformed = true`。獨立 Notion connector 回讀精確命中；
  Candidate 仍存在、`Review Needed = TRUE`、Apply Metadata 空白。
- Status、Place ID、Maps URL、Lat／Lng、Coordinates Approx 與來源均未改動；
  Review-enabled server 已關閉。
- live `validate --all` 六層全部 PASS、issues 0、Notion write 0。

正式唯讀 Apply preview 已完成，尚未執行。預期效果：

- `Status`: `Draft` → `Published`
- `Review Needed`: `TRUE` → `FALSE`
- 寫入 Last Verified 與 Place ID Checked At
- 清除 Candidate 三欄與 Review Decision
- 保留人工 Verification Note 並追加 apply audit
- Apply Metadata 經 pending 完成為 completed

Khlong 不在 Phase A 98 筆 baseline，而是 cutover 新增頁；因此 Apply 前還必須把
`Status: Draft → Published` 的 exact-value approval 明確綁定 99 筆 cutover
artifact。這項 approval contract 更新尚未執行，也不得繞過。

下一個獨立控制點是 Khlong Apply stage；必須取得維護者對上述完整效果的明確授權
後才可啟動。

### 7.28 Khlong cutover approval contract 與正式 Apply stage

維護者明確授權更新 Khlong cutover approval contract，並依 7.27 的完整 Apply
preview 執行 Khlong Apply stage。

執行前先建立獨立的
[`location-verification-formal-cutover-change-approvals.json`](location-verification-formal-cutover-change-approvals.json)：

- approval 綁定 `formal-cutover-20260719-99` 與 content hash
  `sha256:f6d3a8ec7fef47f61b25d68229eefd3554bd9cc6f75f4b61776ef80a5afe2e3f`。
- 唯一核准值為 `khlong-bang-luang-floating-market / Status:
  Draft → Published`，且 `syncPoc = false`。
- validator 只允許這份 contract 核准 cutover `addedSlugs`；不能用它核准 Phase A
  原 98 筆。錯誤 baseline ID、hash、未知 Slug 或非新增 Slug皆 fail-closed。
- immutable 與 cutover approval contract 必須各自通過才會合併；targeted tests
  82/82、全專案 244/244、typecheck 與 production build 全部通過。

正式 Apply 執行結果：

- 寫入前由 Notion connector、單頁 bootstrap 與一次性 Apply preview 再讀取；
  preview 唯一正式資料變更仍為 `Status: Draft → Published`。
- 正式 server 只開放 Khlong 的 Apply stage；confirm
  `writePerformed = true`、`alreadyCompleted = false`，action run 為
  `action-37574550-07a7-4f2f-9ef7-bccff6cb23b6`。
- 最終為 `Published`、`Review Needed = FALSE`；Last Verified 與 Place ID
  Checked At 已寫入，Candidate 三欄與 Review Decision 已清除。
- `Coordinate Type = Representative` 與人工 Verification Note 保留，並追加
  action／review run audit；Apply Metadata 為 `completed`。
- Google Place ID、Maps URL、Lat／Lng、Coordinates Approx、名稱、說明與來源均
  維持原值。
- Apply-enabled server 在成功後立即關閉；獨立 Notion connector 回讀精確命中
  上述狀態。
- live `validate --all`：immutable approvals 6、cutover approvals 1、observed
  formal changes 7、approved exact-value changes 7、unapproved differences 0；
  六層全部 PASS、Issues 0、validation 本身沒有 Notion write。
- 機器可讀紀錄：
  [`location-verification-formal-apply-khlong-20260720.json`](location-verification-formal-apply-khlong-20260720.json)。

Khlong 已完成 Candidate、Review、Apply 三段正式控制流程；下一筆地點必須重新從
獨立 Candidate authorization 開始，不能沿用本次 ticket、run ID 或 write mode。

### 7.29 正式佇列單次啟動與三段自助流程

依維護者要求，localhost UI 已由「正式單頁、單階段重啟」擴充為可選的正式自助
佇列模式。啟動一次後，可從正式 Locations 選擇地點，依序完成 Candidate、
Review、Apply：

```bash
npm run location:verify:formal-ui
```

實作邊界：

- `--formal-workflow` 與 `--approved-by maintainer` 是獨立、明確的啟動模式；
  不能和舊的 `--page` 或 `--allow-formal-write` 混用。舊的正式單頁／單階段模式
  仍保留供 canary 與診斷使用。
- queue 使用正式 read-only credential 查詢 allowlisted formal data source；
  mutation 才使用獨立 write credential。任意外部 page ID 仍會在 data source
  驗證時被拒絕。
- 同一 session 可使用 Candidate、Candidate recovery、Review、Apply，但沒有
  一鍵連續寫入：每段仍需自己的 preview、10 分鐘一次性 ticket、明確 mutation
  action、fresh read、signature check 與跨 process page lock。Candidate／Review
  使用確認對話框；Apply 使用主動發布按鈕。
- UI 依 Candidate／Review／Apply 狀態鎖住尚不可執行的後段。Apply 回傳
  `Published` 且 `Review Needed = FALSE` 後，UI 自動選取 queue 中下一筆
  待檢核地點；只切換頁面，不自動執行下一頁的 Candidate、Review 或 Apply。

Apply approval contract 已整合進第三段：

- Apply preview 會顯示本次精確正式欄位變更、目標 manifest，以及要新增或沿用的
  exact-value approvals。
- Phase A 原 98 個 Slug 寫入 immutable approval manifest；cutover
  `addedSlugs` 寫入獨立 cutover manifest。未知 Slug、錯誤 baseline
  ID／hash、broken chain 或目前 Notion 值不在核准鏈上時 fail-closed。
- approval plan 納入 Apply ticket signature；preview 後 manifest 或 Notion
  任一變化都要求重新 preview。
- 最終確認在 page lock 內、Notion pending write 前，以獨立 global approval
  lock 重新讀取並驗證 contract，再用同目錄暫存檔＋atomic rename 寫入。
- response loss／重試若發現相同 approval ID 與完整內容已存在，會沿用而不重複
  append。若 approval 已記錄但 Notion write 未完成，可重跑同一筆；全量 validator
  會在完成前保持 fail-closed。

驗證結果：

- 新增 formal approval plan、immutable／cutover routing、unapproved drift、
  atomic append／retry、workflow arguments、三段同 session、approval signature
  drift 與 pre-pending hook 測試。
- targeted tests 88/88；全專案 250/250；typecheck 與 production build 通過。
- 2026-07-20 實際啟動正式 workflow UI，只做 read-only 走查：載入正式 99 筆，
  當下 `Review Needed = TRUE` 為 96 筆、Candidate 0 筆。
- 真實瀏覽器選取 32Bar X 後，Candidate preview 可用；Candidate confirm、
  Review 與 Apply 在前置條件不足時均保持 disabled。沒有執行 resolver preview
  或任何 confirm，因此正式 Notion write 0、approval manifest write 0。
- UI 內全量資料對帳六項全部 PASS，瀏覽器 console error 0。

---

### 7.30 Published 後自動前往下一筆

依維護者操作回饋，第三段 Apply 成功後的 queue 導覽已調整：

- 僅在 server 回傳 `Status = Published` 且 `Review Needed = FALSE` 時自動前進。
- 下一筆依目前完整 queue 順序尋找 `Review Needed = TRUE` 的地點；走到尾端時
  從開頭繼續找，且不會重新選取剛完成的頁面。
- 若已無待檢核地點，留在完成頁並顯示「目前沒有下一筆待檢核地點」。
- `Reject Candidate`、`Need Research`、`Inactive`、API 錯誤或任何未完成狀態
  都不自動跳轉。
- 自動前進只改變 UI 選取頁，不會自動執行 resolver、產生 preview、填入人工
  決定或執行下一頁的任何寫入；三段順序與 ticket 邊界維持不變。

實作與驗證：

- 新增純函式模組 `tools/location-verification-ui/workflow.js`，集中判斷 Apply
  完成條件與下一筆 queue 選取。
- 新增 queue 順序、循環與無下一筆案例測試，並補上 `/workflow.js` 靜態資源測試；
  相關測試 `17/17` 通過。
- 更新後正式 localhost UI 已重新啟動並唯讀載入 99 筆、待檢核 93、
  Candidate 0；瀏覽器 console error 為 0，沒有執行任何正式 mutation。
- `npm run build` 通過。全專案 typecheck 與完整測試目前另受
  `src/map.js`／`src/render.js` 的同時進行中變更影響；本次 UI 相關測試均通過，
  未修改那些外部變更。

---

### 7.31 Review 寫入後自動執行 Apply dry-run

依維護者操作回饋，第二段人工決定寫入成功後，UI 會直接替同一頁執行第三段的
Apply preview：

- Review confirm 仍只寫入 Review Decision、Coordinate Type 與 append-only
  Verification Note。
- server 回傳頁面必須仍是目前選取頁，且必須具有 Review Decision，才會自動
  呼叫 `/api/apply/preview`；使用固定 page ID，避免切換頁面時把 ticket 套到錯頁。
- dry-run 通過後顯示完整 Apply effects 與 formal approval plan，並啟用
  「Apply 並發布」。
- dry-run 本身不寫入 Notion、不寫入 approval manifest，也不自動觸發 Apply
  confirm；第三段發布仍需維護者主動點擊發布按鈕。
- 若 dry-run 失敗，已成功寫入的 Review 決定不回滾，Apply ticket 清除，UI
  會明示「人工決定已寫入，但 Apply dry-run 失敗」與實際原因。

驗證：

- 新增 Review 成功後自動 preview 的 selected-page fail-closed 測試，並補上
  completed page 已不在 queue 時的下一筆選取邊界案例。
- UI workflow／server 相關測試 `19/19` 通過；JavaScript syntax check 通過。
- Production build 通過；正式 localhost UI 唯讀載入 99 筆、待檢核 91 筆，
  browser console error 0，本輪未執行任何正式 mutation。

---

### 7.32 移除 Apply confirmation modal

依維護者要求，第三段 Apply 已移除額外 confirmation modal：

- Apply dry-run 通過後顯示紅色「Apply 並發布」按鈕；維護者點擊後直接呼叫
  `/api/apply/confirm`，不再開啟第二個對話框。
- 這不是自動發布。按鈕只有在同頁 Apply preview 成功且持有有效 ticket 時才啟用，
  維護者仍須主動點擊。
- server 端 `confirm: APPLY` literal、同源 session token、一次性 ticket、fresh
  read、signature／formal approval contract 驗證、global approval lock、
  page lock、pending／completed write 與寫後回讀全部保留。
- Candidate 與 Review 的 confirmation modal 不變；草稿重新整理等其他安全
  對話框也不受影響。
- UI 文案由「最終確認 Apply」統一改為「Apply 並發布」，流程 aria label 改為
  「三段檢核流程」，避免暗示三個階段都有相同 modal。

驗證：

- 新增 UI contract test，鎖定 Apply handler 直接呼叫 confirm API、不得呼叫
  `confirmDialog`，並核對按鈕文案。
- UI workflow／server 相關測試 `20/20` 通過；JavaScript syntax check 與
  production build 通過。
- 正式 localhost UI 唯讀載入 99 筆、待檢核 87、Candidate 1；實際選取一筆確認
  新文案與 disabled gate，browser console error 0，正式 mutation 0。

---

### 7.33 獨立 Lat／Lng 修正工具

依維護者提出的實際案例，當 Google Maps／Candidate URL 與現有 Place ID
一致、但正式座標有誤時，localhost UI 已加入不改 Place ID 的獨立座標修正流程：

- 表單輸入新 Lat、新 Lng、可追溯來源 URL，並要求勾選來源可保存且不是 Places
  API 資料。
- 只有 `Review Needed = TRUE`、Candidate／Review 欄位為空、Apply 不在
  pending 時開放；已有 Candidate 必須先走 recovery，避免在 resolver workflow
  中途改變比較基準。
- Preview 精確顯示 Lat／Lng 舊值與新值、距離及來源。來源已在
  `Source URLs` 時只 patch Lat／Lng；否則才明示一併追加來源。
- Confirm 使用獨立 `SAVE_COORDINATES` literal、10 分鐘一次性 ticket、fresh
  read、signature drift gate、跨 process page lock、response-loss recovery 與
  寫後回讀。它保留自己的 confirmation modal；不受 Apply modal 移除影響。
- 正式 workflow preview／confirm 會建立或沿用 exact-value approval contract，
  並在 Notion PATCH 前以 global approval lock 原子寫入；正式單頁
  `--allow-formal-write` 不開放這個階段。
- 寫入範圍硬鎖 `Lat`、`Lng` 與必要時的 `Source URLs`；不修改 Place ID、
  Maps URL、Status、Review Needed、Coordinates Approx、Candidate、Review 或
  發布狀態。完成後要求重新執行 legacy resolver，不自動進入後續階段。

驗證：

- Runner、approval、UI server 與 browser app contract 共 87 項 targeted tests
  全部通過；包含只改 Lat／Lng、追加來源、既有來源比對、workflow
  gate、ticket／confirmation 與正式核准來源說明。
- JavaScript syntax check 通過；本次實作與測試沒有執行任何正式 Notion
  mutation，也沒有寫入 approval manifest。
- 更新後正式 localhost UI 已重新啟動：載入 99 筆、待檢核 86、Candidate 0。
  真實瀏覽器選取 Cafe Ban Nok by Ple Venus，確認座標面板與三個輸入 gate；
  完整且合法的暫時表單會啟用 preview，但 confirm 在沒有 ticket 時仍保持
  disabled。測試輸入已清除並重新載入，browser logs 為 0；沒有執行任何
  preview、confirm、正式 Notion mutation 或 approval manifest write。

---

### 7.34 UI 收斂為完全唯讀的 Candidate 檢核工具

維護者決定正式資料的修改與完成檢核全部回到 Notion 手動執行，localhost UI
只負責回答「目前正式資料是否與 Google Maps Candidate 一致」。

已完成：

- 正式 queue 在 server 端只保留 `Review Needed = TRUE`；前端不能切換到已完成
  或其他正式頁面。
- 前端只保留 Candidate legacy resolver dry-run、目前正式資料、來源與備註、
  Candidate 有無篩選、搜尋、下一筆、同步時間與全量資料對帳。
- Candidate dry-run 顯示候選名稱、地址、Place ID、Lat／Lng、距離、營業狀態、
  Maps URL、與目前 Place ID 是否一致，以及相同 Place ID 的重複頁提示。
- 已有或過期 Candidate 不會阻止重新 dry-run；既有 Candidate 只作唯讀提示。
- Candidate confirm／reset、Review、Apply、座標修正及 confirmation modal 已從
  UI 移除。
- UI server 已移除所有上述 mutation route、write helper import、preview ticket、
  exact-value approval commit 與 `NOTION_FORMAL_WRITE_API_KEY` 依賴。
- `--formal-workflow`、`--allow-formal-write`、`--approved-by` 不再是合法 UI
  server 參數；正式啟動指令只剩 `--target formal`。
- 手動重新整理、回到 UI 分頁或 60 秒 idle refresh 會重讀 queue；目前頁面因
  取消 Review Needed 而消失時，自動選取原位置的下一筆。
- `Last Verified` 的更新責任移至 Notion database automation：
  `Review Needed checked → unchecked` 時設為觸發時間。UI 不執行這筆寫入；
  正式操作前仍需在 Notion 確認 automation 已啟用。

驗證：

- UI server／workflow 15 項新 contract test 已通過。
- 測試鎖定所有舊 mutation 與 mutation-preview route 均為 404、bootstrap
  `writePolicy.mode = read-only`、resolver response 不含 ticket，以及 server
  source 不含正式 write secret 或 mutation helper。
- 全專案 257/257 測試、typecheck 與 production build 通過；build 只有既有
  `src/map.js` 同時被 static／dynamic import 的 chunk warning。
- 正式 localhost UI 已重啟於 `127.0.0.1:4318`；live queue 當下為 83 筆
  Review Needed、1 筆已有 Candidate、82 筆尚無 Candidate。
- 真實瀏覽器選取 `Cafe Ban Nok by Ple Venus`，確認畫面只有 Candidate
  dry-run、正式資料／來源、Notion link 與下一筆；Review、Apply、座標修正及
  confirmation modal 都不在 UI。
- 實際執行一次 legacy Candidate dry-run，結果為 `no_candidate`／
  `text_search`，畫面正常顯示查詢與人工處理指引；browser logs 為 0。
- 本次 live 驗證沒有 Candidate persistence、正式 Notion mutation、approval
  manifest write 或其他外部寫入。

### 7.35 Candidate 預覽跨同步保留

維護者回報從 Candidate Google Maps／Notion 分頁返回檢核工具時，Candidate
資訊會自行消失。根因是 `visibilitychange` 會重新讀取 queue，而
`refreshQueue()` 過去不論選取頁是否改變都無條件清除記憶體中的預覽。

已完成：

- 同一地點重新同步時保留 Candidate dry-run 結果。
- 預覽與重新讀取的正式頁會比對 page ID、Name、Slug、Google Place ID、Lat
  與 Lng；任一項改變就清除舊預覽，避免使用過期證據。
- 切換地點、目前地點離開 `Review Needed` queue 或重載整頁時仍會清除。
- Notion page ID 在 server response 統一為 compact 32-hex 格式；前端比較同時
  容許 Notion API 的 hyphenated ID。
- UI 說明文字已同步上述生命週期；仍不使用 browser storage，也不寫入 Notion。

驗證：

- UI server／workflow 相關測試 16/16 通過；完整 location verification suite
  130/130、全專案 261/261 通過，`git diff --check` 通過。
- 正式 localhost UI 重啟於 `127.0.0.1:4318`，live queue 當下為 80 筆。
- 真實執行一筆 legacy Candidate dry-run 後按「重新整理 Notion」，Candidate
  名稱、地址、Place ID、座標與距離風險仍保留；按「下一筆」後才清除。
- browser console 的 error／warning 為 0；本輪沒有 Notion write。

### 7.36 正式 schema 20→17 的程式同步

維護者已直接在正式 Notion 移除 `Branch Group`、`Coordinates Approx` 與
`Rejected Place IDs`。Notion connector 回讀同一 data source，確認現行為 17
個 properties。

已完成：

- 新增 current formal schema contract：14 個正式內容欄位＋3 個維護欄位，並
  鎖定每欄 Notion API property type。
- production preflight 改為 14/14＋3/3；對 `Draft`、`Published`、`Paused`、
  `Inactive` 現行狀態不再建立 legacy migration patch。
- 正式 UI queue 在 server 端逐頁驗證 17 欄與型別；移除
  `coordinatesApproximate` response 欄位。
- formal baseline drift 忽略已刪除的 `Branch Group` 與
  `Coordinates Approx`，但其他欄位與 Slug drift 仍 fail-closed；退役欄位總數
  更新為 11。
- 正式 snapshot API exporter 與手動 CSV bridge 不再要求 Notion 的
  `Coordinates Approx`。
- PoC 與歷史三段 runner 繼續保留舊 schema，避免破壞既有稽核證據與測試。

驗證：

- 全專案 265/265、typecheck、production build 與 `git diff --check` 通過；build
  只有既有 `src/map.js` static／dynamic import warning。
- `chin-bo-dang-central-world` live production preflight：17/17、
  `PREFLIGHT_RESULT=READY`、`NOTION_WRITE_PERFORMED=false`。
- localhost UI 重啟於 `127.0.0.1:4318`，正式 queue 正常讀取；當下
  `Review Needed = 0`，browser console error／warning 為 0。
- live `validate --all` 不再產生三個 schema 退役欄位的 drift，但仍有 256 個
  issue：正式庫 100 筆、`by` 缺少、`plantiful-sukhumvit-61` 新增，以及 254 個
  其他未核准正式欄位差異。本輪沒有自動核准、baseline mutation 或 Notion page
  write。

### 7.37 地圖 snapshot 適配正式 17 欄 data source

- 公開 snapshot contract 已由 15 欄收斂為 14 欄，移除已退役的
  `Coordinates Approx`；正式 3 個檢核欄位仍不匯出。
- `src/csv-parser.js` 對新的 Notion snapshot 將座標語意視為空白／未指定；
  舊 Google Sheet rollback CSV 若仍帶 `Coordinates Approx`，仍可相容解析。
- `scripts/export-snapshot.mjs` 現在：
  - 只讀 `NOTION_FORMAL_READ_API_KEY`。
  - data source 固定受正式 allowlist
    `e55c2315-8ea2-837d-9637-07c1118486c8` 保護。
  - 查詢前先驗證 17 個必要 property 與型別。
  - 依 Slug 排序，並可用 `--output` 原子寫入候選檔。
  - 不包含任何 Notion write route。
- committed `data/locations.csv` 已機械式移除舊欄，並以最新正式 Notion
  100 筆資料重新產生。
- 正式唯讀 dry-run 實際讀到 100 筆、schema 17/17：
  - `Published` 99、`Inactive` 1。
  - 新增 `kate-teaw-boat-noodles-siam-square-soi-3`、
    `khlong-bang-luang-floating-market`、`plantiful-sukhumvit-61`。
  - 相對 committed snapshot 移除 `by`。
- 維護者要求的兩項 Slug 調整已完成：
  - `Kate Teaw Boat Noodles Siam Square Soi 3` 補上
    `kate-teaw-boat-noodles-siam-square-soi-3`；同頁原 Google Maps URL
    缺少 scheme，保留原路徑並正規化為完整 `https://www.google.com/maps/...`
    URL，Notion connector 回讀兩欄皆正確。
  - `PLANTIFUL on Sukhumvit 61` 回讀時已是
    `plantiful-sukhumvit-61`，因此沒有重複寫入 Notion。
- 維護者明確表示不需保留 `by` 的既有 favorites；protected-ID manifest
  以精確核准替代記錄 `by → plantiful-sukhumvit-61`，總數仍為 98。
- 正式候選已通過 snapshot validator：100 筆、100 個唯一 Slug、99 筆符合
  UI 呈現資格；favorite compatibility 亦通過：98 個受保護 ID、2 個新增
  Slug。通過後才取代 committed `data/locations.csv`。
- 全專案 248/248、typecheck、production build 與 `git diff --check` 通過；
  localhost `/api/locations`／地圖 UI 實際顯示 99/99 個公開地點，Kate、
  Khlong 與 Plantiful 均已載入。

---

## 8. 下一步待辦

### P0：Phase C0 rehearsal gate

- [x] 只讀盤點正式最新 schema、筆數與 Slug。
- [x] 建立獨立 `Locations (Production Rehearsal)`。
- [x] 比較正式／rehearsal 的 99 筆、17 欄並確認差異 0。
- [x] 新增正式單頁 `production-preflight`，且沒有 write mode。
- [x] 實跑一筆正式 page，確認 schema 未就緒時 fail-closed。
- [x] 重跑 `validate --all`，確認 98→99 新增 Slug 被捕捉且零寫入。
- [x] 在 rehearsal 新增 11 個 workflow 欄位；Status 採 legacy＋target options 並存，純四狀態延後到 legacy 值歸零。
- [x] 在 rehearsal 演練 99 筆保守 `Review Needed` 初始化與一頁 canary，完成回讀對帳與非破壞 rollback。
- [x] 更新網站 parser／UI eligibility／snapshot validator，使遷移期 legacy／target 雙模型 fail-closed 相容。
- [x] 根據正式最新資料建立新的 versioned cutover baseline；沒有覆寫 Phase A baseline。
- [x] 取得正式 schema mutation 的獨立核准。
- [x] 執行 schema mutation並完成 API／connector 回讀、idempotent dry-run 與 99 筆正式欄位對帳。
- [x] 取得並執行第一筆正式 page write；單欄 patch、回讀、hash 與 no-op 重跑均通過。
- [x] 以 read-only credential 產生正式 99 筆初始化預覽；確認 97 個 TRUE patch、2 個 no-op、零正式寫入。
- [x] 實作受限批次 confirm route，綁定 approval ID、target plan hash、97-write ceiling、逐頁 lock／重讀／回讀與 response-loss recovery。
- [x] 使用新 route 重跑正式 live dry-run；plan hash 已固定，寫入嘗試 0。
- [x] 取得剩餘 98 頁保守 `Review Needed` 初始化的批次核准。
- [x] 依核准 plan 寫入 97 筆 TRUE；逐頁回讀與完整 99 筆最終對帳通過。
- [x] 執行同 plan confirm-noop 與獨立 connector 回讀；零第二次寫入、mapping mismatch 0。

### P0：建立實際 local runner

- [x] 建立 `resolve --page <page-id> --dry-run`。
- [x] 建立 `resolve --page <page-id> --write`。
- [x] 建立 `apply --page <page-id> --dry-run`。
- [x] 建立 `apply --page <page-id> --confirm`。
- [x] runner 啟動時核對 allowlisted PoC data source ID。
- [x] 預設 dry-run；resolver 的預期 patch 在寫入前完整顯示。
- [x] resolver 由 runner 重新讀取 Notion page、產生 basis／workflow revision，並在 write 前後對帳。
- [x] apply dry-run 的 page 重讀、人工欄位、Candidate 期限與 revision 驗證由 runner 執行。
- [x] apply confirm 的 `pending → completed` 寫入、恢復與結果對帳全部由 runner 執行。
- [x] runner 不接受 CLI 直接傳入正式 Lat/Lng、Place ID 或 Status。
- [x] Places 候選內容只在當次互動記憶體／terminal 顯示，提供 Google Maps 歸屬標示，且沒有檔案 log。
- [x] resolve write 只寫五個 Candidate workflow 欄位，並拒絕覆蓋既有 Candidate。
- [x] resolve dry-run 與 write 固定使用 legacy API；CLI 預設 legacy，並拒絕 `--places-api auto`。

### P0：補齊 Phase A 決策與失敗案例

- [x] `Reject Candidate`：追加 `Rejected Place IDs`，正式資料不變。
- [x] `Need Research`：保留 queue，不誤設為完成。
- [x] `Could Not Find`：轉為 `Inactive` 並要求備註。
- [x] `Deactivate`：轉為 `Inactive`，但不拒絕正確 Place ID。
- [x] `ambiguous`：不得 Accept。
- [x] 過期候選：拒絕套用。
- [x] basis revision 改變：拒絕舊候選。
- [x] workflow revision 改變：拒絕舊決定。
- [x] `Inactive` 使用舊 apply request：不得重新變成 `Published`。
- [x] 已列入 `Rejected Place IDs` 的候選：不得再次 Accept／Reject。
- [x] 非 allowlist data source：任何 write 前 fail-closed。
- [x] 重複 Place ID：resolver 與 apply 當下均預設阻擋。

以上為自動化測試完成狀態；不代表維護者已對真實地點做出這些決定。

### P0：四種決策的真實 PoC canary

- [x] `Reject Candidate`：Bang Di Kai Hat Yai 已追加錯誤候選 Place ID、保留正式資料與 queue。
- [x] `Need Research`：Yua Cafe & Dining 已保留 Candidate、明確決策、缺少證據說明與 queue。
- [x] `Could Not Find`：`by` 已由維護者決定並轉為 `Inactive`；ambiguous payload 已清除。
- [x] `Deactivate`：Yoru Omakase 已轉為 `Inactive`；既有正確 Place ID 未加入 `Rejected Place IDs`。

另完成 Tribe Sky Beach Club 與 SkyRise Adventures 兩筆真實 `Keep Current`，使真實 `Keep Current` canary 累計四筆。四種剩餘決策的真實 PoC canary 已全部完成。

### P0：冪等與恢復

- [x] Resolver Candidate PATCH 成功但 response 遺失時，重新讀取同一 reviewRunId 並回報成功。
- [x] 同一 reviewRunId 重複 apply，只能完成一次。
- [x] `pending` 後中斷，以相同 actionRunId 恢復。
- [x] 最終 Notion update 成功但 response 遺失，重新讀取後回報成功，不重複套用。
- [x] 同頁 action 以跨 process page lock 序列化；另一個 Node CLI 在 Notion read/write 前即被阻擋。
- [x] 已完成 action 重送時回傳既有成功結果。
- [x] stale lock 可用 `lock inspect` 判讀；只有明確 `lock clear --confirm` 且確認為 same-host dead-PID owner 才可清除，其他狀態皆 fail-closed。

### P1：Validators 與全量對帳

- [x] 實作 `validate --all` 與 target Status UI eligibility validator。
- [x] 驗證 Candidate Payload discriminated union 與 place-id-only 禁止欄位。
- [x] 驗證 `Published`、`Paused`、`Draft`、`Inactive` invariants。
- [x] 驗證 Candidate lifecycle、Review Needed、Place ID refresh 與共址例外。
- [x] 驗證器以 immutable 98-Slug PoC baseline 與 hashed 99-Slug formal cutover
  baseline 執行雙 membership gate；未核准新增、移除或 artifact drift 均
  fail-closed，不自動修正。
- [x] cutover 新增 Slug 使用獨立、綁定 cutover ID／hash 的 exact-value
  approval contract；不能替原 98 筆核准變更，兩份 contract 必須各自通過。
- [x] 以自動化測試確認 PoC／正式雙 token 隔離、只使用讀取 query，沒有 `PATCH`。
- [x] 設定正式 `Locations` 專用 `NOTION_FORMAL_READ_API_KEY`。
- [x] 實際跑完 immutable baseline 98、PoC 98、formal cutover baseline 99 與
  formal 99 的全量對帳；四組 Slug membership 均符合各自契約。
- [x] 實際確認 PoC 的 5 個 post-migration 正式欄位差異都能對應到已完成 action。
- [x] 實際確認正式 `Locations` 的 17 欄相對 immutable baseline 加上核准鏈沒有未核准差異。
  - `dear-december-cafe / Notes EN` 為 1 個已核准精確值；PoC 依決定保留原值。

### P1：localhost operator UI

現行唯讀 contract：

- [x] server 端只列出 `Review Needed = TRUE`。
- [x] 只保留 legacy Candidate dry-run；不寫入或清除 Candidate。
- [x] UI 與 server 移除 Candidate／Review／Apply／座標修正的全部寫入入口。
- [x] 保留目前正式資料、來源、搜尋／篩選、下一筆、同步與三層全量資料對帳。
- [x] 頁面離開 Review Needed queue 時自動前往下一筆。
- [ ] 在正式 Notion 確認 automation 已啟用：
  `Review Needed checked → unchecked` 時更新 `Last Verified`。
- [ ] 逐筆實際檢核仍由維護者判斷，並在 Notion 手動修改與取消 Review Needed。

下列為已退役三段 UI 的歷史完成紀錄：

- [x] 只綁定 `127.0.0.1`，不部署且不進入公開 Vite build。
- [x] 載入完整 98 筆 queue，提供待檢核／Candidate／全部篩選。
- [x] Candidate、人工決定與 Apply 三段各自 preview／confirm。
- [x] 所有 mutation 需要 session token、短效一次性 preview ticket 與階段 confirmation。
- [x] 人工決定 write 只允許三個欄位，Verification Note 採 append-only。
- [x] Places 詳情僅暫時顯示；沒有 browser storage、檔案 log 或 snapshot persistence。
- [x] UI 內可執行 read-only 三層全量驗證。
- [x] 自動化 handler／安全測試與真實瀏覽器走查完成。
- [x] Candidate 可經獨立 preview／confirm 安全 recovery；有效、過期與損壞 Payload 都支援，pending apply 會阻擋。
- [x] Verification Note 歷史與本次新證據分離，server append-only 合併並支援 rich-text chunking。
- [x] 表單提供 decision-aware inline validation，Apply 顯示完整 workflow／正式欄位效果。
- [x] 人工決定寫入後自動執行同頁 Apply dry-run；只建立 preview ticket 並顯示
  effects，最終 Apply 仍需第三段主動點擊發布按鈕。
- [x] Apply 發布按鈕移除額外 confirmation modal；仍需有效 preview ticket 與
  維護者主動點擊，server 的 `APPLY` confirmation 與所有 fail-closed 控制保留。
- [x] 正式座標修正提供獨立 preview／confirm；只允許 Lat／Lng 與必要的來源
  追加，綁定 exact-value approval、ticket、page lock 與寫後回讀，不修改
  Place ID、Maps URL、Status 或發布狀態。
- [x] confirm 後以單頁 merge 更新 queue；提供手動／idle refresh、session recovery 與最後同步時間。
- [x] Apply 回傳 Published 且不再需要審核後，自動選取下一筆待檢核地點；其他
  決策與未完成狀態留在原頁，且不自動執行下一頁任何階段。
- [x] 全量檢查重新命名並分組為三項前置檢查與三層資料對帳，失敗 issue 在 UI 完整顯示。
- [x] ticket expiry／replay／wrong-stage、signature drift、foreign Origin 與 oversized body 回歸測試完成。
- [x] 中等寬度水平溢出已修正；760px 以下的單欄與可收合 queue 已實作。
- [x] 正式單頁相容模式限制為啟動時指定的唯一 page；預設 read-only，且每次最多
  開放 Candidate／Recovery／Review／Apply 一個階段。
- [x] 正式自助 workflow 以獨立明確旗標一次載入完整佇列；三段各自保留
  preview／confirm、target-scoped ticket、runner formal authorization、page
  lock 與順序 gate，不能一鍵批次套用。
- [x] 正式 workflow 的 Apply preview／confirm 自動建立或沿用綁定正確 baseline
  的 exact-value approval，使用 global lock、atomic rename 與 retry recovery。
- [x] KAEW BOUTIQUE 正式唯讀 UI 與 legacy resolver dry-run 已實跑；候選顯示、high-distance 提示與 confirm disabled 均通過，connector 回讀確認零 workflow write。
- [x] `>500m` 單一候選會保存 workflow-only
  `coordinateReviewRequired`，並在 core／UI 阻擋 `Accept Candidate` 與
  `Keep Current`；KAEW live dry-run 已觸發。
- [x] KAEW 的正式 Lat／Lng、Coordinates Approx 與 Source URLs 精確 patch 已獲
  核准並寫入；四筆 formal change approvals、同頁 lock 與寫後回讀均完成。
- [x] 座標修正後已重跑 resolver dry-run；距離降為 127m／medium，
  `coordinateReviewRequired = false`，沒有 Candidate write。
- [x] 已取得 KAEW Candidate stage 的獨立授權並保存新的 place-id-only
  Candidate；正式欄位未改動，connector 回讀與 target validator 通過。
- [x] 已取得 KAEW Review stage 的獨立授權並保存 `Keep Current`、
  `Coordinate Type = Representative` 與 append-only 新證據；connector 回讀與
  target validator 通過。
- [x] 已取得並執行 KAEW Apply stage；發布、驗證時間、Candidate／Review
  清除、completed metadata、exact-value approval 與 connector 回讀均完成。
- [x] Khlong 已完成正式 Candidate／Review／Apply；`Draft → Published` 綁定
  cutover approval contract，獨立回讀與 99 筆全量驗證均通過。
- [x] 正式完整佇列可只啟動一次並逐筆完成三段流程；實際載入 99 筆與 read-only
  瀏覽器走查完成，正式寫入 0。
- [x] 三段正式 UI 已退役；現行 UI 不自動套用候選，也不提供任何寫入動作。

---

## 9. Phase A 完成條件

只有下列條件全部成立，才能把 Phase A 標為完成：

- [x] 實際 local runner 可重現 resolve／apply 流程，不再依賴人工 connector 編排。
- [x] 所有本機 Phase A 必測案例通過；Button／webhook／外部 store 案例明確留在 Phase B。
- [x] 98 個 PoC Slug 全部保留且唯一。
- [x] PoC 相對保守 migration 的每個正式欄位差異都有可追溯的 actionRunId／reviewRunId 與人工決定。
- [x] Phase A resolver／apply 的所有 write 路徑都只能通過 `Locations (PoC)` allowlist；正式驗證 integration read-only，正式 drift 沒有未核准差異。
- [x] 重試、response loss、跨 process lock 與 stale lock recovery 結果可重現。
- [x] Places content 不進入 Notion、持久化 log、Git 或 snapshot；Place ID 與 workflow metadata 除外。
- [x] 維護者確認 local runner 的操作流程可接受；2026-07-19 已簽核。

技術完成條件已全部通過，維護者也已確認：

- [x] resolve 預設 dry-run，只有明確 `--write` 才寫 Candidate。
- [x] apply 先預覽，只有明確 `--confirm` 才執行 `pending → completed`。
- [x] 遇到 page lock 時先 `lock inspect`；只有工具判定為 same-host dead-PID stale lock 才使用 `lock clear --confirm`。

Phase A 完成時維持下列邊界；其中 production schema、queue 初始化與正式單頁唯讀 route 後來已由 Phase C 個別完成，未核准的正式 Candidate／Review／Apply mutation 仍受同一原則限制：

- Phase B 開始前，不建立 Notion `Apply Decision` Button。
- Phase B 開始前，不啟用 Button webhook。
- 正式 canary 未取得 Phase C 對應控制點核准前，不以
  `--allow-formal-write` 啟用 production write stage；日常 workflow 則以每頁
  每段的 UI preview／confirm 作為具體授權。
- 不以 workflow 執行批次初始化或自動狀態遷移；Phase C0 本身只授權 read-only
  preflight 與獨立 rehearsal。

---

## 10. Phase B 入口條件

Phase A 入口條件已滿足；維護者已決定暫緩 Phase B，先用本機流程逐筆驗證 Location。日後另行恢復 Phase B 時才評估：

- Database Button webhook 是否能穩定提供 page／trigger identity。
- Secret header 與快速 2xx 回覆。
- 支援 atomic claim 的外部 durable queue／store。
- 本機入口與 webhook 入口的 patch parity。
- 重送、亂序、並行 claim 與 Notion automation pause 行為。

Phase B 仍只可存取 `Locations (PoC)`；正式資料庫 rollout 需要另行核准。

---

## 11. Phase C0 完成與 Phase C 入口條件

Phase C0 的 read-only 盤點、rehearsal clone、28 欄 additive schema、99 筆保守初始化、17 欄完整性比對、正式單頁 preflight、32Bar X canary／rollback、網站遷移期相容，以及 99 筆 cutover baseline 均已完成。其後正式 schema mutation與第一筆正式 page canary 也已各自獲獨立核准並完成，但不等於批次 page rollout 核准。

開始批次正式 page mutation 前仍需完成：

- 對剩餘 98 頁產生完整 preview：依 Status 列出預期 TRUE／FALSE、實際 PATCH 與 no-op 數量。
- 取得批次 `Review Needed` 初始化的明確核准；第一筆 canary 授權不可沿用。

Phase B webhook 可以繼續暫緩；若 Phase C 先以 localhost 單一維護者操作，必須
保留三段順序、各階段 preview ticket、明確 mutation action 與跨 process page
lock，且不得把它宣稱為 webhook 的分散式並行保護。
