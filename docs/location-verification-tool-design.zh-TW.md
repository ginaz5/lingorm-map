# 地點檢核工具設計紀錄

> - 專案：Lingorm Bangkok Map
> - 建立日期：2026-07-19
> - 最後審查：2026-07-20
> - 狀態：正式檢核 UI 為完全唯讀；正式 schema 現為 17 欄，程式契約、preflight、snapshot bridge 與 UI 已同步
> - 目的：記錄地點正確性責任、Notion 檢核流程、工具邊界及後續決策，避免設計散落在對話中。
> - 執行進度：[地點檢核工具進度紀錄](location-verification-tool-progress.zh-TW.md)
> - ⚠️ **Artifact 說明**：本文件中所有 `docs/location-verification-*.json`（baseline、change approvals、schema migration、canary、review queue 等機器可讀紀錄）皆為 2026-07-19～07-20 cutover 期間**本機產生的一次性稽核檔案**，事後已從本機刪除，repo 中從未提交、也找不到。以下敘事保留當時的實際檔名與 hash 作為文字紀錄，但這些檔案**不存在於 repo，也不是後續操作所需**——`location-verification-runner.mjs` 的 `validate --all` 路徑若在找不到檔案時仍嘗試讀取，會直接丟出 `Unable to read ...` 錯誤而非靜默略過；日常使用不依賴這些檔案。

---

## 1. 背景與責任原則

這個網站的使用者以查閱地點為主，新增地點則大多由維護者完成。因此：

- 社群表單、粉絲貼文與其他外部內容只提供**地點線索**。
- 維護者負責判斷地點、分店、地址與座標是否正確。
- 自動化工具可以找候選、整理證據與標示風險，但不能自動把地點設為可在 UI 呈現的 `Published`。
- 未通過任何人工確認的新資料，以及已知可能造成錯誤導航的資料，不應在 UI 呈現。

過去的座標稽核已說明這項原則的重要性：

- 曾檢查 34 筆資料，其中 14 筆座標錯誤。
- 最嚴重的一筆偏差約 18.8 公里。
- 只判斷座標是否「看起來在曼谷」不足以確認正確性，還必須確認名稱、地址與分店。

---

## 2. 目前系統狀態

Notion 已經取代 Google Sheet，成為主要資料來源與策展工作台。

目前資料流：

```text
Notion（編輯、審核、管理來源）
  → 匯出固定 15 欄 CSV 快照
  → data/locations.csv
  → /api/locations
  → 地圖與列表
```

網站不會在使用者請求時直接查詢 Notion。Notion 更新後仍需經過：

```text
匯出
→ 快照驗證
→ Git commit / PR
→ Deploy Preview
→ 正式部署
```

Phase A 基線建立時（2026-07-19）：

- Notion 共有 98 筆地點。
- 97/98 筆已有 `Google Place ID`。
- Google Places 批次解析結果：
  - 57 筆與現有座標相距不超過 150 公尺。
  - 41 筆超過 150 公尺或需要人工檢查。
- 目前網站快照狀態：
  - `Verified`：81 筆。
  - `Needs Review`：16 筆。
  - `Could Not Find`：1 筆。
- `Verified` 中仍有 29 筆為 `Coordinates Approx = TRUE`。
- 目前在 UI 呈現的 97 筆中，共有 39 筆 `Coordinates Approx = TRUE`（29 筆 `Verified`、10 筆 `Needs Review`）；四狀態遷移前都需要補齊位置語意。
- 41 筆舊 resolver 風險報告中，目前有 27 筆 `Verified`、13 筆 `Needs Review`、1 筆 `Could Not Find`；報告仍可能包含 false match，只能用於人工風險排序。
- 前端目前採遷移期明確 allowlist，只在 UI 顯示 `Verified`、`Needs Review` 與 `Published`。
- `Draft`、`Verifying`、`Could Not Find`、`Closed`、`Paused`、`Inactive` 與未知值不出現在列表與地圖。
- 前台 UI 已隱藏審核狀態、狀態篩選器及協作驗證介面，只保留問題回報。
- Snapshot 已移除空白的 `Duplicate Group` 欄位，runtime row 也不再包含 `dup`。
- 未知或空白狀態會正規化為不在 UI 呈現的 `Draft`，避免 fail-open。
- 目前全專案為 212 項測試通過，typecheck 與 production build 通過。

2026-07-19 以 Notion connector 實際檢查 `Locations (PoC)`：

- `Locations` 與 `Locations (PoC)` 是不同的 database／data source，Default view 也有不同 ID。
- `Locations (PoC)` 已完整複製 98 筆資料，不再是 10 筆抽樣資料。
- 98 個 Slug 與正式 `Locations` 完全一致，沒有空白或重複 Slug，也沒有只存在其中一邊的資料。
- 逐筆比較 17 個正式欄位後差異為 0；兩邊 Status 分布同為 `Verified = 81`、`Needs Review = 16`、`Could Not Find = 1`。
- 兩邊同為 40 筆 `Coordinates Approx = TRUE`、1 筆缺少 Google Place ID；其中 UI 目前呈現的 Approx 仍是 39 筆。
- `Locations (PoC)` 寫入前只有與正式庫相同的 17 個 legacy properties、六種 legacy Status options，以及一個顯示全部正式欄位的 `Default view`。
- 寫入前基線已保存於 `docs/location-verification-poc-baseline-20260719.json`：包含 98 筆 PoC page URL、Slug 與 17 個正式欄位，且保存時與正式 `Locations` 的差異仍為 0。

2026-07-19 完成第一輪 Phase A PoC 後：

- PoC schema 已有 28 個 properties：17 個正式欄位加上 11 個檢核／恢復欄位；沒有建立 `Candidate Distance (m)` 或 Button。
- Status options 已只保留 `Draft` / `Published` / `Paused` / `Inactive`。
- 已保留 `Default view`，並新增 `待檢核`、`需要研究`、`已完成`、`過期或失敗` 四個 views。
- 98 筆全量保守遷移後，再完成 The Siam Hotel canary：`Published = 1`、`Paused = 96`、`Inactive = 1`；`待檢核 = 96`、`已完成 = 1`。
- The Siam Hotel 採 `Keep Current` + `Exact`，已完成 `pending → completed`；Candidate 欄位已清除，run IDs、人工備註與時間保留。
- PoC 仍有 98 個唯一 Slug；正式 `Locations` 仍為 `Verified = 81`、`Needs Review = 16`、`Could Not Find = 1`，且 17 個正式欄位相對寫入前 baseline 差異為 0。

2026-07-19 實際執行 `validate --all`：

- PoC 與正式資料各讀取 98 筆；98-Slug integrity、target invariants 與 PoC action reconciliation 通過。
- PoC 為 `Published = 4`、`Paused = 92`、`Inactive = 2`；5 個 post-migration 正式欄位差異全部有 completed action trace。
- 正式 baseline drift 首次因 `dear-december-cafe / Notes EN` 一個差異而未通過；維護者其後確認這是刻意修改，決定保留 immutable baseline、只核准目前精確值，PoC 暫不同步。
- 已新增以 baseline SHA-256 綁定的 append-only 正式變更核准 manifest；每個 `Slug + field` 的核准形成連續 `fromValue → approvedValue` 鏈，只有鏈尾精確 canonical value 可通過。
- 加入 1 筆正式核准後重跑：觀察到的正式差異 1、核准差異 1、未核准差異 0；所有 contract／layer PASS。
- Notion page ID 比對已改用 API `page.id`，URL fallback 只取最後 32 個十六進位字元，避免含標題 URL 造成 drift 誤報。
- 執行結果為 `NOTION_WRITE_PERFORMED=false`、`VALIDATION_RESULT=PASS`。
- stale-lock operator 已提供 `lock inspect --page <page>` 與 `lock clear --page <page> --confirm`；2026-07-19 對 KAEW BOUTIQUE 實跑 inspect 的結果為 `absent`，因此沒有執行 clear，也沒有 Notion read/write。其後 `validate --all` 再次全數通過。
- Phase A 最終技術 evidence audit 已完成：所有本機必測案例均有自動化或真實 canary 證據；兩個 Notion `PATCH` helper 都直接重驗 PoC allowlist；98 筆 live Payload contract 與 docs／data artifacts 掃描均未發現 Places content 持久化。完整證據矩陣與簽核清單記錄於進度文件 7.9。
- 維護者已於 2026-07-19 確認 resolver 的 dry-run／`--write`、apply preview／`--confirm` 與 stale-lock inspect／confirmed clear 操作流程可接受；Phase A 因此正式完成。這項簽核不會自動啟動 Phase B。
- 維護者其後決定暫緩 Phase B，先以本機流程逐筆驗證 Location；所有後續 resolver dry-run／write 固定使用 legacy Places API。CLI 預設 legacy 並拒絕 `auto`，Places New 只保留為內部相容測試路徑。
- 從 `待檢核` view 選擇 32Bar X 執行 legacy dry-run：候選 Place ID 與現有值一致，且 `NOTION_WRITE_PERFORMED=false`。維護者確認為同一地點後依序授權 Candidate write、人工決定欄位與 apply confirm；最終為 `Published`，Candidate 已清除，全量 validation PASS。結果詳見進度文件 7.10。

2026-07-19 啟動 Phase C0 read-only production rehearsal：

- 正式 `Locations` 重新盤點為 99 筆、99 個非空且唯一 Slug；相對 Phase A 的 immutable 98 筆基線新增 `khlong-bang-luang-floating-market`，沒有移除 Slug。
- 已從當下正式庫建立獨立的 `Locations (Production Rehearsal)`：database `3a2c23158ea2817982ded6ed65bbbed8`、data source `173c2315-8ea2-83d8-a33f-876f53663251`。來源與複本各 99 筆，以 Slug 對應逐筆比較 17 個正式欄位，差異為 0。
- 複製與比對結果保存在 [`location-verification-production-rehearsal-20260719.json`](location-verification-production-rehearsal-20260719.json)；這是新的 rehearsal 紀錄，不改寫 Phase A immutable baseline。
- 新增 localhost CLI `production-preflight --page <formal-page> --dry-run`。命令硬鎖正式 data source、只讀 `NOTION_FORMAL_READ_API_KEY`，沒有 `--write` 或 `--confirm` 路徑，也不讀取獨立的 `NOTION_FORMAL_WRITE_API_KEY`。
- 以新增的 Khlong Bang Luang Floating Market 實跑：正式 17 欄完整，但 11 個目標 workflow 欄位尚未建立；預覽為 `Draft + Review Needed = TRUE`，結果 `PREFLIGHT_RESULT=BLOCKED`、`NOTION_WRITE_PERFORMED=false`。
- 既有 `validate --all` 也正確捕捉 98→99 drift：唯一 issue 為新增正式 Slug；PoC target、action reconciliation 與正式既有欄位核准鏈仍通過。其後已另建 99 筆 versioned cutover baseline，沒有直接改寫 98 筆歷史基線或固定計數來掩蓋差異。
- Rehearsal 已新增 11 個 workflow properties，總數為 28；Status 先採六個 legacy options 與 `Published / Paused / Inactive` 並存，`Draft` 為兩個模型共用。99 筆仍含 legacy 值時不刪除舊 options。
- 99 筆 `Review Needed` 已依保守 mapping 初始化並回讀：TRUE 98、FALSE 1、錯配 0；沒有批次改 Status，也沒有填入日期、備註或 Candidate。
- 已建立只顯示 Name／Slug／Status／Review Needed 的 `Migration Audit` view。
- 32Bar X rehearsal canary 已完成 `Verified → Paused`、回讀、再 rollback 為 `Verified`；canary note 已清除，最後正式與 rehearsal 的 17 個正式欄位仍為 0 差異。
- Schema rollback 採非破壞策略：新增欄位與 options 保留；事故時還原資料值並切回 legacy-compatible app，不在資料仍含 legacy Status 時 DROP 欄位或刪除 options。

相關文件與程式：

- `docs/location-verification-tool-progress.zh-TW.md`
- `docs/location-verification-production-rehearsal-20260719.json`
- `docs/location-verification-formal-change-approvals.json`
- `docs/notion-migration-progress.md`
- `docs/notion-deploy-workflow.md`
- ~~`scripts/resolve.mjs`~~ / ~~`scripts/resolve-legacy-batch.mjs`~~ — 已刪除；resolve 邏輯併入 `scripts/location-verification-runner.mjs` 的 `resolve` 子命令
- `scripts/location-verification-runner.mjs`
- `tests/location-verification-runner.test.mjs`
- `scripts/export-snapshot.mjs`
- `scripts/validate-location-snapshot.mjs`
- `data/locations.csv`

### 2.1 正式 Locations 的 28→20 欄精簡

現行 localhost UI 只負責列出 `Review Needed`、顯示正式資料並執行 legacy
Candidate dry-run；維護者在 Notion 手動修正資料。因為 UI 不再保存 Candidate、
人工決定或 Apply 狀態，正式 `Locations` 應退役下列 8 欄：

| 退役欄位 | 遷移處理 |
|---|---|
| `Candidate Summary` | 唯一現值先封存；Candidate 改為 dry-run 當次顯示 |
| `Candidate Maps URL` | 唯一現值先封存；不再寫入 Notion |
| `Candidate Payload` | 唯一 place-id-only Payload 先封存；不再持久化 |
| `Review Decision` | 目前全空白，直接退役 |
| `Apply Metadata` | 15 筆完整歷史先封存；正式 UI 已沒有 Apply |
| `Origin` | 99 筆皆封存；正式 baseline 對帳只明確退役此一 legacy 正式欄位 |
| `Coordinate Type` | 15 筆完整封存；兩筆 `Representative` 語意保留在 `Verification Note` |
| `Place ID Checked At` | 13 筆完整封存；以較新的時間合併進 `Last Verified` |

目標正式 schema 為 20 欄：原本 17 個正式欄位移除 `Origin`，再保留
`Review Needed`、`Verification Note`、`Last Verified`、`Rejected Place IDs`
四個現行維護欄位。`Locations (PoC)` 保留歷史三段流程 schema，供既有測試與
稽核重現；正式 read-only UI 與正式 validator 不再依賴上述 8 欄。

安全遷移順序固定如下：

1. 以正式 read-only key 重新讀取全部 99 筆。
2. 將 8 欄逐筆原值、page identity 與相關 Verification Note／Last Verified
   保存成版本化 JSON。
3. 驗證唯一 Candidate、15 筆 Apply Metadata、Representative 語意與日期合併。
4. 更新正式 UI read model、preflight 與 validator；舊 PoC runner 不作為正式
   schema 的必要條件。
5. 完成本機測試、typecheck、build 與 live `validate --all`。
6. 只有 page patch 全部完成、全量驗證 PASS 且維護者核准同一 plan hash，才對
   正式 data source 執行精確的 8 個 `DROP COLUMN`。
7. DROP 後立即重新讀取 schema、全量對帳並走查 localhost UI；任一步失敗都不
   自動修正正式地點資料。

2026-07-20 live 封存結果：

- Artifact：
  [`location-verification-formal-property-retirement-20260720.json`](location-verification-formal-property-retirement-20260720.json)
- 99/99 頁均保存 8 欄；`Apply Metadata = 15`、Candidate 三欄各 1、
  `Review Decision = 0`、`Origin = 99`、`Coordinate Type = 15`、
  `Place ID Checked At = 13`。
- 唯一 Candidate 是 `channel-3-thailand-ch3`；完整 Payload 與 Maps URL 已封存，
  DROP 後如仍需比較，可由唯讀 UI 重新執行 legacy dry-run。
- `kaew-boutique` 與 `khlong-bang-luang-floating-market` 的
  `Representative` 語意已存在 `Verification Note`。
- 13 筆 `Place ID Checked At` 都沒有晚於 `Last Verified`。
- 因此正式 page patch 為 `0`；本次唯一 Notion mutation 是精確的 schema DROP。
- Archive hash：
  `sha256:148750bda6efaa7c3c356ffcce04d3a1eba834c968ceffbc9575a5177c4803e9`。
- Plan hash：
  `sha256:9f54c25c1aae25890e84bf4b3bc813b1f255c5a3376729b982d51d3b8fc260c8`。

新版 retirement contract 首次通過時，live `validate --all` 另發現 5 個頁面的
9 個未核准正式欄位差異。維護者已確認這些現值都是刻意修改並要求保留；9 筆
exact-value entries 已加入 immutable approval manifest，且 `syncPoc=false`。
重新 live 對帳後，觀察差異 29、核准差異 29、未核准差異 0，全部 7 個 layer
PASS。DROP 前 schema readback 也確認仍是同一正式 data source、28 欄，8 個
目標欄位全部存在且型別符合預期。

維護者其後明確核准上述 plan hash 與精確 8 欄 DDL。2026-07-20 執行一次
schema update，沒有任何 page property patch；獨立重新讀取同一正式 data
source 後為 20 欄，8 個退役欄位均已移除。DROP 後再次 live 執行
`validate --all`，PoC 98 筆、正式 99 筆，觀察差異 29、核准差異 29、未核准
差異 0、issues 0，全部 7 個 layer PASS。localhost 唯讀 UI 可載入 83 筆
`Review Needed`，並以 `channel-3-thailand-ch3` 完成 legacy Candidate
dry-run 與 UI 內全量資料對帳；全程沒有 Notion page write，browser console
也沒有 error 或 warning。

### 2.2 正式 Locations 的 20→17 欄精簡

維護者於 2026-07-20 在正式 Notion 進一步移除 `Branch Group`、
`Coordinates Approx` 與 `Rejected Place IDs`。Notion connector 重新讀取同一
正式 data source 後，現行 schema 為 17 欄：14 個正式內容欄位與
`Review Needed`、`Verification Note`、`Last Verified` 三個維護欄位。

正式 localhost UI 與 production preflight 依這 17 欄及其型別 fail-closed；
PoC 保留歷史三段流程 schema。網站 CSV 暫時保留 `Coordinates Approx` 欄位以
維持既有 15 欄公開快照格式，但正式 API exporter 與手動 CSV bridge 固定輸出
`FALSE`，不再讀取已刪除的 Notion 欄位。

正式 baseline 對帳只忽略已退役的 `Branch Group` 與
`Coordinates Approx`；其他欄位、Slug membership 與未核准修改繼續
fail-closed。`Rejected Place IDs` 不屬於 immutable 正式 baseline，已從現行正式
workflow 契約移除，但仍保留在 PoC 歷史流程中。

更新後 live 證據：

- `chin-bo-dang-central-world` production preflight：正式欄位 14/14、workflow
  欄位 3/3、property 17/17、錯誤型別 0，結果 `READY`、零 Notion write。
- localhost UI 可依新 schema 完成同步；當下 `Review Needed = 0`，因此顯示沒有
  待檢核地點，browser console error／warning 為 0。
- 全量 validator 已不再回報三個已刪欄位；retired property count 由 8 更新為
  11。
- 全量 validator 仍因正式庫現為 100 筆、`by` 被移除、
  `plantiful-sukhumvit-61` 新增，以及其他未核准內容差異而 FAIL。這些不是 schema
  相容問題，本次沒有自動核准、改寫 baseline 或修改 Notion page。

---

## 3. 現有驗證的缺口

目前的快照驗證主要確保技術契約正確：

- CSV header 固定。
- 資料列數為 98。
- 每筆都有唯一且非空的 `Slug`。
- 舊有收藏 ID 不會因 Notion 遷移而失效。
- CSV 能被前端解析。

這些檢查不能證明：

- Google Place ID 是否屬於正確分店。
- 地址是否與來源貼文吻合。
- Lat/Lng 是否為正確店面、入口或代表點。
- 店家是否已搬遷、關閉或改名。
- 名稱搜尋的第一個候選是否為正確地點。

因此需要把驗證拆成兩層：

```text
第一層：地點事實檢核
名稱、分店、地址、Place ID、座標、位置語意

第二層：快照與部署技術檢核
CSV schema、列數、Slug、收藏相容性、前端解析
```

---

## 4. 建議方案：Notion-first 混合式檢核

目前不建議先建立一套完整的獨立檢核網站。

建議架構：

```text
MVP：本機 Places resolver
  → 只查詢 Notion Locations (PoC) 的待檢核資料
  → 向 Google Places 查詢候選
  → 在本機暫時顯示候選內容、距離與風險，並提供 Google Maps 歸屬標示
  → 只將 Candidate Place ID 與非 Google workflow metadata 寫回 Locations (PoC)

Notion Locations (PoC)
  → 顯示目前資料與 Google 候選
  → 維護者人工判斷
  → 選擇 Review Decision
  → 由維護者在本機明確指定 page ID 執行 apply 指令

本機 apply worker
  → 重新讀取 Notion
  → 檢查候選是否過期、輸入是否已改變
  → 只在 Locations (PoC) 套用 Place ID、Maps URL、Status 與驗證紀錄
  → Lat/Lng 只保留已由維護者提供且具可保存來源的正式值

本機流程穩定後
  → 在 Locations (PoC) 加入唯一的 Apply Decision
  → 以 Notion Button webhook 呼叫同一套 apply 核心
  → 通過 webhook parity 與失敗恢復測試後，才另行核准正式資料庫 rollout

快照匯出器與前端
  → 匯出包含所有 Slug 的完整資料快照
  → 執行技術驗證
  → 目標狀態下，前端只顯示 Status = Published
  → 部署
```

角色分工：

| 元件 | 責任 |
|---|---|
| Google Places | 提供當次檢核使用的候選地點、Place ID、地址、座標與營業狀態 |
| Resolver | MVP 由本機執行；搜尋候選、計算距離、標記異常、寫回有期限的 Payload 與精簡摘要 |
| Notion | `Locations (PoC)` 用於 PoC 寫入驗證；正式 Locations data source 仍是 production system of record |
| Apply worker | 使用共用 apply 核心驗證候選版本與期限；MVP 由本機呼叫，穩定後才增加 Button webhook 入口 |
| 維護者 | 最終確認地點及座標語意 |
| UI eligibility validator | 在匯出前檢查 Notion 正式欄位是否符合 UI 呈現規則 |
| Snapshot validator | 阻擋 CSV 格式、識別碼與收藏相容性錯誤 |

Phase A MVP resolver／apply 的寫入權限只授予 Notion `Locations (PoC)`。測試 integration 不得連結正式 Locations data source；本機 runner 必須以允許的 data source ID fail-closed，ID 不符時立即停止。全量驗證另使用一支只有 Read content capability、且只分享給正式 `Locations` 的 integration；不得把 PoC integration 分享給正式資料庫，也不得讓正式 read-only token 進入任何寫入路徑。`Locations (PoC)` 已完整複製 98 筆正式資料，可用全部資料測試 schema、resolver、apply 與狀態遷移，但不進入網站正式快照。Phase C 現已增加 dormant-by-default 的正式單頁路徑；它不擴張 PoC integration 權限，必須使用獨立正式 write token、固定 page allowlist、一次只開一個 stage，並在每次正式寫入前另取逐階段授權。

### 4.1 「候選」的定義

候選（Candidate）是 resolver 根據地點名稱、泰文名、地址、區域提示及現有座標，從 Google Places 找到的「可能對應地點」。

候選只代表：

> 自動化工具認為這筆搜尋結果可能是同一個地點，請維護者確認。

候選不代表：

> 這筆搜尋結果一定正確，可以直接覆蓋 Notion 的正式資料。

資料關係：

```text
正式資料（目前網站使用）
  → Resolver 搜尋及比較
  → 候選資料（暫時的機器建議）
  → 維護者人工判斷
  → 更新或保留正式資料
```

候選是短期工作資料，不是網站的 system of record。只有通過維護者確認並由 apply worker 安全套用後，才會成為新的正式資料。

### 4.2 候選的四種人工判斷

| 決定 | 意義 | 對正式資料的影響 |
|---|---|---|
| 採用候選 | 確定候選與目前資料是同一個地點或正確分店 | 通過期限、revision 與重複檢查後更新正式 Place ID／Maps URL；Lat/Lng 必須另有可保存的來源，不從 Places content 自動落盤 |
| 保留目前資料 | 現有資料比候選可靠，或兩個位置都合理但網站選擇保留目前代表點 | 正式座標與 Place ID 不變，記錄人工確認與原因 |
| 拒絕候選 | 確認候選是同名店、錯誤分店或完全不同地點 | 正式資料不變，將候選 Place ID 加入拒絕紀錄，避免再次推薦 |
| 需要研究 | 現有證據不足，暫時無法決定 | 不更新正式資料；新地點維持不在 UI 呈現，既有 `Published` 資料是否改為 `Paused` 依實際風險人工決定 |

`Could Not Find` 是「沒有可供判斷的有效候選」時使用的流程結果，不是對某一個候選作出的第五種判斷。

`Deactivate` 也不是候選判斷；它是把已關閉或不再收錄的正式資料安全轉為 `Inactive` 的生命週期動作。即使當下候選或正式 Place ID 正確，也不會因此加入 `Rejected Place IDs`。

MVP 只保存一個最可能候選的 Place ID。如果搜尋結果中有多個合理地點，resolver 在 `Candidate Summary` 標示 `[Multiple Candidates]`，交由維護者開啟 Google Maps 研究，不自動選擇第一筆，也不把完整候選清單寫入 Notion。

---

## 5. Notion 可以完成的檢核介面

先前 mockup 中大約 70–80% 的功能可以直接在 Notion 完成。

| Mockup 功能 | Notion 實作方式 |
|---|---|
| 待檢核佇列 | 建立 `Review Needed = TRUE` 的 filtered view |
| 顯示目前資料 | 頁面 layout 的「目前資料」區段 |
| 顯示 Google 候選 | `Candidate Summary` 只顯示 workflow 狀態；`Candidate Maps URL` 以可保存的 Place ID 建立，詳細內容在 Google Maps 開啟 |
| 距離與異常原因 | Resolver 只在本機互動期間暫時顯示，不寫入 Notion、log 或 Git |
| 四種人工決定 | 使用單一 `Review Decision` 下拉選單 |
| 套用決定 | MVP 使用本機 apply 指令；穩定後才加入唯一的 `Apply Decision` database button |
| 查看位置 | 正式與候選各自保留 Google Maps URL |

建議 Notion 頁面配置：

```text
頁首
- Status
- Review Needed

目前資料
- Name
- Google Maps URL
- Google Place ID
- Lat / Lng

Google 候選
- Candidate Summary
- Candidate Maps URL

人工判斷
- Coordinate Type
- Coordinates Approx
- Review Decision
- Verification Note
- Last Verified
- Apply Decision（webhook 階段才加入）

隱藏的技術資料
- Candidate Payload
- Apply Metadata
- Rejected Place IDs
- Slug
- Resolver metadata
```

### 5.1 頁面設計原則

Notion 頁面只協助維護者回答三個問題：

1. 現在的正式位置是什麼？
2. Resolver 建議的位置是什麼？
3. 我要採取哪一個決定？

候選 Place ID、query、review expiry 與 basis revision 等機器資料不拆成大量可見欄位，統一收進隱藏的 `Candidate Payload`。Google Places 回傳的名稱、地址、Lat/Lng、營業狀態、距離與排名只在 resolver 的當次互動中暫時顯示，不寫入 Notion、log、Git 或 Payload。

這樣可以保留安全機制，同時避免：

- Notion table 因大量技術 property 變得過寬。
- 人工檢核時被不必要的 metadata 干擾。
- 每次 resolver schema 改動都必須修改多個 Notion properties。
- 四個 database button 各自占用一個欄位並增加誤按風險。

---

## 6. Notion 無法單獨完成的部分

Notion 本身不適合負責：

- 使用 Google Places API 搜尋並排序候選。
- 判斷名稱搜尋結果是否為相同分店。
- 計算兩組經緯度的精確距離。
- 解析 Google API 回傳後，自動填入完整候選資料。
- 在同一畫面提供兩張完整的互動地圖並自動切換下一筆。

MVP 先由本機程式保管 Google API key、呼叫 Places API 並回寫 Notion `Locations (PoC)`，不先建立 webhook endpoint。本機流程穩定後，Notion Button webhook 仍需要一個外部端點接收請求並呼叫相同的 resolver／apply 核心；屆時再決定託管位置。

### 6.1 Google Places 資料保存邊界

不能假設 Google Places 回傳的名稱、地址、座標與營業狀態可以保存在 Notion。

- `Place ID` 是明確可長期保存的識別碼。
- 2026-07-19 重新核對官方 Places API policy：除明確例外外，不得 pre-fetch、cache 或 store Places API content；Place ID 明確不受 caching restrictions 限制。
- 因此 Phase A 採 **place-id-only persistence**：Notion 只保存 Place ID、由 Place ID 建立的 Maps URL，以及本系統自己的 workflow metadata。
- 名稱、地址、Places Lat/Lng、營業狀態、搜尋排名、距離與 match score 只存在當次本機互動記憶體並直接顯示於互動 terminal；不得寫入 Notion、持久化 log、檔案、Git 或網站 snapshot。
- 本機顯示 Places content 時必須在同一視覺容器顯示 `Google Maps` 歸屬標示，並提供 Google Maps 來源連結。
- 人工接受後永久保存的是 Place ID、人工決定、驗證時間、來源與可合法保存的正式資料；Lat/Lng 不得只因來自 Places API 就自動寫入正式欄位。
- 若帳戶契約另有允許範圍，必須先留下書面依據並更新本節，才能放寬 persistence。

MVP 必須加入：

- `Candidate Payload.resolvedAt`
- `Candidate Payload.reviewExpiresAt`
- 到期候選清除 Candidate Place ID 與 Maps URL，保持 `Review Needed = TRUE`，並在 `Candidate Summary` 顯示 `[Expired]`；禁止直接採用。
- 只有 `Published` 且已儲存超過 12 個月的 Place ID 進入重新確認佇列；排程同時寫入原因，`Inactive` 不排入。

參考：

- <https://developers.google.com/maps/documentation/places/web-service/policies>
- <https://developers.google.com/maps/documentation/places/web-service/place-id>

---

## 7. Notion Map View 的定位

Notion 已提供原生 `Place` property 與 Map View：

- 單一 Map View 最多顯示 100 筆，目前 98 筆資料剛好適用。
- 可以點擊地圖 pin 開啟對應的 Notion 頁面。
- 不能直接計算兩個地點之間的距離。
- `Place` property 目前未被 Notion API 完整支援；API 讀取其值時會得到 `null`。

因此：

- Map View 可以作為人工瀏覽與區域合理性檢查。
- 不應把 Notion `Place` property 當成匯出器的正式座標來源。
- 網站的正式位置仍使用 `Lat`、`Lng` 和 `Google Place ID`。
- 如果新增 `Place` property，它只能是輔助視圖，不是 system of record。

參考：

- <https://www.notion.com/help/maps>
- <https://developers.notion.com/reference/property-object#place>

---

## 8. 建議的 Notion 欄位

### 8.1 現有正式欄位

- `Name`
- `Slug`
- `Name ZH`
- `Thai / Alt Name`
- `Category`
- `Notes EN`
- `Notes ZH`
- `Google Maps URL`
- `Google Place ID`
- `Lat`
- `Lng`
- `Coordinates Approx`
- `Status`：目前 live schema 仍為 `Draft` / `Needs Review` / `Verifying` / `Verified` / `Could Not Find` / `Closed`
- `Source URLs`
- `Source Tags`
- `Branch Group`
- `Origin`

Live Notion schema 沒有 `Duplicate Of` 或 `Duplicate Group`。同品牌分店只使用 `Branch Group` 整理，且不輸出到網站 snapshot。

目標設計會將 `Status` 精簡為 `Draft` / `Published` / `Paused` / `Inactive`；遷移方式見 8.4。`Review Decision = Could Not Find` 仍保留，但不再需要同名的 Status。

### 8.2 MVP 新增欄位：人工可見

只顯示會直接協助判斷的欄位：

| 欄位 | 型別 | 用途 |
|---|---|---|
| `Review Needed` | Checkbox | 是否仍需要維護者處理；勾選即進入待檢核佇列 |
| `Candidate Summary` | Rich text | 只保存 `[Candidate Ready]`、`[Multiple Candidates]`、`[Expired]`、`[Apply Failed]` 等本系統 workflow 訊息，不保存 Places content |
| `Candidate Maps URL` | URL | 由可保存的 Candidate Place ID 建立，用於開啟 Google Maps |
| `Coordinate Type` | Select | `Exact` / `Entrance` / `Representative` / `Approximate` |
| `Review Decision` | Select | `Accept Candidate` / `Keep Current` / `Reject Candidate` / `Need Research` / `Could Not Find` / `Deactivate` |
| `Verification Note` | Rich text | 維護者的判斷依據 |
| `Last Verified` | Date | 最後一次完成人工確認的時間 |

### 8.3 MVP 與後續階段的機器欄位

| 欄位 | 型別 | 用途 |
|---|---|---|
| `Candidate Payload` | Rich text | 保存 Candidate Place ID 與本系統的 query、resolvedAt、reviewExpiresAt、basis／workflow revision 等 JSON；不得包含其他 Places content |
| `Apply Metadata` | Rich text | Phase A 保存最近一次本機 apply 的 run ID、決定、狀態、revision 與時間；完成後不清除 |
| `Rejected Place IDs` | Rich text | 每行一個已拒絕 Place ID；resolver 不得再次推薦 |
| `Place ID Checked At` | Date | `Published` 資料超過 12 個月時進入重新確認佇列；`Inactive` 不排入 |
| `Apply Decision` | Button | 本機 PoC 不建立；流程穩定後才加入，將目前 `Review Decision` 交給 webhook apply worker |

`Apply Metadata` 使用 `lv1:` 前綴的版本化精簡 JSON，不把每個 job metadata 拆成 Notion property。前綴可避免 connector 將 JSON-looking rich text 誤判成物件：

```text
lv1:{"schemaVersion":1,"actionRunId":"01K...","reviewRunId":"01K...","decision":"Keep Current","state":"pending","basisRevision":"sha256:...","updatedAt":"2026-07-19T00:00:00Z"}
```

`state` 只使用 `pending`、`completed`、`failed`。`reviewRunId` 只適用於候選檢核；`Deactivate` 沒有候選流程時設為 `null`。`Apply Metadata` 不屬於正式地點資料，也不得納入 basis／workflow revision 的 canonical input，避免寫入 `pending` 本身讓候選失效。它只保留最近一次 action 的恢復資訊；完整歷史仍由含 run ID 的 append-only `Verification Note` 保存。

`Candidate Payload` schemaVersion 2 採 place-id-only persistence，實際 rich text 使用 `lv2:` 前綴：

```text
lv2:{"schemaVersion":2,"reviewRunId":"01K...","result":"place_id_candidate","placeId":"ChIJ...","candidateSource":"existing_place_id","query":"search query","resolvedAt":"2026-07-19T00:00:00Z","reviewExpiresAt":"2026-08-18T00:00:00Z","revisionSchemaVersion":1,"basisRevision":"sha256:...","workflowRevision":"sha256:..."}
```

`Candidate Payload` 必須實作成以 `result` 區分的 discriminated union，而不是只檢查一個寬鬆 JSON：

所有 variants 都必須包含 `schemaVersion`、`revisionSchemaVersion`、`reviewRunId`、`basisRevision` 與 `workflowRevision`；只有可保存的 Place ID、review 期限與本系統錯誤欄位依 `result` 改變。

| `result` | 必填內容 | 禁止或限制 |
|---|---|---|
| `place_id_candidate` | 單一候選 Place ID、candidate source、query、resolvedAt、reviewExpiresAt 及兩種 revision | 只有此型別可被 Accept／Reject；不得包含 Places 名稱、地址、Lat/Lng、營業狀態、距離、排名或 match score |
| `ambiguous` | run metadata、query、reviewExpiresAt 及兩種 revision | 不保存候選清單或候選 Place ID；必須由維護者在 Google Maps 研究後，以明確 Place ID 或更精確 query 重跑 |
| `no_candidate` | run metadata、query、reviewExpiresAt 及兩種 revision | 不得包含候選 Place ID 或其他 Places content |
| `error` | run metadata、穩定的本系統 error code、兩種 revision | 不得包含可套用候選；仍可依其他人工證據 Keep Current／Could Not Find／Need Research |
| `expired` | reviewRunId、basis／workflow revision、resolvedAt、expiredAt | 必須移除 Candidate Place ID 與 Maps URL |

`Candidate Maps URL` 是方便人工開啟的衍生欄位，不是 apply worker 的可信來源：

- `place_id_candidate`：由 resolver 使用 Place ID 建立 canonical Google Maps URL。
- `ambiguous`：只能提供由 query 建立的 Google Maps 搜尋 URL，不得偽裝成已選定候選。
- `no_candidate`、`error`、`expired`：預設清空。
- Accept 時由 worker 使用已驗證的 Place ID 重新建立正式 `Google Maps URL`，不從可編輯的 `Candidate Maps URL` 複製。

Payload 是短期工作資料：

- Resolver 寫入時只產生 workflow-only `Candidate Summary`、`Candidate Maps URL` 與 place-id-only Payload；距離與候選詳情只在本機互動期間顯示。
- Apply worker 只信任 payload 中通過 schema、期限與 revision 驗證的值。
- `reviewRunId` 是每次 resolver 執行的唯一識別碼，用於防止重複套用、延遲 webhook 與舊決定污染新候選。
- `workflowRevision` 保護 Status 與頁面生命週期等套用前提，避免舊候選重新啟用已暫停或已終止的資料。
- 完成 `Accept Candidate`、`Keep Current`、`Reject Candidate`、`Could Not Find` 或 `Deactivate` 時，Candidate Summary、Maps URL 與 Payload 一併清除。
- `Apply Metadata` 不隨 Candidate 欄位清除；它保留最近一次 action 的 run ID 與完成狀態，供重試對帳。
- 候選到期時清除 Candidate Place ID 與 Maps URL，將 Payload 改為 metadata-only 的 `expired` envelope，並保留不含地點內容的 `[Expired]` 提示。
- Payload 不輸出到網站、不提交 Git，也不是永久稽核紀錄。

相較原本拆成 20 多個 properties，MVP 只新增 7 個人工可見欄位與 4 個隱藏資料欄位；webhook 階段再增加 1 個按鈕欄位。檢核佇列只需要一個 Checkbox，不維護多值狀態機。

### 8.4 UI 呈現狀態與檢核佇列分離

正式狀態與檢核佇列各自只有一種責任：

| 欄位 | 回答的問題 | 是否影響 UI 呈現 |
|---|---|---|
| `Status` | 目前正式資料是否可在 UI 呈現，以及是否仍屬有效收錄項目 | 是；目標模型只有 `Published` 會在 UI 呈現 |
| `Review Needed` | 是否仍需要維護者處理 | 否；定期複查不應讓最後已知安全資料自動從 UI 消失 |

目標 Status 精簡為四種：

| Status | UI 呈現 | 建議用途 |
|---|---:|---|
| `Draft` | 否 | 新增但尚未完成人工確認，或仍在整理的地點 |
| `Published` | 是 | 已完成人工安全確認，可在 UI 呈現；可搭配 `Review Needed = TRUE` 繼續補強 |
| `Paused` | 否 | 既有位置可能造成錯誤導航，重新檢核期間暫停在 UI 呈現 |
| `Inactive` | 否 | 已關閉、人工確認找不到或不再收錄，但仍保留資料列與 Slug |

這個模型將：

- `Verified` 與 `Needs Review` 合併為 `Published`，是否仍要處理由 `Review Needed` 表示。
- `Could Not Find` 與 `Closed` 合併為 `Inactive`，具體原因寫入結構化 `Verification Note`。
- `Verifying` 改名為 `Paused`，直接表達它是暫停 UI 呈現，而不是另一套審核狀態。

目前程式與 Notion 仍使用六種 legacy Status，必須採相容遷移，不能直接改資料造成全部地點消失：

| Legacy Status | 目標 Status | `Review Needed` |
|---|---|---:|
| `Draft` | `Draft` | TRUE |
| `Needs Review` | 完成最低安全確認者 `Published`；有導航風險者 `Paused` | TRUE |
| `Verifying` | `Paused` | TRUE |
| `Verified` | 完成 baseline backfill 後為 `Published` | 已列入 41 筆 queue／定期複查者為 TRUE，其餘為 FALSE |
| `Could Not Find` | 補齊生命週期紀錄後為 `Inactive` | FALSE |
| `Closed` | 補齊生命週期紀錄後為 `Inactive` | FALSE |

遷移順序：

1. 先部署 parser、前端與 validators 的短期相容模式，同時識別 legacy 與目標值；`Published` 在 UI 呈現，`Paused`／`Inactive` 不在 UI 呈現。
2. 建立 `Review Needed`、`Coordinate Type`、`Verification Note`、`Last Verified`、`Place ID Checked At` 及四個目標 Status options。
3. 完成現有風險資料的人工 containment triage。
4. 逐筆執行 baseline backfill；只有通過 `Published` 全部 invariants 的頁面才改成 `Published`。尚未完成者保留 legacy Status，已知有導航風險者改為 `Paused`。
5. `Last Verified` 必須是實際人工確認時間，不得以 migration time 自動填入；若 Place ID 當次沒有成功 refresh，也不得虛填 `Place ID Checked At`。
6. 當 legacy Status 歸零後，匯出並部署純四狀態 snapshot；確認 UI 呈現數量後，再移除相容模式，validators 只接受四種目標值。

#### Locations (PoC) 的全量技術遷移規則

2026-07-19 已取得修改 `Locations (PoC)` 全部 98 筆 Status 與流程欄位的明確授權；這項授權不延伸到正式 `Locations`。PoC 的全量狀態遷移是 schema／workflow rehearsal，不是對 98 筆地點正確性的批次背書：

| PoC legacy Status | PoC rehearsal Status | `Review Needed` | 原因 |
|---|---|---:|---|
| `Draft` | `Draft` | TRUE | 尚未完成確認 |
| `Needs Review` | `Paused` | TRUE | 尚未用新流程確認，採保守的不在 UI 呈現狀態 |
| `Verifying` | `Paused` | TRUE | 延續既有風險 containment |
| `Verified` | `Paused` | TRUE | 缺少新模型要求的真實 `Last Verified`、`Verification Note` 與位置語意，不直接批次設為 `Published` |
| `Could Not Find` | `Inactive` | FALSE | 保留既有生命週期結果；不得自動產生日期或備註 |
| `Closed` | `Inactive` | FALSE | 保留既有生命週期結果；不得自動產生日期或備註 |

遷移後只有實際跑完人工決策與 target validator 的 canary page 可以從 `Paused` 或 `Draft` 變成 `Published`。其餘資料保持安全但未完成的狀態；不得為了讓 PoC 看起來完整而批次填入驗證日期、備註或 `Coordinate Type`。

Resolver 結果不再建立獨立 `Candidate Result` property：

- Resolver 結果存在短期 `Candidate Payload.result`。
- 人工結果由 `Review Decision` 表示。
- 完成後永久保留 `Last Verified`、結構化的 `Verification Note` 與正式資料。
- Apply worker 將決策、時間與變更摘要附加到 `Verification Note`，Resolver 可以安全清空 `Review Decision`，但不得覆寫既有驗證紀錄。

行為規則：

- 新增資料：`Status = Draft`、`Review Needed = TRUE`，不在 UI 呈現。
- 已在 UI 呈現的資料定期複查：保留 `Status = Published`，只勾選 `Review Needed`。
- 若已有強證據表示目前正式資料可能造成錯誤導航，改為 `Status = Paused`，立即停止在 UI 呈現。
- 完成接受候選或保留目前位置後：`Status = Published`、`Review Needed = FALSE`。
- `Could Not Find` 決定：`Status = Inactive`、`Review Needed = FALSE`，不在 UI 呈現但仍保留完整資料列與 Slug。
- 店家已關閉或決定不再收錄：選擇 `Deactivate`，由 worker 原子地設為 `Inactive`、清除檢核佇列與 Candidate 欄位，並在 `Verification Note` 記錄原因；不把仍正確的 Place ID 當成錯誤候選。
- 候選過期或套用失敗：保持 `Review Needed = TRUE`，由 `Candidate Summary` 顯示原因。

不另外保存 `Not Queued`、`Pending`、`Research Needed`、`Expired`、`Completed`、`Apply Failed` 等狀態。需要的視圖由現有欄位組合：

| 視圖 | Filter |
|---|---|
| 待檢核 | `Review Needed = TRUE` |
| 需要研究 | `Review Needed = TRUE` 且 `Review Decision = Need Research` |
| 已完成 | `Review Needed = FALSE` 且 `Last Verified` 有值 |
| 過期或失敗 | `Review Needed = TRUE` 且 `Candidate Summary` 包含 `[Expired]` 或 `[Apply Failed]` |

Candidate 欄位與 `Apply Metadata` 都不輸出到網站快照；前者是短期策展資料，後者只用於 apply 恢復與稽核。

---

## 9. Review Decision 與分階段套用入口

Notion 不建立四個 database button。MVP 由維護者先在 `Review Decision` 選擇決定，再於本機明確指定測試 data source ID 與 page ID 執行 apply 指令。這個本機入口會重新讀取頁面並呼叫共用 apply 核心，不接受指令列直接傳入正式 Lat/Lng、Place ID 或 Status。

本機流程通過穩定性與失敗恢復測試後，才在 `Locations (PoC)` 加入唯一的 `Apply Decision` database button；Button webhook 仍呼叫同一套 apply 核心，不另做一套決策邏輯。

```text
Review Decision
  ├─ Accept Candidate
  ├─ Keep Current
  ├─ Reject Candidate
  ├─ Need Research
  ├─ Could Not Find
  └─ Deactivate

MVP：[本機 apply 指令]
穩定後：[Apply Decision] → webhook → 同一套 apply 核心
```

好處：

- 本機 PoC 不必先承擔 webhook、對外 endpoint 與 Button payload 的不確定性。
- webhook 階段仍只有一個 button property。
- 降低本機指令或按鈕套用錯誤動作的風險。
- 所有決定走同一套驗證與 apply worker。
- 未來新增決定時不需要再增加 Notion 欄位。

### 9.1 Apply worker 的共同檢查

本機入口必須明確取得測試 data source ID、page ID 與寫入確認，webhook 入口則只接收 page ID、候選流程適用的 `reviewRunId` 與觸發資訊。兩者都由 worker 重新讀取 Notion，不信任外部送入的正式欄位或舊 `Review Decision`。`Deactivate` 不依賴 Candidate Payload，由 worker 產生獨立 `actionRunId`。

Notion Database Button webhook 的實際 payload 不能只依文件假設。Phase B 必須先用測試 endpoint 與 `Locations (PoC)` 驗證：

- 是否能穩定取得觸發頁面的 page ID 與當下 `reviewRunId`。
- custom header、request body、content type 與重複點擊時的實際行為。
- webhook timeout 與失敗後 automation 是否被暫停。
- endpoint 是否能先快速驗證並回覆成功，再由佇列非同步執行 Notion read／write。

若 Database Button 無法可靠送出必要識別資料，改用「按鈕寫入 `Apply Requested At`，由 connection webhook 或短輪詢 worker 讀取頁面」的 fallback，不讓 page ID 依賴可編輯的名稱或 Slug。

所有決定都必須確認：

- Page 確實屬於入口允許的 Locations data source；MVP 的 parent data source ID 只能等於 allowlist 中的 `Locations (PoC)`，其他 ID 一律 fail-closed。
- Webhook 階段另外確認 secret header 正確。
- Page 不在 trash，且目前 Status 是允許此決定處理的值。
- `Review Decision` 是支援的值。
- 同一個 action idempotency key 尚未成功套用。

除 `Deactivate` 外的候選檢核決定還必須確認：

- `Review Needed = TRUE`。
- `Candidate Payload` 可以解析，`schemaVersion`、`revisionSchemaVersion` 與 `reviewRunId` 支援且吻合。
- Payload 的 `basisRevision` 與目前正式欄位一致。
- Payload 的 `workflowRevision` 與目前 Status、頁面生命週期及其他套用前提一致。

`Deactivate` 可以在 `Review Needed` 為 TRUE 或 FALSE 時執行，也不要求 Candidate Payload。本機 runner 必須先產生 `actionRunId` 並以 `pending` 保存到 `Apply Metadata`，重試時明確沿用同一 ID。Webhook 階段優先使用穩定的 delivery／trigger ID；若 Notion 不提供，button fallback 必須先寫入 `Apply Requested At`，以 page ID、`Deactivate` 與該時間建立穩定 key。Phase B 的外部 durable store 必須先原子 claim idempotency key，再寫入 Notion。若已有 Candidate Payload，只將它視為要清除的短期資料，不使用其中候選值。

冪等紀錄必須在檢查易變的頁面欄位前查詢。候選決定使用 `pageId + reviewRunId + Review Decision`；本機 `Deactivate` 使用 `pageId + actionRunId + Deactivate`，webhook `Deactivate` 使用 stable trigger ID，或 fallback 的 `pageId + Apply Requested At + Deactivate`。Phase A 從 `Apply Metadata` 與 `Verification Note` 對帳；Phase B 先查外部 durable store，再以 Notion 紀錄交叉確認。若同一請求已成功，重送時直接回傳先前結果，不因 Candidate 欄位已清除或 `Review Needed = FALSE` 而誤報失敗。

Phase A 直接以同一個 `Locations (PoC)` page 的 `Apply Metadata` 保存狀態：

```text
pending → completed
   └──→ failed
```

- 本機 runner 在正式欄位寫入前，先將 action、run ID、revision 與 `state = pending` 保存到 `Apply Metadata`。
- Phase A 的同一 page action 必須序列執行。`apply --confirm` 先以 page ID 在作業系統暫存目錄建立原子 lock file；另一個本機 Node process 必須在任何 Notion read/write 前 fail-closed。
- 正常完成與 runner 錯誤都釋放 page lock。若 process 被強制終止留下 lock，不得自動搶鎖；operator 先以 `lock inspect --page <page>` 讀取 owner／路徑／狀態，再以明確的 `lock clear --page <page> --confirm` 嘗試清除。
- clear 只接受 metadata 完整、`schemaVersion = 2`、same-host 且 owner PID 已不存在的 stale lock。active、remote、malformed、PID 無法判斷或 inspection 後 token 改變時一律 fail-closed；短暫 maintenance guard 必須阻擋同時的新 lock acquisition。
- 本機 page lock 只處理單機 Phase A 的誤觸並行，不是分散式鎖。`Apply Metadata` 仍是恢復紀錄，也不得假設它具備跨 worker 的 compare-and-set 能力；Phase B 必須使用外部 atomic claim。
- 正式欄位、Candidate 清除、包含 run ID 的 `Verification Note` 與 `Apply Metadata.state = completed` 必須放在同一個最終 page update。
- 若最終 update 的回應遺失或 runner 中斷，重試時重新讀取 page：已存在相同 run ID 與 `completed` 就直接回傳成功；仍為 `pending` 才以相同 run ID 重新驗證並繼續。
- 若最終 update 明確失敗或結果暫時無法確認，保留同一 action 的 `pending`，不得自動回滾或建立第二個 action；重試時先回讀再決定續跑或回報完成。
- 已確認無法套用時寫入 `failed` 與穩定的錯誤摘要，但不得改動正式地點欄位。

Phase B 加入 Button webhook 前，必須重新評估並選定可原子 claim 的外部 durable queue／store。啟用 webhook 後，Notion 的 `Apply Metadata` 保留為 audit mirror，而外部 store 才是並行控制與 job 狀態的權威來源：

```text
pending → notion_applied → completed
```

- 外部 job 保存預期 patch；建立 `pending` 後才呼叫 Notion。
- 若 Notion 已更新但 worker 在保存 `notion_applied` 前中斷，重試時以 `reviewRunId`／`actionRunId` 對照 `Apply Metadata` 與 `Verification Note`；已套用則補記完成，未套用才安全重送。
- 不得在 Notion update 成功前把外部 job 標記為 `completed`。
- 若尚未找到能安全處理 webhook 重送、亂序與並行 claim 的方案，Phase B 不得啟用會寫入資料的 Button。

只有 `Accept Candidate` 與 `Reject Candidate` 必須確認：

- `Candidate Payload.result = place_id_candidate`。
- Payload 的 `reviewExpiresAt` 尚未到期。
- Candidate Place ID 不在 `Rejected Place IDs`。
- Candidate Place ID 沒有和其他 Slug 產生未解釋的衝突。

重複 Place ID 不只在 resolver 建立 Candidate 時查一次；apply dry-run 與 confirm 在 pending 前、pending 後／正式 PATCH 前都重新 query。目前沒有自動共址豁免，任何其他 page 命中同一 Place ID 都 fail-closed。

Google resolver 只提供證據，不是人工決策的閘門：

- `Keep Current` 可以搭配 `place_id_candidate`、`ambiguous`、`no_candidate`、`error` 或 `expired`，因為維護者可能依來源證據確認目前資料。
- `Need Research` 不要求有效候選。
- `Could Not Find` 不強制 `result = no_candidate`；若 payload 仍有候選，備註必須說明為何該候選不是正式地點。
- `Deactivate` 不要求有效候選；它處理已關閉或不再收錄的生命週期，不表示 Place ID 錯誤。

欄位完整性依決定檢查：

- `Accept Candidate` 與 `Keep Current`：必須填寫 `Coordinate Type` 與 `Verification Note`。
- `Reject Candidate`、`Could Not Find` 與 `Deactivate`：必須填寫 `Verification Note`。
- `Need Research`：允許先保存不完整判斷，但建議記錄目前缺少的證據。

任一條件不符時：

- 不更新正式欄位。
- 候選檢核決定保持 `Review Needed = TRUE`；`Deactivate` 保留原本的值。
- 將 `[Apply Failed]` 與錯誤摘要顯示在 `Candidate Summary`。
- 若已建立本次 action，只有確定性的決策／資料驗證失敗才將 `Apply Metadata.state` 設為 `failed` 並保留 run ID；最終 Notion write 的暫時性或不確定失敗保留 `pending` 供安全重試。
- 保留 `Review Decision`，讓維護者修正或重新執行 resolver。

Apply worker 必須具備冪等與重放保護，本機與 webhook 入口共用同一套決策規則。Phase A 以本機跨 process page lock 與同頁序列執行避免並行寫入；Phase B 必須由外部 durable store／queue 提供原子 claim 與序列化。Notion Database Button 的 `Send webhook` 只在付費方案提供，但不阻擋 Phase A 的本機 PoC；方案、Button payload、custom header 與正式 endpoint 在 Phase B 驗證。

Phase B 的 webhook endpoint 不應把一般欄位驗證失敗當成整個 Notion automation 的 HTTP 失敗。通過 webhook 身分驗證並成功排入處理後應快速回覆 2xx；個別資料的 apply error 寫回 Candidate Summary，避免 Notion 因 endpoint 失敗而暫停整個 automation。

允許的目標狀態轉移：

| 決定 | 允許的起始 Status | 結果 |
|---|---|---|
| Accept Candidate | `Draft` / `Published` / `Paused` | `Published` |
| Keep Current | `Draft` / `Published` / `Paused` | `Published` |
| Reject Candidate | `Draft` / `Published` / `Paused` | 保留起始 Status |
| Need Research | `Draft` / `Published` / `Paused` | 安全者保留；有導航風險者改 `Paused` |
| Could Not Find | `Draft` / `Published` / `Paused` | `Inactive` |
| Deactivate | `Draft` / `Published` / `Paused` | `Inactive` |

`Inactive` 不得透過一般 Apply Decision 重新變成 `Published`；重新收錄必須先由維護者執行明確的 reopen 動作，改回 `Draft` 並建立新的 review run。

### 9.2 各決定的結果

#### Accept Candidate

- 從已驗證的 payload 只取出 Place ID，並由 Place ID 建立 canonical Google Maps URL。
- 更新正式 Place ID 與 Maps URL；正式 Lat/Lng 不從 Places API response 或 Payload 自動寫入。
- 如果地點變更需要修改 Lat/Lng，維護者必須先提供可保存的來源與座標，再以新的 basis revision 重跑 resolver；apply worker 只驗證並保留該人工正式值。
- `Status = Published`
- `Review Needed = FALSE`
- `Last Verified = now`
- `Place ID Checked At = now`
- 保留人工填寫的 `Coordinate Type` 與 `Verification Note`。
- 在 `Verification Note` 附加本次決策、時間、舊／新正式值摘要與 `reviewRunId`。
- 清除所有短期 Candidate 欄位。

#### Keep Current

- 正式 Lat/Lng、Place ID 與 Maps URL 不變。
- `Status = Published`
- `Review Needed = FALSE`
- `Last Verified = now`
- 保存 `Coordinate Type` 與 `Verification Note`。
- 如果本次已成功用現有 Place ID 取得資料，設定 `Place ID Checked At = now`。
- 在 `Verification Note` 附加本次決策、時間與 `reviewRunId`。
- 不自動把候選加入拒絕清單；如果候選確定是不同地點，應選擇 `Reject Candidate`。
- 清除所有短期 Candidate 欄位。

#### Reject Candidate

- 正式資料不變。
- 將 payload 中的 Candidate Place ID 追加到 `Rejected Place IDs`。
- 保留套用前 Status：新資料維持 `Draft`；既有 `Published` 資料不會因拒絕一個錯誤候選而自動停止在 UI 呈現；既有 `Paused` 也不會自動恢復。
- 保持 `Review Needed = TRUE`，等待 resolver 搜尋下一個候選。
- 在 `Verification Note` 附加拒絕原因、時間與 `reviewRunId`。
- 清除所有短期 Candidate 欄位。

#### Need Research

- 正式資料不變。
- 保持 `Review Needed = TRUE` 與 `Review Decision = Need Research`。
- 在候選到期前保留 workflow-only Candidate Summary、Maps URL 與 place-id-only Payload 供研究；候選詳情由 Google Maps 顯示。
- 候選到期後清除 Payload 中的 Candidate Place ID 與 Maps URL，保留 metadata-only envelope，將 Candidate Summary 改為 `[Expired] Must rerun resolver`；仍保持勾選。
- 新資料維持 `Status = Draft`，不在 UI 呈現。
- 已在 UI 呈現且目前位置仍可信的資料可維持 `Published`；若已有錯誤導航風險，改為 `Paused`，暫停在 UI 呈現。

#### Could Not Find

- `Status = Inactive`
- `Review Needed = FALSE`
- `Last Verified = now`
- 保留 `Verification Note` 作為找不到地點的依據。
- 若 `Candidate Payload.result = place_id_candidate`，將該候選 Place ID 加入 `Rejected Place IDs`；選擇 `Could Not Find` 且留下原因，即代表該候選不是這筆正式地點。
- 在 `Verification Note` 附加本次決策、時間與 `reviewRunId`。
- 清除所有短期 Candidate 欄位。

#### Deactivate

- `Status = Inactive`
- `Review Needed = FALSE`
- `Last Verified = now`
- 正式 Lat/Lng、Place ID 與 Maps URL 保留，作為最後已知資料與歷史紀錄。
- 不把正式或候選 Place ID 加入 `Rejected Place IDs`。
- 在 `Verification Note` 附加停用原因、時間與 `actionRunId`。
- 清除 `Review Decision` 與所有短期 Candidate 欄位。

### 9.3 Coordinates Approx 與 Coordinate Type

兩個欄位語意不同，不應由按鈕含糊地互相推導：

| 欄位 | 語意 |
|---|---|
| `Coordinate Type` | 這個點代表店面、入口、區域代表點或近似位置 |
| `Coordinates Approx` | 經緯度本身是否仍不精確 |

預設規則：

- `Exact`：通常 `Coordinates Approx = FALSE`。
- `Entrance`：可為 `FALSE`，因為入口座標可以很精確，但必須保留 `Coordinate Type = Entrance`。
- `Representative`：座標可精確指向一個人工選定點，不強制設為 Approx；必須有 `Verification Note`。
- `Approximate`：`Coordinates Approx = TRUE`。

Apply worker 不自行猜測；它依人工填寫的兩個欄位保存結果，UI eligibility validator 檢查不合理組合。

---

## 10. Resolver 的搜尋順序

目前 `scripts/resolve.mjs`（歷史檔名；已刪除，邏輯後併入 `scripts/location-verification-runner.mjs` 的 `resolve` 子命令）仍採用 Google Text Search 回傳的第一筆。Phase A 必須先替換這個行為；不能只把第一筆重新命名為「最佳候選」。

建議順序：

1. 如果已有 `Google Place ID`：
   - 優先以 Place ID 取得最新資料。
   - 檢查名稱、地址、座標與營業狀態。
2. 如果 Place ID 空白或失效：
   - 以英文名、泰文名、地區、地址與來源提示組合搜尋。
3. 如果有多個候選：
   - 在本機記憶體中以名稱／別名、地址／區域提示、分店文字、距離、類型與營業狀態計算可解釋的 ranking evidence；不得將 Places content、距離或 match score 寫入 Notion 或 log。
   - 只有一個候選明顯領先且通過最低門檻時，才寫入 `result = place_id_candidate` 與該 Place ID。
   - 前兩名接近或分店證據不足時，寫入 `result = ambiguous`，在 `Candidate Summary` 標示 `Multiple Candidates`。
   - `ambiguous` 不得直接 Accept；維護者必須研究後，以明確 Place ID 或更精確 query 重跑 resolver。
   - 不宣稱 MVP 能在 Notion 中保存或選擇完整候選清單。
   - 實際使用後若多候選情況頻繁，再新增獨立 `Verification Candidates` relation database。
4. 計算候選與現有座標距離。
5. 檢查 Place ID 是否已被其他 Slug 使用；`Branch Group` 不能作為共用 Place ID 的自動豁免。
6. 排除 `Rejected Place IDs` 中的候選。
7. 寫入包含 `reviewRunId`、Candidate Place ID、basis revision 與 workflow revision 的 place-id-only Candidate Payload，並產生 workflow-only Summary 與 Maps URL；不保存 Places content、Distance 或 match score。
8. 設定 `Review Needed = TRUE`，並在寫入新 Payload 時清空舊的 `Review Decision`，避免舊決定套用到新候選。
9. 絕不由 resolver 自動把 `Status` 改成 `Published`。

### 10.1 Candidate Basis Revision 與 Workflow Revision

Resolver 每次產生候選時，以會影響解析結果的正式欄位建立 revision：

- `Slug`
- `Name`
- `Thai / Alt Name`
- `Category`
- `Google Maps URL`
- `Google Place ID`
- `Lat`
- `Lng`
- `Notes EN`
- `Notes ZH`
- `Source URLs`
- `Branch Group`

不得使用「可用的地址或區域提示」等動態欄位集合。Resolver 與 worker 必須共用同一個 canonical revision module，並在 Payload 保存 `revisionSchemaVersion`：

1. 依上方固定順序建立物件，不依賴 Notion API 回傳順序。
2. 所有字串統一換行為 LF、trim、Unicode NFC；空字串正規化為 `null`。
3. Lat/Lng 先解析為有限數字，再固定為 7 位小數；空值為 `null`。
4. URL 使用標準 URL parser，scheme 與 host 正規化；移除 fragment 與已明確列入規則的 tracking parameters，不自行猜測其他 query parameter。
5. 多值資料去除空值與重複值後，以穩定排序序列化。
6. 以固定 key order 產生 canonical JSON，再計算 SHA-256。

Apply worker 必須用同一個 `revisionSchemaVersion`、正規化與雜湊規則重新計算。如果版本不支援或 revision 不同，代表候選產生後正式輸入已被修改，必須拒絕套用並重新解析。

`workflowRevision` 另外保護不應被舊按鈕覆寫的流程狀態：

- 目前 `Status`
- Page 是否 archived／in trash
- Locations data source ID

`workflowRevision` 使用相同的 canonical JSON 與版本規則，但和 `basisRevision` 分開計算，避免人工允許修改的判斷欄位造成不必要失效。

`Review Decision`、`Coordinate Type`、`Coordinates Approx` 與 `Verification Note` 是候選產生後允許人工填寫的決定資料，不放入 `workflowRevision`；worker 仍必須在 apply 當下重新讀取並依決定驗證。`Review Needed` 也在 apply 當下要求為 TRUE。

### 10.2 現有 41 筆報告的用途

現有 `migration-output/place-id-resolution.json` 沒有保存候選 Lat/Lng，因此：

- 它只能作為建立 41 筆 review queue 的種子。
- 不可把它補成包含候選 Lat/Lng 的舊版 Candidate Payload。
- 報告中的候選 Place ID 可用於選擇 PoC canary，但實際 review run 必須重新建立 `reviewRunId`、basis／workflow revision 與 review expiry。
- 實際 resolver 可以優先 refresh 現有 Place ID，但 Places 詳細內容只在當次本機互動顯示，不寫入檔案、Notion 或 Git。

距離門檻只用於風險排序，不是正確性的唯一判斷：

| 距離 | 一般處理 |
|---:|---|
| ≤100m | 低風險，仍需快速確認分店 |
| 100–500m | 檢查入口、商場、樓層或舊座標 |
| >500m | 高風險，必須人工確認 |
| 大型公園／街區 | 使用 `Representative` 或 `Entrance`，不套用一般店面標準 |

`>500m` 的單一候選除了在當次畫面顯示 `high`，還會在 place-id-only
Candidate Payload 保存 `coordinateReviewRequired = true`。這只是本系統衍生的
安全旗標，不保存 Places Lat/Lng、距離或地址。旗標存在時，
`Accept Candidate` 與 `Keep Current` 都必須 fail-closed；維護者需先以可追溯、
可保存的來源修正正式 Lat/Lng，再重跑 resolver。若 Candidate 已寫入，必須先
執行 Candidate recovery；修改 Lat/Lng 後舊 basis revision 本來也不得繼續套用。

---

## 11. Published 的最低安全定義

`Published` 只表示這筆正式資料已達到可在 UI 安全呈現的門檻，不代表永遠不需複查。它必須符合：

- 已確認是正確地點或正確分店。
- 已確認地址或來源證據與候選吻合。
- 已確認 Lat/Lng 的用途。
- 若不是精確店面，已設定 `Coordinate Type`；`Representative`、`Approximate` 或 `Coordinates Approx = TRUE` 必須留下備註。
- 最後決定由維護者做出，而不是 resolver 自動設為 `Published`。
- `Verification Note` 已記錄本次人工判斷依據。
- `Last Verified` 已記錄。
- 若使用 Place ID，`Place ID Checked At` 已記錄；超過 12 個月時進入複查，但不自動取消 `Published`。
- 若 `Review Needed = TRUE`，`Verification Note` 必須說明尚待補強的事項，而且該事項不能是已知的錯分店或錯誤導航風險；後者必須改為 `Paused`。

`Coordinates Approx = TRUE` 不一定代表錯誤。例如：

- 國家公園的代表點。
- 夜市或街區的中心點。
- 商場入口。
- 活動場域的主要入口。

但 `Published + Coordinates Approx = TRUE` 必須同時有明確的 `Coordinate Type` 與 `Verification Note`。

Legacy migration 不豁免以上條件。目前在 UI 呈現的 97 筆必須逐筆完成 baseline backfill；其中 39 筆 Approx 資料還要補位置語意。沒有實際人工確認或 Place ID refresh 時，不得只為通過 migration 而自動填入日期。

---

## 12. UI 呈現規則

### 現況

目前前端、parser 與測試已採 legacy＋target 遷移相容模式：

```text
在 UI 呈現：Verified / Needs Review / Published
不在 UI 呈現：Draft / Verifying / Could Not Find / Closed / Paused / Inactive / blank / unknown
```

Parser 可辨識九個遷移期 raw status；未知或空白 status 仍正規化為 `Draft`，因此不會 fail-open。Snapshot validator 會在 parser 前先檢查 raw status，拼字錯誤或空白不得靠 `Draft` fallback 通過部署。前台 UI 不顯示審核 badge，使用者看不到 legacy 與 target status 的差異。

目標四狀態模型完成遷移後：

```text
在 UI 呈現：Published
不在 UI 呈現：Draft / Paused / Inactive / blank / unknown
```

### UI 呈現與資料可讀取的邊界

版本化快照保留所有非封存資料列，UI 呈現資格只由前端 allowlist 決定：

```text
Notion 所有非封存資料
  → 完整 snapshot（保留所有 Slug 與 Status）
  → 前端 isPublicLocation(row)
  → 目標狀態只顯示 Published
```

這裡的「不在 UI 呈現」不是保密或存取控制邊界：

- `/api/locations` 目前會回傳完整 snapshot，因此不在 UI 呈現的列仍可被技術使用者直接讀取。
- Snapshot 欄位不得放入秘密、私人來源、API key 或不應被外部取得的內容。
- 如果未來需要真正限制存取，必須由 server-side endpoint 只輸出 `Published` projection，完整 snapshot 改為內部 artifact；不能只依賴前端 filter。

`Published` 必須符合最低導航安全門檻：

- 不得用於新建但尚未人工判斷的資料；新資料使用 `Draft`。
- 必須有合法 Lat/Lng，以及可用且格式合法的 Google Maps URL 或 Place ID。
- 必須有 `Last Verified`；若仍為 `Review Needed = TRUE`，必須有說明待補強事項的 `Verification Note`。
- 若已知可能導向錯誤分店或錯誤區域，必須改為 `Paused`，立即停止在 UI 呈現。
- 可以用於座標仍為近似值、來源待補強或定期複查，但目前正式位置仍足以安全瀏覽的資料。

完整 snapshot 的目的仍是保留 legacy Slug、收藏相容性、稽核、回滾與重新啟用能力；不由 exporter 先依 UI 呈現資格過濾資料列。

---

## 13. 快照驗證的建議擴充

驗證拆成兩道，避免 CSV 不含的 Notion 欄位無法檢查。

### 13.1 匯出前 UI eligibility validator

直接檢查完整 Notion page properties：

- 完成遷移後，`Status` 必須是 `Draft` / `Published` / `Paused` / `Inactive` 之一，不接受拼字錯誤或空白；legacy 值只允許存在於有明確期限的遷移模式。
- `Published` 不允許空白 Lat/Lng，且 Lat/Lng 必須在合法範圍。
- `Published` 必須有格式合法的 Google Maps URL 或 Google Place ID。
- `Published` 必須有非空的 `Verification Note`。
- `Published` 必須有 `Last Verified`。
- `Published` 若有 Google Place ID，必須有 `Place ID Checked At`。
- `Published + Review Needed = TRUE` 必須有說明尚待補強事項的 `Verification Note`。
- `Published + Coordinates Approx = TRUE` 必須同時有明確 `Coordinate Type` 與 `Verification Note`。
- `Draft`、`Paused` 必須為 `Review Needed = TRUE`；`Inactive` 必須為 `Review Needed = FALSE`。
- `Inactive` 必須有 `Last Verified` 與說明停用原因的 `Verification Note`。
- 重複 Place ID 預設阻擋；`Branch Group` 不能作為豁免。只有經人工確認為同一實體地點，並列在 code-reviewed `data/place-id-sharing-exceptions.json` 的 Slug 組合與理由才可通過。
- `Rejected Place IDs` 不得等於目前正式 Google Place ID，除非有人工覆寫備註。
- `Review Needed = FALSE` 時不得殘留可套用的 Candidate Payload。
- Candidate Payload 存在、過期或 apply 失敗時，`Review Needed` 必須保持勾選。
- Candidate Payload 必須符合對應 `result` 的 discriminated-union schema；`place_id_candidate` 只可保存 Place ID 與 workflow metadata，其他 variants 不得殘留候選 Place ID。
- Candidate Payload、Summary、log 與 baseline artifact 不得包含 Places API 回傳的名稱、地址、Lat/Lng、營業狀態、距離、排名或 match score。
- `Review Needed` 由 Resolver／Apply worker 管理；人工頁面可以顯示，但不應作為一般手動完成按鈕。

Phase A 將這些規則實作為可重複執行的 `validate --all`，且同一次執行必須完成三層 fail-closed 對帳：

1. 對全部 PoC page 執行上述 target invariants。
2. 核對基線、PoC 與正式資料的 98 個 Slug 完整且唯一，並要求 PoC 每個 17 欄正式欄位差異都能追溯到 completed action。
3. 以獨立的 `NOTION_FORMAL_READ_API_KEY` 只讀正式 `Locations`，核對 98 筆、17 欄與 immutable baseline 加上正式變更核准鏈相符。

任一層失敗時只輸出問題並回傳非零狀態；不得自動修正資料。`NOTION_API_KEY` 只分享給 PoC，`NOTION_FORMAL_READ_API_KEY` 必須只有 Read content capability 且只分享給正式 `Locations`；缺少任一 token 時，在發出資料查詢前停止。

正式變更核准採 append-only manifest，不直接改寫原始 baseline：

- manifest 必須以 SHA-256 精確綁定 baseline 檔案；baseline 被改寫時全部核准立即失效。
- 每筆核准只適用一個既有 `Slug + field`；`Slug` 本身不能用 manifest 核准變更。
- 第一筆 `fromValue` 必須等於 baseline；同欄後續核准的 `fromValue` 必須等於上一筆 `approvedValue`。
- validator 只接受最新鏈尾的精確 canonical value；任何其他新值或退回歷史值都再次 fail-closed。
- 核准必須有唯一 `approvalId`、時間、維護者身分與理由；Phase A 固定 `syncPoc = false`，不能把正式內容編輯偽裝成 PoC review action。
- manifest 只改變正式 drift 的預期值；PoC action reconciliation 永遠繼續使用 immutable baseline。

### 13.2 匯出後 Snapshot validator

保留並擴充目前 CSV gate：

- 保留完整資料列與所有 legacy Slug。
- 15 欄 CSV header、Slug 唯一性、收藏相容性及前端解析必須通過。
- 完成遷移後，原始 snapshot status 必須是四個目標值之一；不能只依 parser 將錯字靜默轉成 `Draft`。
- 所有經緯度值必須在合法範圍。
- `Published` 資料必須有非空 Lat/Lng。
- 不允許 Candidate 欄位出現在網站 snapshot。
- 目標狀態測試只將 `Published` 視為可在 UI 呈現；`Draft`、`Paused`、`Inactive` 與未知值均不在 UI 呈現。
- 遷移相容測試另行確認 legacy `Verified`／`Needs Review` 在切換期間仍會呈現，並在 Notion 遷移完成後刪除相容分支。

2026-07-19 已以 versioned policy 取代網站 snapshot validator 的固定 98 筆判斷：

- [`data/location-snapshot-policy-v1.json`](../data/location-snapshot-policy-v1.json) 設定 `minimumRowCount = 98`，允許正常新增資料。
- 既有 98 個 Slug 由 `legacy-favorite-ids.json` 保護；新增資料不能取代或掩蓋消失的舊 Slug。
- 刪除／封存必須在 `deletionManifest` 記錄 `slug`、核准時間、核准者與原因；有效最低筆數才會按核准刪除數調整。收藏相容性仍是另一道獨立 gate。
- Raw status 必須精確屬於九個遷移期值；所有非空座標都必須在合法範圍。
- `Published` 額外要求完整 Lat/Lng 與合法 Google Maps URL。
- Policy 的 public status 必須與前端 allowlist 完全一致，避免 validator 與 UI 各自漂移。

Legacy Status 歸零後，必須再建立只接受 `Draft`／`Published`／`Paused`／`Inactive` 的下一版 policy；不能在現有 policy 上靜默移除相容規則。

Candidate 欄位與被拒絕候選不輸出到網站。

---

## 14. 本機檢核 UI 的定位與已採用範圍

### 14.0 現行唯讀模式（2026-07-20）

維護者重新定義 UI 的唯一目的為「協助檢查目前正式資料是否正確」。現行工具
不是 Notion workflow editor，也不再代替維護者記錄決定或發布資料。

現行範圍：

- UI server 完全唯讀，只使用正式 read credential 與 Google Places key；不讀取
  `NOTION_FORMAL_WRITE_API_KEY`。
- 正式 queue 只包含 `Review Needed = TRUE` 的頁面；取消勾選後，頁面在下一次
  手動重新整理、回到分頁觸發的同步或 60 秒 idle refresh 時離開 queue。
- 若目前頁面已離開 queue，UI 自動選取原位置的下一筆；沒有剩餘頁面時顯示
  queue 已完成。
- 唯一地點操作為 legacy Places resolver dry-run。畫面保留目前正式 Place ID、
  Maps URL、Lat／Lng、驗證時間、來源與備註，也顯示候選名稱、
  地址、Place ID、Lat／Lng、距離風險、Google Maps URL 及重複頁提示。
- Candidate 詳情只存在當次畫面記憶體；不寫入 Candidate 欄位、不發 ticket，也
  不保存到 browser storage、log、manifest 或 snapshot。同一地點重新同步時，
  只要名稱、Slug、Place ID 與 Lat／Lng 沒有改變就保留預覽；切換地點、地點
  離開 queue、上述正式比對資料改變或重載整頁時才清除。
- Candidate 已存在或過期時仍可重新 dry-run；UI 只把既有 Candidate 當作提示，
  不提供 reset。
- Review、Apply、Candidate confirm／reset 與獨立 Lat／Lng 修正全部從前端移除；
  對應的 server preview／confirm API 與 write-capable 啟動參數也已移除，不只是
  隱藏按鈕。
- 維護者由 UI 開啟 Notion，自行修改正式欄位並取消 `Review Needed`。
- `Last Verified` 不由 UI 更新。Notion database automation 負責在
  `Review Needed` 由 checked 變成 unchecked 時把 `Last Verified` 設為觸發時間；
  這是正式操作前必須確認已啟用的 Notion 端設定。
- UI 仍保留搜尋、正式資料／來源側欄、下一筆、手動與
  idle refresh、同步時間、responsive layout，以及唯讀的三層全量資料對帳。
- localhost、same-origin、session token、no-store 與 CSP 邊界保留；session
  token 現在只保護 read-only queue、resolver dry-run 與 validator request。

現行資料流：

```text
讀取 Review Needed 正式頁
→ legacy Candidate dry-run
→ 維護者人工比較
→ 維護者在 Notion 手動修改
→ 維護者取消 Review Needed
→ Notion Automation 更新 Last Verified
→ UI 同步後移至下一筆
```

### 14.A 已退役的三段 UI（歷史紀錄）

維護者先前曾以本機互動 UI 包裝 Phase A runner，讓 Candidate、Review、Apply
能在同一畫面執行。下列內容保留作為已完成的演進與 canary 證據，不再描述現行
UI，也不構成可用的正式寫入入口。

歷史實作範圍：

- 只綁定 `127.0.0.1`，不部署、不進入公開網站的 Vite production build。
- 從 `Locations (PoC)` 讀取完整 98 筆；預設顯示 `Review Needed = TRUE`，並提供 Candidate 與全部資料篩選。
- 正式 canary／診斷模式必須同時指定
  `--target formal --page <page-id-or-url>`，只讀該一頁；任何其他 page ID 由
  server 拒絕。日常逐筆操作另使用明確的 `--formal-workflow` 完整佇列模式。
- 正式模式預設為 read-only：Candidate、人工決定、Candidate recovery 與 Apply 均可依當下資料執行 preview，但所有 confirm route 都回傳 `403`，前端也以 `FORMAL READ ONLY` banner 與「本次未開放」按鈕明確呈現。
- 單頁模式每次啟動最多只能用
  `--allow-formal-write candidate|candidate-reset|review|apply` 開放一個階段。
  完整佇列模式雖在同一 session 提供三段入口，但各段仍需獨立 preview ticket
  與明確 mutation action，且受狀態順序 gate；沒有
  `NOTION_FORMAL_WRITE_API_KEY` 或 runner 的顯式 formal-write authorization 時，
  在寫入正式頁前停止。
- 同一頁呈現目前正式資料、來源脈絡、暫時性 Google Maps Candidate 與三段操作。
- 保留三段獨立操作：Candidate write 與人工決定 write 使用 confirmation modal；
  Apply dry-run 通過後由紅色「Apply 並發布」按鈕直接送出，不再顯示第二個 modal。
- Candidate 與 apply 都沿用 runner 的重新讀取、revision、allowlist、duplicate、page lock、pending／completed 與回讀驗證。
- 人工決定只允許寫入 `Review Decision`、`Coordinate Type`、`Verification Note`；既有 Verification Note 採 append-only。
- mutation request 需要同源 local session token、短效且一次性的 preview ticket，
  以及對應階段的明確 confirmation literal。Apply 的 literal 由維護者主動點擊
  「Apply 並發布」時送出，不依賴額外 UI modal。
- Preview ticket 另綁定 `poc`／`formal` target、page 與 stage，不能跨環境、
  跨頁或跨階段使用；正式 server consume ticket 前仍會檢查單頁 stage 或
  workflow authorization。
- Apply preview ticket 同時保存 server 產生的 actionRunId 與時間；confirm 必須沿用
  同一組 action identity 重建 pending／completed patch 並核對完整 signature，不得
  在 confirm 時重新產生另一組 run ID 或時間。2026-07-20 正式 KAEW 首次 Apply
  前由 fail-closed signature gate 發現此缺陷；修正與回歸測試通過後才執行正式寫入。
- Candidate 名稱、地址、座標、營業狀態與距離只存在當次瀏覽器記憶體；不使用 localStorage、sessionStorage、IndexedDB、檔案 log 或 snapshot。
- 單一候選距離超過 500 公尺時，只在 Payload 保存
  `coordinateReviewRequired = true` 與 workflow-only Summary 標記；
  server 與 UI 都阻擋 `Accept Candidate`／`Keep Current`，不保存距離或候選座標。
- API key 只存在本機 Node server，永遠不傳給瀏覽器。
- UI 內可執行 read-only 全量資料對帳；畫面明確分為 baseline／approvals／target 三項前置檢查，以及 Slug／PoC／formal 三層資料對帳，失敗時顯示完整 issue。
- 全量 Slug layer 採雙 membership contract：PoC 鎖定 immutable 98-Slug
  baseline，正式庫鎖定已雜湊且連回該 baseline 的 99-Slug cutover artifact；不是
  把全域固定計數從 98 改成 99。
- 已加入 Candidate recovery：即使 Payload 已過期或損壞，也可先 preview、再以獨立確認清除 Candidate workflow 欄位。Recovery 必須填寫原因、沿用跨 process page lock、回讀驗證並追加 audit note；不修改正式欄位、`Coordinate Type`、`Rejected Place IDs` 或既有 note，也不把 Candidate Place ID 視為已拒絕。
- `Verification Note` 在 UI 分成唯讀歷史與「本次新證據」。Server 負責 append-only 合併；除 `Need Research` 外都必須提供本次新證據，長文字依 Notion 每個 rich-text element 2,000 字元限制安全分段。
- Apply preview 與最終確認會列出完整效果，包括 Status、Review Needed、Place ID／Maps URL、Rejected Place IDs、驗證時間、Candidate／Review Decision 清除或保留、audit note 與 `Apply Metadata pending → completed`，不只顯示正式欄位。
- Review confirm 成功且 server 回傳的仍是目前選取頁時，UI 立即自動執行該頁的
  Apply preview／dry-run，使用更新後的 Review Decision 取得短效 Apply ticket
  並顯示完整效果。Preview 是 read-only；最終 Apply 仍須維護者主動點擊第三段
  「Apply 並發布」，但不再開啟 confirmation modal。失敗時保留已寫入的 Review
  決定並顯示 dry-run 錯誤。
- UI 有 decision-aware inline validation；無效、過期或非 `place_id_candidate` 時不能選 Accept／Reject，Accept／Keep Current 必須選 Coordinate Type。
- 寫入成功後直接合併 server 回傳的單頁結果，不再立刻重查完整佇列。只有 Apply
  回傳 `Status = Published` 且 `Review Needed = FALSE` 時，UI 才依目前 queue
  順序自動選取下一筆待檢核地點，走到尾端時循環尋找；若沒有下一筆則留在原頁並
  顯示完成提示。這只是切換選取頁，不會自動執行 resolver、Review 或 Apply。
  `Reject Candidate`、`Need Research`、`Inactive`、失敗或未完成狀態都留在原頁。
- 提供手動重新整理、最後同步時間與 60 秒 idle refresh；有未送出的人工證據或任何 preview ticket 時不自動刷新。Server 重啟造成 session 失效時，前端重新 bootstrap 一次後重試原 request。
- 介面已移除固定最小寬度；中等寬度提早把 evidence 欄折到下方，760px 以下改成單欄、可收合佇列與可換行動作列。
- Resolver、人工決定、Candidate recovery 與 Apply 都使用跨 process page lock；正式 mutation helper 另在 PATCH 前核對實際 data source、預期 data source、獨立 write key 與 formal-write authorization。
- 正式逐筆遷移可從 legacy `Verified`／`Needs Review`／`Verifying` 產生 review／apply preview，但只有硬鎖正式 data source 時才允許這些 legacy source status；PoC 與其他來源仍拒絕。`Keep Current`／`Accept Candidate` 完成後轉為 `Published`，不會先批次改 Status 或偽造驗證日期。

### 14.1 已退役的獨立座標修正工具（歷史紀錄）

當 Google Maps／Candidate URL 與目前 Place ID 都指向同一地點，但正式
`Lat`／`Lng` 有誤時，不應為了修座標而改 Place ID，也不應讓一般 Apply
偷偷承擔座標更新。localhost UI 因此提供 Candidate 區塊內的獨立座標修正入口：

- 維護者輸入新 `Lat`、新 `Lng`、可追溯來源 URL，並確認來源可保存且不是
  Places API 回傳資料。
- 只有 `Review Needed = TRUE`、Candidate 三欄與 `Review Decision` 都空白，
  且 `Apply Metadata` 不在 pending 時才可執行。已有 Candidate 必須先使用
  Candidate recovery；已有人工決定則不能繞過既有流程直接改座標。
- Preview 精確列出 `Lat`／`Lng` 的舊值與新值、位移距離及來源處理。來源已存在
  時 patch 只有 `Lat`／`Lng`；來源尚未存在時才明示追加 `Source URLs`。
- 這個動作不修改 `Google Place ID`、`Google Maps URL`、`Status`、
  `Review Needed`、Candidate／Review 欄位、`Coordinates Approx` 或發布狀態。
  一般 Review／Apply 流程也仍然不寫 `Lat`／`Lng`。
- 正式佇列模式會為本次精確欄位建立或沿用 exact-value approval contract；
  approval plan 納入短效一次性 ticket signature。單頁
  `--allow-formal-write` 模式不開放座標修正，避免繞過 approval workflow。
- Confirm 保留獨立 confirmation modal，並沿用 fresh read、資料漂移檢查、
  跨 process page lock、response-loss recovery 與寫後回讀。Apply 的
  confirmation modal 移除決策不適用於這個獨立正式欄位 mutation。
- 修正成功後只更新本頁資料並提示重新執行 legacy resolver；不會自動產生或保存
  Candidate，也不會自動 Review／Apply。

2026-07-19 正式唯讀實跑：

- 以正式 `KAEW BOUTIQUE`（page `475c23158ea282dfbf3d019ead10ba0d`）啟動單頁模式。
- Legacy resolver 回傳 `place_id_candidate`，來源為 `existing_place_id`，Place ID 與目前值相同；候選地址位於 One Bangkok Entrance 3，與目前正式座標相距約 2,367 公尺，因此標示 `high`，只作人工判斷提示。
- 畫面上的 Candidate／Review／Apply confirm 均保持 disabled；本輪沒有啟用任何正式 write stage。
- Resolver 後以獨立 Notion connector 回讀：`Candidate Summary`、`Candidate Maps URL`、`Candidate Payload`、`Review Decision`、`Verification Note` 與 `Apply Metadata` 仍為空白，`Review Needed = TRUE`、`Status = Verified` 保持不變。
- 維護者其後確認 KAEW BOUTIQUE 指的是 One Bangkok／The Storeys B1；這解決了分店身份，但沒有把 Places 座標變成可直接保存的正式值。
- 工具已加入 `coordinateReviewRequired` gate 並用同一頁再次 live dry-run：
  Summary 預期為 `[Candidate Ready] [Coordinate Correction Required]`，
  畫面顯示安全阻擋；核心也拒絕 `Accept Candidate`／`Keep Current`。
- 可追溯的代表點候選為 OpenStreetMap `way 608350816` 所代表的 One Bangkok
  商業區中心（約 `13.72709, 100.54728`）；這不是室內店面精確點，若採用只能標
  `Coordinate Type = Representative`，並保留 One Bangkok 官方位置頁與 OSM
  attribution。正式欄位仍需精確值核准與 formal change approval，不能由本次
  dry-run 自動寫入。
- 這項結果證明正式單頁讀取、Legacy Places 預覽、寫入封鎖與高距離 fail-closed
  gate 有效；本輪依然沒有正式 Notion mutation。

2026-07-20 維護者另行核准 KAEW 的四欄正式座標修正：

- 固定 plan hash：
  `sha256:f00933b6e29e482fda56f154a2921250d04d4a92a2573458ba371388d7a749df`。
- `Lat = 13.72709`、`Lng = 100.54728`、
  `Coordinates Approx = FALSE`，並在 Source URLs 追加 One Bangkok 官方位置頁與
  OpenStreetMap way 608350816。
- 寫入期間持有同頁 lock；Notion 回讀確認只變更四個核准欄位，Status、
  Review Needed、Candidate、Review 與 Apply 均未變。
- Formal approval manifest 已新增四筆 exact-value chain；`validate --all` 的
  approval contract 與 formal drift 均通過，未核准 formal difference 為 0。
- 修正後 legacy resolver dry-run 的同一候選距離降為 127m／medium，
  `coordinateReviewRequired = false`；本次 dry-run 沒有保存 Candidate。
- 這次座標授權不包含 Candidate、`Coordinate Type`、Verification Note、
  Review、Apply 或 Status。下一步仍從獨立 Candidate stage authorization 開始。

下列需求仍可作為未來擴充判斷：

- 需要在同一畫面並排查看兩張互動地圖。
- 需要鍵盤快捷鍵。
- 需要每天或每週連續檢核大量資料。
- Notion 頁面切換與欄位操作明顯拖慢工作。
- 需要批次接受低風險資料。

本機 UI 不得成為另一份資料庫；現行資料流只能：

```text
讀取 Notion
→ 顯示與協助判斷
→ 維護者在 Notion 手動修改與完成檢核
```

Notion 仍是唯一 system of record。

---

## 15. 建議實作順序

### 已完成的程式基線

- Notion 已是 system of record，正式環境使用 committed 15-column snapshot。
- Parser 支援六種 Status，空白與未知值 fail-closed 為 `Draft`。
- 前端目前只讓 `Verified`、`Needs Review` 在 UI 呈現。
- 前台 UI 已移除狀態 badge、狀態篩選器、新增與協作驗證介面。
- `Duplicate Group`／runtime `dup` 已移除，Notion 只保留內部 `Branch Group`。
- 目前全專案 212 項測試、typecheck 與 production build 已通過。

### Phase 0A：立即處理現有導航風險

這一段不等待新工具或 Google Places 保存條款：

1. 現有 41 筆報告只用於人工風險排序，不自動接受候選。
2. 優先人工查看其中目前仍為 `Verified` 的 27 筆，先處理 >500m、疑似錯分店與可能造成錯誤導航的項目。
3. 若人工快速檢查後已有可信的錯誤導航風險，先用 legacy `Verifying` 停止在 UI 呈現；完成四狀態遷移後對應為 `Paused`。
4. 同時檢查目前 16 筆 `Needs Review` 是否真的達到最低導航安全門檻；不符合者先改為 `Draft` 或 legacy `Verifying`。
5. 無法由舊報告判斷者維持原狀並排入正式檢核，不因距離本身自動下架。

### Phase 0B：完成外部條款與執行前提

1. 已依 2026-07-19 官方 policy 將 PoC 鎖定為 place-id-only persistence；在沒有帳戶契約另行書面允許前，不保存其他 Places content。
2. review expiry 暫定 30 天；它只限制人工決策的新鮮度，不代表可 cache Places content。到期清除 Candidate Place ID／Maps URL，保留 metadata-only envelope。
3. 四狀態目標模型已確認：`Draft` / `Published` / `Paused` / `Inactive`；`Review Needed` 只負責檢核佇列。
4. 確認 MVP 只保存一個明顯領先的候選；多候選使用 `ambiguous`，不能直接採用。
5. MVP 執行位置已確認為本機，且只讀寫 Notion `Locations (PoC)`。
6. 建立只分享給 `Locations (PoC)` 的 Notion test integration；將已確認的 PoC data source ID 放入本機環境設定但不提交 Git，不授予正式 Locations data source 權限。
7. Phase A 的 durable job／冪等與恢復紀錄已確認直接保存在各 `Locations (PoC)` page 的隱藏 `Apply Metadata`；以本機跨 process page lock 將同頁 action 序列化，並以 fail-closed 的 inspect／明確確認 clear 處理 stale lock；仍不把這個 lock 視為 Phase B 的分散式協調方案。
8. `Verification Note` 採 `[timestamp] decision=... actionRunId=... reviewRunId=... note=...` 的 append-only 單行格式；PoC 回復基線使用 `docs/location-verification-poc-baseline-20260719.json`，正式資料日後變動的非破壞同步規則仍待確認。

Database Button webhook 不再是 Phase 0 或本機 PoC 的前置條件。PoC 與正式資料庫都不得寫入 Places 詳細資料。Phase A 期間正式資料庫不得新增 Candidate 欄位或改動資料；Phase C 的正式 schema／page 變更則必須依獨立授權點、allowlist 與回讀對帳執行。

### Phase A：建立本機／Locations (PoC) 流程

1. 使用已建立的 `Locations (PoC)` 作為測試資料庫；它在 Phase A 寫入前是正式 Locations data source 的完整 98 筆、17 欄零差異副本，不再建立 10 筆抽樣 fixture，也不得成為網站正式快照來源。
2. 建立只能存取 `Locations (PoC)` 的 integration。本機 runner 必須核對 allowlisted data source ID；預設 dry-run，只有明確確認寫入時才可更新 PoC。
3. 在任何 schema 或資料修改前，保存 98 筆 Slug 與 17 個正式欄位的 baseline；後續每個階段都重新比對，區分預期變更與非預期資料破壞。
4. 先在程式中建立 legacy／目標 Status 相容 parser、migration／target validator mode、canonical revisions 與 apply 核心測試，但此階段不部署正式資料 schema 變更。
5. 修正 resolver，不再直接採用 `places[0]`；ranking evidence 只存在本機記憶體，加入 `ambiguous`，不記錄 Places content、距離或 match score。
6. 使 `Candidate Payload` 使用 schemaVersion 2 的 place-id-only discriminated union，包含 `reviewRunId`、`revisionSchemaVersion`、basis／workflow revision 與 review expiry；在 `Locations (PoC)` 建立全部必要欄位、`Apply Metadata`、隱藏 Payload／拒絕紀錄與頁面 layout，不建立 `Candidate Distance (m)`。
7. 依 8.4 的 PoC rehearsal mapping 將全部 98 筆遷移至四個目標 Status，初始化 `Review Needed`，但不批次填入 `Last Verified`、`Verification Note`、`Place ID Checked At` 或 `Coordinate Type`。
8. 建立待檢核、需要研究、已完成、過期／失敗等 derived views；保留原始 `Default view` 作為完整資料與 schema 核對入口。
9. 建立包含 `Deactivate` 的 `Review Decision`；不建立 Button，由本機 apply 指令明確指定 page ID，並呼叫共用 apply 核心。
10. 本機 resolver 與 apply worker 只能更新 `Locations (PoC)`。每次實際寫入前輸出預期 patch；apply 先寫入 `Apply Metadata.state = pending`，完成後重新讀取頁面驗證正式欄位、run ID 與 `completed`。
11. 以低風險 canary 實際跑一輪：建立新的 review run、寫入 place-id-only 候選、由維護者在 Google Maps 判斷、選擇 Review Decision，再由本機 apply；沒有明確人工決定時不得代替維護者選擇 Accept／Keep Current。
12. 可對全部 98 筆執行 resolver queue、狀態遷移與 validator 測試；不得把「PoC 可全面修改」解讀為允許自動接受候選或批次偽造驗證日期。
13. 擴充 UI eligibility validator，加入 Payload schema、place-id-only persistence、candidate lifecycle、Place ID refresh 與共址 exception invariants。
14. 完成下列代表性案例、冪等重試、崩潰恢復、data source ID 阻擋、全量資料完整性與 dry-run／實際 patch 一致性測試。
15. 執行 `validate --all`；三層必須同時通過才可完成 Phase A。正式層只可使用獨立 read-only integration，驗證器不得包含 Notion write 或自動修正路徑。

Phase A／B 必測案例：

| 案例 | 預期 |
|---|---|
| 初始 PoC baseline | 98 筆、98 個唯一 Slug、17 個正式欄位與正式 `Locations` 零差異 |
| 指定非 allowlist data source ID | 在任何 Notion write 前 fail-closed |
| 本機 dry-run | 顯示預期 patch，但不更新 Notion |
| Resolver 寫入 Candidate 欄位 | 正式 Lat/Lng、Place ID、Status 與其他 17 個 baseline 欄位不變；Payload／Summary／log 不含 Places content |
| 已知正確店面 | 可接受 Candidate Place ID；Lat/Lng 不從 Places response 自動寫入 |
| `by` false match | 不得再次寫入錯誤 Place ID |
| 同名不同分店 | 進入人工研究，不自動採用第一筆 |
| Khao Yai 大型區域 | 支援 `Representative` / `Entrance`，距離大不等於錯誤 |
| 無搜尋結果 | 新資料維持 `Draft`；既有安全位置可保留 `Published` |
| 重複 Place ID | 預設阻擋；`Branch Group` 不構成豁免，只有 code-reviewed 共址例外可通過 |
| 過期候選 | Apply worker 拒絕套用 |
| basis revision 改變 | Apply worker 拒絕套用並要求重跑 resolver |
| Status／頁面生命週期改變 | workflow revision 不同，拒絕舊決定 |
| 被拒絕候選 | 下一次 resolver 不得再次推薦 |
| Published 定期複查 | `Review Needed = TRUE` 時仍保留最後已知安全的 UI 資料 |
| Resolver error／無候選但人工證據充分 | 仍可 `Keep Current` |
| Google 有候選但人工確認地點不存在 | 可 `Could Not Find`，並要求備註 |
| 多個接近候選 | `ambiguous`，不得直接 Accept |
| 本機 apply 重複執行 | 同一 `reviewRunId` 只套用一次 |
| `Apply Metadata = pending` 後 runner 中斷 | 以相同 run ID 恢復，不建立第二個 action |
| 最終 page update 成功但回應遺失 | 重新讀取 `completed` 與 run ID，回報成功且不重複套用 |
| 同機不同 process 對同頁並行 apply | page lock 只允許一個 runner 進入 Notion read/write；另一個 fail-closed |
| active、remote 或 malformed page lock | operator inspect 可辨識；clear 拒絕並保留原 lock |
| same-host owner PID 已不存在的 stale lock | 只有明確 `lock clear --confirm` 可清除；maintenance guard 阻擋同時的新 apply |
| inspect 後 lock token 被另一 process 替換 | clear 拒絕，且不得刪除替換後的 lock |
| Apply button 快速重複點擊 | webhook 階段同一 `reviewRunId` 只套用一次 |
| 成功後 webhook 重送 | 先回傳已保存的成功結果，不因 Payload 已清除而誤報失敗 |
| Notion 已更新但外部 store 尚未完成 | webhook 階段以 run ID 對帳並補記完成，不重複破壞資料 |
| `Inactive` 使用舊 apply 請求 | 不得重新變成 `Published` |
| `Deactivate` 且 Place ID 正確 | 轉為 `Inactive` 並清除 queue，但不加入 `Rejected Place IDs` |
| 缺少 baseline 欄位的 legacy row | 不得直接改成 `Published`，也不得自動產生驗證日期 |
| revision 的 Unicode／空值／座標格式不同 | canonical 化後產生相同 revision；真正內容變更則不同 |
| 12 個月排程 | 只排入 `Published` 並寫入原因，`Inactive` 不受影響 |
| 人工取消 Review Needed 但仍有 Payload | UI eligibility validator 阻擋 |
| 四種目標 Status 與未知值 | 只有 `Published` 在 UI 呈現；未知值 fail-closed 並由 validator 報錯 |
| 全量 PoC schema／狀態測試完成 | 仍保留全部 98 個 Slug；所有正式欄位差異都能對應到已記錄的人工決定 |
| 完整 `/api/locations` response | 可包含不在 UI 呈現的列，但前端不得渲染；snapshot 不得含秘密或私人內容 |

Phase A 的完成門檻是：所有本機案例通過、98 個 Slug 全部保留、每個正式欄位差異都有可追溯的 action、沒有任何 `Locations (PoC)` 以外的 write、重試與 crash recovery 結果可重現，且維護者確認本機操作流程可接受。2026-07-19 技術 evidence audit 與維護者簽核均已通過，Phase A 已完成；Button webhook 仍須另行開始 Phase B 才能建立。

#### 2026-07-19 首筆 canary 執行紀錄

- Canary：`the-siam-hotel`
- Review Decision：`Keep Current`
- Coordinate Type：`Exact`
- reviewRunId：`review-1d35e94f-2e1c-4352-b804-ebe49171f703`
- actionRunId：`action-7a6cbf32-bcca-4062-861c-38e20e536954`
- 最終結果：`Status = Published`、`Review Needed = FALSE`、`Apply Metadata.state = completed`
- Candidate Summary、Maps URL、Payload 與 Review Decision 已清除；正式 Lat/Lng、Place ID 與既有 Maps URL 保持不變。
- `Last Verified` 與 `Place ID Checked At` 已寫入實際確認時間；`Verification Note` 保留人工理由與兩個 run IDs。
- 這只證明單筆 happy path、allowlist、place-id-only payload 與 `pending → completed` 可運作，不代表 Phase A 全部失敗／重試／crash recovery 案例已完成。

#### 2026-07-19 local runner apply confirm 執行紀錄

- Canary：`han-wang-miao`
- Review Decision：`Keep Current`
- Coordinate Type：`Exact`
- reviewRunId：`review-1f3ae462-b875-4db9-b685-ccf791a0eff3`
- actionRunId：`action-fad3de42-8537-4502-b52a-7b28c668a33a`
- local runner 實際完成 `pending → completed`；最終為 `Status = Published`、`Review Needed = FALSE`。
- Candidate Summary、Maps URL、Payload 與 Review Decision 已清除；正式 Lat/Lng、Place ID 與既有 Maps URL 保持不變。
- `Last Verified` 與 `Place ID Checked At` 已寫入；Notion Date property 正規化到分鐘，完整秒與毫秒保留在 Apply Metadata 與 Verification Note。
- 同一 `--confirm` 重送會讀取既有 completed action 並以零寫入回傳成功，不建立第二個 action。
- runner 自動化測試涵蓋 pending resume、最終 response loss、最終失敗保留 pending 與 completed replay；其他決策與同頁並行案例仍須完成。

#### 2026-07-19 多決策真實 canary 執行紀錄

- Tribe Sky Beach Club：`Keep Current` + `Representative`，`actionRunId = action-5e6df0d7-1bb5-4548-8566-b4383530f281`，最終 `Published`。
- SkyRise Adventures：`Keep Current` + `Exact`，`actionRunId = action-28fe9f8c-16b9-41d8-82f6-1746a2a61c04`，最終 `Published`。
- ข้ามันบ้านนอก by บ้านนอกคอกนาเขาใหญ่：resolver 為 `ambiguous`，維護者決定 `Could Not Find`，`actionRunId = action-205abbd0-e6c0-4ee1-8df2-76ef3829b6ae`，最終 `Inactive`。
- Yoru Omakase：維護者依永久停業證據決定 `Deactivate`，`actionRunId = action-07772f4c-ad38-49a3-abf5-fb202521af89`，最終 `Inactive`。
- 四筆均由 legacy Places resolver 寫入 place-id-only Candidate，通過 apply dry-run 後才 confirm；最終 `Apply Metadata.state = completed`、`Review Needed = FALSE`，Candidate 與 Review Decision 已清除。
- 這輪證明 `Keep Current`、`Could Not Find` 與 `Deactivate` 的真實 Notion 流程。

#### 2026-07-19 Reject Candidate 與 Need Research 真實 canary

- CLI 當時增加 `resolve --dry-run --places-api legacy`，初版允許 `auto`／`legacy` 且 write 固定 legacy；2026-07-19 後續操作政策已改為 dry-run／write 全部固定 legacy，CLI 不再接受 `auto`。
- 先從 92 筆 `Paused` queue 以 legacy dry-run 篩選高風險子集；Places 詳情只在當次 terminal 顯示，沒有 Candidate write。
- 維護者確認 Bang Di Kai Hat Yai 為 `Reject Candidate`；`reviewRunId = review-7fa782f4-8604-4767-a4ff-025d52209fe2`、`actionRunId = action-e29ce8d4-fc0a-4533-a44c-500d79b11793`。
- Bang Di 最終保持 `Paused`、`Review Needed = TRUE`，錯誤候選 Place ID 已加入 `Rejected Place IDs`，Candidate／Review Decision 已清除，正式欄位未變。
- 維護者確認 Yua Cafe & Dining 為 `Need Research`；`reviewRunId = review-6b4c72b1-095d-4446-afc9-ea3bc1a55586`、`actionRunId = action-d4e21689-032b-47fc-a49d-771599f9b29b`。
- Yua 最終保持 `Paused`、`Review Needed = TRUE`，Candidate 與 `Review Decision = Need Research` 刻意保留，正式欄位未變。
- 兩筆均先通過 apply dry-run 再 confirm；最終 `Apply Metadata.state = completed`、completed／formal patch 對帳通過。
- 至此 `Reject Candidate`、`Need Research`、`Could Not Find`、`Deactivate` 四種剩餘決策均已完成真實 PoC canary；工具沒有代替維護者作出人工決定。

### Phase B：在 Locations (PoC) 加入 Notion Button webhook

1. 只有 Phase A 達到完成門檻後才開始。
2. 確認 Notion 方案支援 Database Button webhook，並只在 `Locations (PoC)` 加入唯一的 `Apply Decision`。
3. 用測試 endpoint 實測 page ID、候選流程的 `reviewRunId`、`Deactivate` 的 action identity、custom header、payload、timeout、重複點擊與 automation pause 行為。
4. Webhook endpoint 只負責驗證、在外部 durable store 建立 job 與快速回覆；實際套用仍呼叫 Phase A 的共用 apply 核心，不複製決策邏輯。Notion `Apply Metadata` 保留為 audit mirror。
5. 選定支援原子 claim 的外部 durable queue／store，完成 secret header、快速 2xx／非同步處理、冪等儲存與同頁序列化；不得假設 Notion page 本身是分散式鎖。
6. 若 Button payload 無法可靠提供必要識別資料，驗證「按鈕寫入 `Apply Requested At`，由 connection webhook 或短輪詢 worker 處理」的 fallback。
7. 對同一批測試頁面比較本機入口與 webhook 入口的預期 patch、成功結果、驗證失敗及 crash recovery，結果必須一致。
8. Phase B 全程不得授予 endpoint 正式 Locations data source 的寫入權限。

Phase B 的完成門檻是：Button webhook 與本機入口具有相同驗證及結果，重送與延遲事件不會重複套用，失敗不會讓 Notion automation 停擺。通過後仍需另行核准才能接觸正式資料庫。

### Phase C0：localhost read-only production rehearsal

Phase C0 可以在 Phase B 暫緩期間執行，因為它不建立 webhook、不持有正式寫入憑證，也不修改正式 schema／page。它不是 Phase C production rollout 核准。

1. 使用正式庫專用 read-only integration 重新盤點當下 schema、筆數與 Slug；不得假設 Phase A 的 98 筆仍是現況。
2. 從正式庫建立獨立 rehearsal clone，記錄 database／data source／view ID，逐筆比較全部 17 個正式欄位。
3. 保留 Phase A immutable baseline，不以覆寫舊檔方式吸收正常新增資料；另建 versioned rehearsal／cutover artifact。
4. `production-preflight` 只接受正式 page ID／URL，硬鎖正式 data source，預覽 legacy Status 的保守初始化與缺少的 target workflow 欄位。
5. Phase C0 當時的 CLI 不提供 production write mode，也不讀取 `NOTION_FORMAL_WRITE_API_KEY`；resolver／apply write helpers 在該階段繼續只允許 `Locations (PoC)`。
6. 以至少一筆正式 page 實跑 read-only preflight，並確認 schema 未就緒時回報 `BLOCKED` 和非零 exit code。
7. 重跑 `validate --all`，確認任何 Phase A baseline 之後新增／刪除的 Slug 都 fail-closed；不得自動修正。
8. 正式 schema、狀態或資料的任何 mutation 都留在 Phase C，必須再次取得明確核准。

2026-07-19 已完成上述 read-only gate，並進一步在 rehearsal 完成 11 欄 additive schema、legacy＋target Status options、99 筆 `Review Needed` 初始化、Migration Audit view，以及 32Bar X 單頁 canary／rollback。初始化後 TRUE 98、FALSE 1、mapping mismatch 0；rollback 後 17 個正式欄位相對正式庫仍為 0 差異。

Rehearsal 的 rollback 定義為「資料值回復＋legacy-compatible app 回切」，不是破壞性刪除新增 schema。只有等 legacy Status 數量歸零、target parser／validator 已部署且 rollback window 結束後，才可評估移除 legacy options。

網站 parser／UI eligibility／snapshot validator 的遷移期雙模型相容已完成；99 筆 versioned cutover baseline 亦已建立並以 live read-only 資料二次驗證。Artifact 為 [`location-verification-formal-cutover-baseline-20260719.json`](location-verification-formal-cutover-baseline-20260719.json)，內容 hash `sha256:f6d3a8ec7fef47f61b25d68229eefd3554bd9cc6f75f4b61776ef80a5afe2e3f`。它明確吸收新增 `khlong-bang-luang-floating-market` 與既有 Dear December 核准差異，移除 Slug 0、未核准欄位差異 0。

2026-07-20 已將這份 cutover artifact 正式接入 `validate --all` 的唯讀契約：

- PoC membership 仍嚴格使用 Phase A immutable 98-Slug baseline，不吸收正式新增
  地點。
- Formal membership 使用與 immutable baseline hash 相連、content hash 可重算的
  99-Slug cutover baseline；其中唯一新增 Slug 為
  `khlong-bang-luang-floating-market`。
- 正式原 98 筆仍以 immutable baseline 加 append-only exact-value approval chain
  對帳；cutover 新增頁則以 artifact 保存的 17 個正式欄位精確對帳。
- cutover hash、previous baseline hash、欄位集合、rowCount、transition
  additions、任何移除或重複 Slug 任一不符都 fail-closed。未列入 cutover 的第
  100 筆仍回報 `FORMAL_SLUG_UNEXPECTED`。
- live 結果為 immutable PoC baseline 98、formal cutover baseline 99、PoC 98、
  formal 99；六個 layer 全部 PASS、issues 0、Notion write 0。

cutover 新增頁後續若有正式欄位變更，不得把核准混入綁定 Phase A 98 筆的
manifest。獨立
[`location-verification-formal-cutover-change-approvals.json`](location-verification-formal-cutover-change-approvals.json)
必須綁定 cutover baseline ID 與 content hash，而且只接受
`transition.addedSlugs` 的 exact-value chain。Validator 先分別驗證 immutable 與
cutover approval contract，兩者均通過後才合併計算核准差異；錯誤 hash／ID、
未知 Slug 或試圖用 cutover contract 核准原 98 筆都 fail-closed。

2026-07-20 Khlong 的 `Status: Draft → Published` 已依上述 contract 個別核准並
完成 Candidate、Review、Apply 三段正式流程。獨立 Notion 回讀後，
`validate --all` 顯示 immutable approvals 6、cutover approvals 1、observed
formal changes 7、approved changes 7、unapproved differences 0，六層全部 PASS
且 issues 0。機器可讀執行紀錄為
[`location-verification-formal-apply-khlong-20260720.json`](location-verification-formal-apply-khlong-20260720.json)。

Phase C0 技術 gate 至此完成，但本身不授權操作正式 schema 或資料。維護者其後於 2026-07-19 明確開通正式 write access 並同意繼續，該次授權被限縮解讀為「正式 schema mutation」，不包含第一筆正式 page write。

### Phase C：受控導入正式資料並完成逐筆狀態遷移

1. 取得明確的 production rollout 核准後，先以已建立的 99 筆 versioned cutover baseline 作為輸入，執行前再用 read-only capture 驗證 content hash；另建立獨立、最小權限的 production write integration，不得沿用 test integration token 或 formal read token。
2. 先部署支援 legacy／目標 Status 的 parser、前端與 validators 相容版本，確認 rollback 方式。
3. 先在 `Locations (Production Rehearsal)` 演練建立 11 個 workflow 欄位與四個 Status options、保守初始化、回滾及重複執行；通過後另經 schema mutation 核准，才可在正式資料庫執行相同步驟。初始化範圍以 cutover baseline 的實際筆數為準，不硬編碼 98 或 99，且不批次改 Status。
4. 先用 read-only `production-preflight` 對極少量正式 canary 頁面人工比對預期 patch；取得單頁 write 核准後，才可使用範圍受限的 production page write 路徑。
5. Resolver 直接讀取 Notion，以 `Review Needed = TRUE` 作為主要佇列；優先使用現有 Place ID，必要時才文字搜尋，排除 `Rejected Place IDs`。
6. Resolver 只寫回有 review expiry 且帶 `reviewRunId` 的 place-id-only Candidate Payload、workflow-only Summary 與 Maps URL，不直接更新正式地點欄位，也不保存 Distance。
7. Production apply worker 使用已在 Phase A 驗證的共用核心，檢查 Review Decision、期限、revision、Status transition、冪等鍵與重複 Place ID。Phase B 暫緩期間只允許 localhost 單一維護者操作與跨 process page lock；日後啟用 Button webhook 時，webhook 與實際 apply 必須分離，外部 durable store 才是 job／並行控制的權威來源，Notion `Apply Metadata` 只保留 audit mirror。
8. 延續 Phase 0A 的 containment 結果，只用現有報告建立 queue；逐筆重新取得候選並完成 41 筆人工檢核，再對其餘 legacy 資料完成 baseline 人工確認。
9. 每筆填入真實的 `Last Verified`、`Verification Note`、需要的位置語意，以及當次確實 refresh 才能填入的 `Place ID Checked At`。
10. 每筆通過 target validator 後才轉為 `Published`、`Paused` 或 `Inactive`；不得批次偽造日期或先改 Status 再補資料。
11. Legacy Status 歸零後，匯出並部署純四狀態 snapshot；確認 UI 呈現數量，再移除 parser／validator 相容模式。
12. 建立排程：清除到期 Candidate content、保留 metadata-only envelope；只對 `Published` 且 `Place ID Checked At` 超過 12 個月的資料設定 `Review Needed = TRUE`，同步附加 scheduled refresh 原因。`Inactive` 排除，`Draft`／`Paused` 已在 queue 不重複處理。
13. 加入失敗、過期、排程、成本與 production audit 紀錄。

#### 正式 localhost 自助佇列

正式 rollout 的日常操作使用獨立的 `--formal-workflow` 模式；啟動指令簡化為
`npm run location:verify:formal-ui`。它一次讀取 allowlisted formal data source
的完整佇列，但不是批次 worker，也不提供「全部套用」：

1. Candidate、Review、Apply 各自保留 preview、短效一次性 ticket、fresh read、
   signature check 與同頁跨 process lock；後段必須等待前段狀態成立。Candidate
   與 Review 保留確認對話框；Apply 由已通過 dry-run 後的紅色發布按鈕直接送出。
   Review confirm 成功後可自動發出 read-only Apply preview，省略一次手動點擊，
   但不會自動發布。
2. 正式 read／write credentials 繼續分離；queue／preview 使用 read credential，
   confirm mutation 才讀取 write credential。
3. 舊的 `--page`＋單一 `--allow-formal-write` 模式保留給 canary／診斷；
   `--formal-workflow` 不能和兩者混用，避免授權語意模糊。
4. 第三段 Apply preview 必須同時產生 exact-value approval plan。原 98 個 Slug
   只可寫入 immutable manifest；cutover `addedSlugs` 只可寫入綁定 cutover
   ID／hash 的 manifest。未知 Slug、broken chain、unapproved current value 或
   manifest drift 一律阻擋。
5. approval plan 納入 Apply ticket signature；confirm 在 page lock 內、Notion
   pending write 前，以獨立 global lock 重新驗證並 atomic append。相同 approval
   的重試採 exact-content recovery，不產生重複紀錄。
6. 啟動 workflow 只表示開放本機操作入口；每一次 mutation 都需要該頁、該階段
   的明確 UI action 與有效 preview ticket。工具不自動選候選，也不自動判斷
   同一地點。只有
   已確認完成 Apply、server 回傳 `Published` 且 `Review Needed = FALSE` 後，
   UI 才自動切換到下一筆待檢核頁；這個導覽行為不構成下一頁任何階段的授權。

2026-07-20 已以正式 read-only 資料完成實際走查：UI 載入 99 筆、當下待檢核 96
筆，選取單頁後順序 gate 正確；UI 內六項全量驗證全部 PASS，沒有送出 resolver
preview 或任何 confirm，因此正式 Notion 與 approval manifests 均零寫入。全專案
250/250 tests、typecheck 與 production build 通過。

Phase C0 rehearsal schema／rollback／單頁 canary、網站遷移期 parser／UI eligibility／snapshot gate 與可重現 cutover baseline 已通過。正式 write credential 與 read-only credential 已分離，schema command 只有明確 `--confirm` 才讀取 write credential；schema mutation 與第一筆 page write 仍是兩個獨立授權點。Phase B webhook 可以繼續暫緩，但不得因此把 localhost lock 誤當成分散式鎖。

2026-07-19 正式 schema mutation 已完成：

- 新增與 Production Rehearsal 相同的 11 個 workflow properties；正式 schema 由 17 欄增為 28 欄。
- `Status` 保留六個 legacy options，只追加 `Published`、`Paused`、`Inactive`。
- 變更使用單一 data source schema PATCH；沒有呼叫 page update endpoint，也沒有初始化任何 page value。
- 變更前後均以 99 筆 cutover baseline 對帳；17 個正式欄位 content hash 維持 `sha256:f6d3a8ec7fef47f61b25d68229eefd3554bd9cc6f75f4b61776ef80a5afe2e3f`。
- API readback、獨立 Notion connector readback與重跑 idempotent dry-run 均通過。
- Rollback 維持非破壞策略：app 已支援雙狀態模型，因此事故時回切 app 行為，不在 legacy Status 尚存時 DROP workflow 欄位或移除 options。
- Khlong Bang Luang Floating Market 的 read-only preflight 已由 `BLOCKED` 轉為 `READY`；在 schema migration 階段尚未寫入，之後才依單頁獨立核准完成 canary。
- 機器可讀紀錄：[`location-verification-formal-schema-migration-20260719.json`](location-verification-formal-schema-migration-20260719.json)。

第一筆正式 page write 其後已獲獨立核准並完成：

- Canary 固定為 Khlong Bang Luang Floating Market，page ID `3a2c23158ea281e7ae8bf62dd3244d26`。
- 寫前為 `Status = Draft`、`Review Needed = FALSE`，其餘 workflow 欄位空白。
- 唯一 page PATCH 為 `Review Needed = TRUE`；沒有寫入 Status 或其他正式／workflow 欄位。
- 使用 formal data source allowlist、固定 canary page allowlist、跨 process lock、寫前重讀、response-loss recovery 與寫後回讀。
- API 與 connector 回讀均通過；99 筆 cutover hash 前後一致。
- 重跑 confirm 為 `confirm-noop`，沒有第二次 PATCH。
- 機器可讀紀錄：[`location-verification-formal-page-canary-20260719.json`](location-verification-formal-page-canary-20260719.json)。

這次授權不擴張到批次初始化、Candidate、人工決定或 apply。下一個獨立控制點是剩餘 98 頁的保守 `Review Needed` 初始化。

批次初始化前的 read-only preview 已完成：

- `location:formal-queue-preview` 只接受 `--dry-run --output <local-json>`；沒有 `--confirm`，也不讀取正式 write credential。
- 命令重新讀取正式 99 筆，核對 allowlisted data source、唯一 Slug、cutover content hash、legacy Status mapping 與空白 workflow 欄位。
- 完整 99 筆結果為 97 個 `Review Needed: FALSE → TRUE` patch、2 個 no-op、0 個 FALSE patch；兩個 no-op 是已完成 canary 的 Khlong 與維持 `Could Not Find` 的 Yoru Omakase。
- 對尚未處理的 98 頁而言，是 97 個 TRUE patch、1 個 FALSE no-op。
- Artifact 明確記錄 `bulkFormalInitializationApproved=false`、`bulkConfirmRouteImplemented=false`、`notionWritePerformed=false`。
- 機器可讀預覽：[`location-verification-formal-review-queue-preview-20260719.json`](location-verification-formal-review-queue-preview-20260719.json)。

受限 confirm route 其後已實作並重新 live dry-run：

- 新命令 `location:formal-queue` 將 99 筆目標綁定為 target plan SHA-256；hash 包含 data source、cutover hash、page identity、Status、17 欄正式 snapshot hash 與預期 Review Needed。
- Confirm 必須同時命中 approval ID、target plan hash 與 97-write ceiling；只允許 `Review Needed = TRUE`，不接受 FALSE 或其他欄位。
- 每頁取得跨 process lock，寫前重新讀取、寫後回讀；晚到 workflow／正式欄位 drift 立即停止。Response loss 可由精確回讀恢復，部分成功後同一 target plan 可冪等重跑。
- 最終必須重新對帳 99 筆 cutover hash、target plan hash、剩餘 patch 0 與 no-op 99。
- Preview JSON 不作為 executable input；每次執行都從 live Notion 重建計畫。
- Live target plan：`sha256:ed588b6f5cbaa5a021d9cf5c7c7b3e9f19bf88ccda5862394df8ff1a409c0910`；仍是 97 個 TRUE patch、2 個 no-op、0 個 FALSE patch。
- CLI 在任何 Notion 操作前先 exclusive-create 本機 audit 路徑，confirm 中逐頁更新 checkpoint；失敗 artifact 將寫入 `liveNotionStateMustBeRechecked`，不把未知的部分成功狀態誤報為零寫入。
- 機器可讀 execution preview：[`location-verification-formal-review-queue-execution-preview-20260719.json`](location-verification-formal-review-queue-execution-preview-20260719.json)。

Route 實作與 dry-run 完成後，維護者另行明確核准相同 target plan 的 97 筆正式寫入。批次 confirm 結果：

- 97 個 TRUE-only PATCH 全部寫入並逐筆回讀成功；response loss、已套用跳過與失敗均為 0。
- 最終 99 筆全部為 no-op；Review Needed TRUE 98、FALSE 1，mapping mismatch 0。
- Cutover content hash 與 target plan hash 前後一致，證明 17 個正式欄位與目標集合未改變。
- 同 plan confirm 重跑為 no-op，寫入嘗試與寫入數都是 0。
- 獨立 Notion connector 回讀同樣得到 99 筆、TRUE 98、FALSE 1、mapping mismatch 0、其他 workflow 占用 0。
- Result：[`location-verification-formal-review-queue-confirm-result-20260719.json`](location-verification-formal-review-queue-confirm-result-20260719.json)；no-op rerun：[`location-verification-formal-review-queue-confirm-noop-20260719.json`](location-verification-formal-review-queue-confirm-noop-20260719.json)。

這項核准只完成 queue 初始化，不代表 98 筆地點已通過事實驗證，也不授權批次
填入日期／備註、批次改 Status、自動接受 Candidate，或跳過三段順序、preview
ticket 與明確 mutation action。後續回到逐筆 resolver、人工判斷與 apply 流程。

### Phase D：強化 UI 呈現規則與 snapshot gate

1. Legacy Status 歸零後，鎖定前端只有 `Published` 在 UI 呈現，並將 raw status enum 與 regression tests 收斂為四種目標值。
2. Exporter 維持完整資料快照，不預先篩掉 `Draft`／`Paused`／`Inactive`。
3. 遷移期 snapshot validator 已完成；再補齊直接讀 Notion workflow 欄位的 production UI eligibility validator。
4. 加入 UI 呈現資格、Approx、Place ID、完整 Slug、Review Needed invariant、共址 exception manifest 與重複資料測試。
5. 遷移期 UI allowlist 與 legacy favorites 測試已完成；純四狀態切換時再移除 legacy 相容案例。
6. 已以 versioned policy、受保護 Slug 與 deletion manifest 取代網站 snapshot validator 的固定 98 筆判斷。

### Phase E：本機 operator UI

1. 已建立只綁定 `127.0.0.1` 的獨立 Node server 與不進入公開 build 的靜態 UI。
2. 已讀取完整 98 筆佇列，提供待檢核／Candidate／全部篩選與來源脈絡。
3. 已保留 Candidate、人工決定與 Apply 三段獨立 preview／confirm。
4. 已加入同源 local session、短效一次性 preview ticket、no-store／CSP headers、PoC allowlist 與既有 runner 安全檢查。
5. 已以真實 PoC 讀取走查 KAEW BOUTIQUE resolver dry-run、Yua Cafe & Dining 已完成 action 狀態，以及 UI 內三層全量驗證；所有寫入對話框都在最終確認前取消。
6. 已加入 Candidate recovery 的獨立 preview／confirm、Verification Note 歷史／新證據拆分、decision-aware inline validation 與完整 Apply effect preview。
7. 已加入單頁 merge、手動／idle refresh、session recovery、最後同步時間，以及 Apply 後由維護者明確點擊的下一筆導引。
8. 已補強 ticket expiry／replay／stage binding、signature drift、foreign Origin、oversized body 與 rich-text chunking 測試；ambiguous 候選的每張 Google Maps link 都綁定自己的 Place ID。
9. 中等寬度 evidence 已折行；760px 以下使用單欄、佇列收合與無固定 body min-width。1280px 真實瀏覽器量測為 `scrollWidth = innerWidth`。
10. 這一階段不啟動 Notion Button webhook、不加入 durable queue，也不改變 Phase B 暫緩決定。

---

## 16. 已確認、建議與待決事項

### 已確認

- Notion 是主要資料來源與策展工作台。
- 網站讀取經驗證的固定快照，不在 runtime 查詢 Notion。
- 維護者負責最終正確性。
- Places resolver 只能產生候選，不能自動設為 `Published`。
- 技術格式正確不等於地點事實正確。
- Snapshot 使用 15 欄契約，保留所有非封存資料列與 Slug。
- Live Notion schema 在遷移期保留六種 legacy Status，並已追加 `Published`／`Paused`／`Inactive`，合計九種 options；沒有 `Duplicate Of` 或 `Duplicate Group`。
- 目標 Status 已確認精簡為 `Draft` / `Published` / `Paused` / `Inactive`。
- 目前前端在遷移期只讓 legacy `Verified` / `Needs Review` 與 target `Published` 在 UI 呈現；完成遷移後只讓 `Published` 呈現，未知值皆 fail-closed。
- 「不在 UI 呈現」不是保密邊界；目前完整 snapshot 仍可從 `/api/locations` 讀取。
- 前台 UI 不顯示審核狀態，因此新資料使用 `Draft`，已知高風險資料使用 `Paused`。
- `Status` 與 `Review Needed` 分開；前者控制 UI 呈現與資料生命週期，後者只控制檢核佇列。
- 正式 Locations 的 Legacy Status 採逐筆遷移；只有補齊真實人工驗證資料並通過 target validator 的頁面才改成 `Published`，不得用 migration time 偽造驗證日期。
- `Locations (PoC)` 已核准全量技術遷移，但採保守 mapping：未由新流程確認的 legacy `Verified`／`Needs Review` 先轉為 `Paused`，不批次背書為 `Published`。
- Phase A 的 98 筆 baseline 是 immutable 歷史稽核資料；正式庫目前為 99 筆，新的 versioned cutover baseline 已建立並通過 live read-only 重現驗證。
- `Locations (Production Rehearsal)` 是獨立 99 筆複本，與正式庫的 17 個正式欄位逐筆比對為 0 差異；它可承受 Phase C0 schema／rollback 演練，但不能視為正式寫入授權。
- `production-preflight` 與 queue preview 只讀正式庫且沒有 write mode；`NOTION_FORMAL_WRITE_API_KEY` 已獨立設定，但只有已核准的 schema／page write command 可讀取，read-only commands 不會讀取。
- MVP 只保存一個明顯領先的候選；多候選使用 `ambiguous`，不得直接採用。
- Candidate Payload 使用 schemaVersion 2 的 place-id-only discriminated union，並保存 `revisionSchemaVersion` 及 canonical basis／workflow revision。
- 除 Place ID 外，Places API 回傳的名稱、地址、Lat/Lng、營業狀態、距離、排名與 match score 不寫入 Notion、log、檔案、Git 或 snapshot。
- 現有 41 筆報告只作為 queue seed 與 canary 選擇依據，不能補成含 Places 詳細資料的 Payload。
- 現有報告中的 27 筆 legacy `Verified` 必須在新工具完成前先做人工風險 triage。
- Notion 人工介面採精簡欄位，不把每個 resolver metadata 拆成 property。
- 檢核佇列使用單一 `Review Needed` Checkbox，不建立多值 `Review State`。
- Phase A MVP resolver／apply worker 由本機執行且只可更新 `Locations (PoC)`；
  Phase C 的正式單頁與完整佇列模式都只在 localhost 執行。測試 integration
  不得取得正式權限，正式 read／write integration 必須分離；每個 write stage
  仍由該頁的獨立 UI preview／confirm 授權。
- `Locations (PoC)` 已建立為獨立 database／data source，包含正式 `Locations` 的完整 98 筆副本；98 個 Slug、17 個正式欄位與 Status 分布皆已實測一致。
- PoC 可使用並修改全部 98 筆資料，不再限制 10 筆抽樣；這項授權不延伸到正式 `Locations`。
- PoC 寫入前基線已保存於 `docs/location-verification-poc-baseline-20260719.json`，包含 98 筆 page URL、Slug 與 17 個正式欄位。
- `Locations (PoC)` 已有 28 個 properties、四種目標 Status 與五個 views；The Siam Hotel、漢王廟、Tribe Sky Beach Club、SkyRise Adventures、ข้ามันบ้านนอก by บ้านนอกคอกนาเขาใหญ่、Yoru Omakase、Bang Di Kai Hat Yai、Yua Cafe & Dining 八筆真實 canary 已完成。
- Phase A 將最近一次 action 的冪等與恢復狀態保存於各 page 的隱藏 `Apply Metadata`；本機跨 process page lock 已實作並由另一個 Node process 實測，同頁 action 會在任何 Notion read/write 前序列化。stale-lock operator 已完成 active／stale／malformed／token replacement 測試；KAEW BOUTIQUE 實際 inspect 為 `absent`，因此未執行 clear。
- Accept／Reject 的 apply-time duplicate query、Inactive 重放、已拒絕候選、ambiguous、expired、basis／workflow revision、非 allowlist 與四種其餘決策已完成自動化測試；`Reject Candidate`、`Need Research`、`Could Not Find` 與 `Deactivate` 也已完成真實 PoC canary。
- `validate --all` 與三層 validators 已實作並實際讀取 PoC／正式各 98 筆；`dear-december-cafe / Notes EN` 的刻意正式修改已透過精確值 append-only manifest 核准，所有 contract／layer PASS，未核准正式差異為 0。
- Phase A 技術 evidence audit 已通過；必測案例、PoC write containment、place-id-only persistence 與 artifacts 掃描均有記錄。維護者已於 2026-07-19 簽核 resolver、apply 與 stale-lock operator 流程；Phase A 已完成，Phase B 已決定暫緩。
- 維護者決定暫緩 Phase B，先以 Phase A 本機流程逐筆驗證；resolver CLI 固定 legacy Places API。32Bar X 已以 `Keep Current`／`Exact` 完成 apply，最終為 `Published`；completed action 可追溯且全量 validation PASS。
- Phase A 已新增 localhost-only operator UI：完整 98 筆佇列、三段獨立確認、Candidate recovery、短效 preview ticket、完整 Apply effects 與 UI 內 read-only 全量資料對帳；它只操作 `Locations (PoC)`，不取代 Notion，也不屬於 Phase B webhook。
- 本機流程穩定後才在 `Locations (PoC)` 加入唯一的 `Apply Decision` Button webhook；兩種入口共用同一套 apply 核心。
- Phase B 啟用 Button webhook 前必須選定支援原子 claim 的外部 durable store；`Apply Metadata` 屆時只作為 Notion 內的 audit mirror。
- 人工決定與生命週期動作共用一個 `Review Decision` 下拉選單；`Deactivate` 不會拒絕仍正確的 Place ID。
- 正式資料庫 rollout 需要本機與 webhook 測試通過後另行核准，不是 MVP 自動延伸。
- `Branch Group` 不構成重複 Place ID 豁免；共址例外必須逐組 code review。

### 目前建議

- 採 Notion-first 加薄的 localhost operator UI；Notion 維持唯一 system of record，UI 不保存第二份地點資料。
- 先建立本機 resolver，只在 Notion `Locations (PoC)` 寫入有 review expiry 的 place-id-only Candidate Payload 與 workflow-only 摘要。
- 在改動 PoC 前保存完整 98 筆 baseline；每次 resolver／apply 或狀態遷移後核對 Slug 集合與正式欄位差異。
- `reviewRunId`、revision schema、Candidate Place ID 與兩種 revision 放在隱藏 Payload；Places 詳情只在當次本機互動顯示，人工頁面以 Google Maps URL 查看來源。
- 使用一個版本化的隱藏 `Apply Metadata` JSON 保存最近一次 action 的 `pending`／`completed`／`failed`、run ID、revision 與時間；完整歷史留在 `Verification Note`。
- 使用 `Review Needed` Checkbox 建立待檢核視圖；過期與失敗原因顯示在 Candidate Summary。
- 本機 PoC 使用一個 Review Decision 下拉選單與本機 apply 指令；穩定後才加入一個 Apply Decision 按鈕。
- 本機與 webhook 入口共用具備 canonical basis／workflow revision、狀態轉移檢查、durable job reconciliation、冪等與重放保護的 apply worker。
- 以 allowlisted data source ID、獨立 test integration、預設 dry-run、明確寫入確認與跨 process page lock 保護測試階段。
- Accept 時由已驗證 Place ID 建立 canonical Google Maps URL，不信任可編輯的 Candidate Maps URL。
- 只有 Accept／Reject 必須依賴有效候選；Keep Current／Need Research／Could Not Find 保留人工證據優先權，`Deactivate` 則完全不依賴候選。
- PoC 先建立流程欄位，再以保守 mapping 全量遷移 Status；只有實際完成決策的頁面才補 `Coordinate Type`、`Verification Note`、`Last Verified`、`Place ID Checked At` 並成為 `Published`。
- 保存 `Rejected Place IDs`，避免重複錯配。
- 以排程清除到期 Candidate Place ID／Maps URL；只有 `Published` 的 Place ID 超過 12 個月時自動進入複查，並同步寫入 scheduled refresh 原因。

### 待決事項

- 目前帳戶是否有允許超出官方預設 caching restrictions 的書面契約；在確認前維持 place-id-only persistence。
- 30 天 review expiry 的排程執行方式；Google Maps 歸屬標示已列為本機互動介面的必要條件。
- 是否新增 Notion 原生 `Place` property 作為人工 Map View。
- 本機流程穩定後，Button webhook endpoint 的託管位置：
  - GitHub Actions。
  - Netlify Function。
- Database Button webhook 的實際 payload 是否能可靠提供 page ID、候選流程的 `reviewRunId` 與 `Deactivate` action identity；若不能，採 connection webhook 或短輪詢 fallback。
- Notion 方案是否支援 Database Button webhook，以及 secret header、外部 durable queue 與冪等儲存位置。
- 正式 `Locations` 日後新增或更新資料時，如何在不覆蓋 PoC 測試紀錄的前提下同步。
- `Verification Note` append-only 紀錄的長期清理方式。
- 除 Place ID 12 個月 refresh 外，其他地點重新驗證週期，例如 6 個月或 12 個月。

---

## 17. 外部參考

- Notion Map View：<https://www.notion.com/help/maps>
- Notion Database Buttons：<https://www.notion.com/help/database-buttons>
- Notion Webhook Actions：<https://www.notion.com/help/webhook-actions>
- Notion Webhook Event Delivery：<https://developers.notion.com/reference/webhooks-events-delivery>
- Notion Page Update API：<https://developers.notion.com/reference/patch-page>
- Notion Place Property API：<https://developers.notion.com/reference/property-object#place>
- Google Places API Policies：<https://developers.google.com/maps/documentation/places/web-service/policies>
- Google Place ID 保存與更新：<https://developers.google.com/maps/documentation/places/web-service/place-id>
