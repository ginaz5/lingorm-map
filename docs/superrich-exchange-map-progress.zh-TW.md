# SuperRich 換匯地圖進度紀錄

> - 專案：Lingorm Bangkok Map
> - 建立日期：2026-09-09
> - 最後更新：2026-09-09
> - 目前里程碑：M1－M4 程式與文件皆完成；M3 停在 PR Deploy Preview，正式站台發布與啟用時機由使用者決定
> - 規格依據：[SuperRich USD／TWD 換匯地圖實作計畫](superrich-exchange-map-plan.zh-TW.md)

本文件只追蹤執行進度、驗證結果與待辦。資料模型、決策語意與階段設計以計畫文件為準；兩份衝突時先改計畫，再同步這裡。

**維護紀律**（避免變成第二份 2,000 行的進度檔）：

1. 固定形狀，不寫流水帳：每個里程碑只有「完成條件 / 狀態 / 驗證 / 未解問題」。
2. 規格變動往上游走，這裡只記「已依計畫 §X.Y 完成」。
3. 全檔上限 200 行；超過就把已完成里程碑壓成一行結論。

---

## 里程碑總覽

| 里程碑 | 內容 | 使用者可見 | 狀態 |
| --- | --- | --- | --- |
| M1 | Phase A（來源契約）+ Phase B（分店建檔，`Paused`） | 無 | **完成** |
| M2 | Phase C（排程、Blobs、breaker、控制旗標；預設停用） | 無 | **完成** |
| M3 | Phase D1a／D1b + 分店轉 `Published` + 啟用服務 | **上線** | **待 PR Preview 驗收** |
| M4 | Phase D2（群聚著色）+ Phase E（手冊） | 群聚樣式 | **完成** |

M1 與 M2 對使用者零可見變更，可安全停在任一處。M3 中途停會留下半成品 UI，建議 D1a、D1b 各自做完再停。

---

## M1 · Phase A — 來源契約與純資料解析

**狀態：完成（2026-09-09）**

| 完成條件（計畫 §6） | 結果 |
| --- | --- |
| 確認 §2.2 的報價時間欄位 | 已確認來源**沒有**報價發布時間；`data` 只有 `exchange`，根層 `timestamp` 為 API 回應時間。計畫已改為只顯示「本次查詢時間」 |
| 正確區分買入／賣出 | 只讀 `buyText`；有測試驗證 `sellText` 被竄改或刪除都不影響輸出 |
| USD 面額 | 只取 `unit`+`denomRem` 完全相符的 `100`／`50`；`20 - 10`／`5`／`1` 與其他幣別被忽略 |
| 分店身分 | `branchCode` 缺失、格式不符、同店不一致或與預期不符 → 整店 `failed` |
| 缺值 | 逐列 `missing`／`invalid`，狀態分 `ok`／`partial`／`failed` |
| 只輸出列舉與單一倍率整數 | 有測試驗證輸出鍵集合固定，且惡意來源字串不會出現在序列化結果中 |

**產出**

- `src/data/exchange-rates.js` — `RATE_SCALE`（單一全域 1e6）、`SOURCE_DENOMS`、`GOOGLE_MAPS_HOSTS`、`BRANCH_CODE_PATTERN`、`parseRateText`、`normalizeGoogleLink`、`normalizeBranchCode`、`parseBranchOptions`、`parseBranchDetail`、`parseBranchExchange`、`branchQuoteFailure`
- `tests/exchange-rates-source.test.mjs` — 含 26 店完整分店代碼與實際成功 envelope 測試
- `tests/fixtures/superrich/{branch-options,branch-10,branch-28,exchange-28}.json`
- `jsconfig.json` 與 `tests/typecheck-config.test.mjs` 加入新模組

**驗證**

```
node --test tests/exchange-rates-source.test.mjs   # pass
npm run typecheck                                   # pass
npm test                                            # 361 pass / 0 fail
```

**實作期間的決定**（未改變計畫語意，僅補齊細節）

- `buyText` 小數位超過 6 位時採**整數字串四捨五入**而非判為無效：靜默截斷會改變顯示給使用者的匯率，直接作廢又會因來源多一位小數而整站失效。縮放全程用 `BigInt` 字串運算，不經過浮點數。
- `parseBranchOptions` 只回傳官方 ID，不回傳來源 `label`；`parseBranchDetail` 丟棄 `address`。兩者都是來源顯示字串，名稱與地址一律以 Notion 為準。
- **測試抓到一個真 bug**：`Number('')` 為 `0`，空白座標會通過範圍檢查變成 lat 0。已改為嚴格數字字串比對後才轉數值。
- M1 全量讀取又抓到來源契約差異：`/branch-client/{id}` 的分店內容位於成功 envelope 的 `data` 內。解析器與 fixture 已修正，並拒絕 HTTP 成功但業務狀態失敗的資料。

**未解問題：無。** 26／26 店代碼已收齊為 `H01`、`B01`、`M01`–`M24`，目前樣式全數通過；Phase C 仍會在每輪抓取比對來源 ID 與代碼。

---

## M1 · Phase B — 分店建檔

**狀態：完成（2026-09-09）**

| 完成條件（計畫 §6、§9） | 狀態 |
| --- | --- |
| `DESTINATIONS`、`DESTINATION_OPTION_COLORS`、Notion select 三處一致，通過 exporter schema gate | 完成：新增 `chonburi`／`si-racha`；Category 新增 `Currency Exchange`；誤加到 Type 的同名選項已由全量驗證抓出並移除 |
| 新增 `data/superrich-branches.json` 與 `scripts/validate-superrich-mapping.mjs`（計畫 §9.1） | 完成：26 個來源 ID 與分店代碼唯一，並核對快照、類別、目的地、座標及來源 inventory |
| 26 筆依 §9.2 範本建入 Notion，`Verification Status` 先 `Paused` | 完成：26／26 頁面已逐筆讀回，20 個屬性及頁面 icon 與草稿一致 |
| 目的地依 §10 附錄歸屬，四筆「需確認」已人工定案 | 完成：Westgate／Westville／Happitat／機場店依都會區與機場規則歸 `bangkok` |
| 快照通過 `validate-location-snapshot.mjs` 與 `validate-favorite-compatibility.mjs` | 完成：181 筆、181 個唯一 Slug、135 筆公開；98 個既有收藏 ID 全數保留 |

**驗證與查證**

```text
npm run locations:export:notion -- --output data/locations.csv  # 181 rows；schema 20/20
node scripts/validate-superrich-mapping.mjs ...                  # 26 branches；0 Published
node scripts/validate-location-snapshot.mjs data/locations.csv   # 181 valid；135 public
node scripts/validate-favorite-compatibility.mjs                 # 98 protected IDs preserved
npm run typecheck                                                # pass
npm test                                                         # 361 pass / 0 fail
npm run build                                                    # pass
```

逐店資料與來源判定見 [SuperRich 分店建檔查證](superrich-branch-verification.zh-TW.md)。本次匯出也保留了 Notion 同時更新的 `baiwago-plus-cafe-kmc` 與 `somtam-nua` 既有內容。

修正誤加的 Type 選項時，Notion 將原有 16 筆 Paused 頁面移入垃圾桶；已用建檔前頁面 ID 與完整屬性快照逐筆比對、還原。最終唯讀全量驗證為 181／181 筆、0 個變更欄位、0 筆增減；該驗證本身未執行 Notion 寫入。

**發布核對已於 M3 完成**

- `superrich-thailand-34`（Happitat）：官方仍列 Bloominas Building 3 樓；無法確認獨立櫃位 listing，保留官方場館導航連結。
- `superrich-thailand-35`（素萬那普機場）：已確認綠色 SuperRich Thailand 獨立 listing，更新 Place ID 與導航連結。
- 全部 26 店已轉為 `Published`、`Review Needed=false`、`Last Verified=2026-09-09`；正式 exporter 讀回 181 筆、161 筆公開。

---

## M2 · Phase C — 排程、儲存與控制

**狀態：完成（2026-09-09）。** 控制 key 尚未建立且 `EXCHANGE_RATES_ENABLED` 未設定時一律視為 `false`；本里程碑未觸發來源、未寫正式 Blobs，也未部署。

| 完成條件（計畫 §5、§6） | 結果 |
| --- | --- |
| 排程與來源預算 | `0,30 * * * *`；來源截止 25 秒、單次 5 秒、最多 2 個同時請求、全域啟動間隔至少 200ms、全輪至多 1 次額外重試 |
| 快照與 API | 三個獨立 Blob key；固定 API 外層與雙 no-store 標頭；停用、過期、版本不符或啟用前快照均不供應數字 |
| 儲存隔離與競態 | Production 使用站台 store，Preview／本機使用 deploy store；全部強一致讀取；snapshot／breaker／control 使用 ETag 條件寫入，舊輪次不能復活 |
| breaker | 403／429 立即優先並取消同輪；6h → 24h → 自動停用；連續 3 輪全失敗退避 1h；部分成功保留層級並清除連續失敗數 |
| 管理控制 | `npm run fx:control -- status|enable|disable [--reason code]`；每次切換產生新版本，重新啟用保留尚未到期的封鎖期限 |

**主要產出**

- `netlify/functions/exchange-rates-fetch.mjs`、`netlify/functions/exchange-rates.mjs`
- `netlify/functions/_shared/exchange-rates-{contract,storage,source,runner,breaker,control}.mjs`
- `scripts/exchange-rates-control.mjs`
- `tests/exchange-rates-{backend-contract,control-api,source-runner}.test.mjs`
- `@netlify/blobs`、Node.js 22.12+ 執行條件與 Netlify 打包設定

**驗證**

```text
node --test tests/exchange-rates-*.test.mjs                 # pass
npm run typecheck                                           # pass（含 M2 後端與管理指令）
npm test                                                    # 386 pass / 0 fail
npm run build                                               # pass
netlify functions:build --src netlify/functions --functions /private/tmp/...  # 只產生 4 個正式 function；pass
HERE_API_KEY=test-key DATA_SOURCE=notion bash build.sh      # 181 筆、26 分店對照、98 收藏 ID；pass
npm run location:verify -- validate --all                   # schema 20/20、181/181、0 issues；唯讀
npm audit                                                   # 0 vulnerabilities
```

**未解問題：無。** M2 完成時前台沒有可見變更；M3 才發布分店與使用者介面。

## M3 · Phase D1a／D1b — 前端

**狀態：實作完成（2026-09-09）；待 PR Deploy Preview 驗收。正式發布與服務啟用必須在驗收完成後才執行。**

| 完成條件（計畫 §6、§7） | 結果 |
| --- | --- |
| D1a 使用者介面 | 完成：持久化換匯開關、26 個綠色標記、固定三列報價、載入／無資料狀態、免責、官方來源與 Maps 營業時間連結 |
| 篩選語意 | 完成：換匯點略過類別與主題；保留 Published、搜尋、目的地與收藏；選「換匯」只看分店；關閉會清除換匯類別、排序與作用中分店 |
| D1b 匯率與排序 | 完成：嚴格驗證 `/api/exchange-rates`、60 秒輪詢、截止時間與 10／20／40／60 秒重試、同輪次不延長期限、USD 100／USD 50／TWD 最佳匯率排序與同率標示 |
| 雙語與窄螢幕 | 完成：中文／英文完整；320px 實測無水平溢位 |
| 分店發布 | 完成：Notion 26 筆轉 Published，正式 exporter 更新 `data/locations.csv`；Happitat 與機場店發布核對完成 |
| Deploy Preview | 手動預覽 `6aa147bf2146714c7423a20a` 已通過初驗；下一步由 PR 建立正式 Deploy Preview，供完整功能驗收 |
| 正式發布與啟用 | 待使用者驗收通過後執行：合併／正式 deploy → 確認 disabled → 建立／更新 production control → 首輪抓取 → API 與前台數字驗證 |

**驗證**

```text
npm run typecheck                                            # pass
npm test                                                     # 395 pass / 0 fail
npm run build                                                # pass
node scripts/validate-location-snapshot.mjs data/locations.csv # 181 valid；161 public
node scripts/validate-favorite-compatibility.mjs             # 98 protected IDs preserved
node scripts/validate-superrich-mapping.mjs ...              # 26 Published
npm run location:verify -- validate --all                    # schema 20/20；181/181；0 issues
本機實際來源抓取                                             # 26 branches；27 requests；complete
```

**剩餘事項：** 停在 PR Deploy Preview 這一步即可；PR 驗收與正式上線（合併、確認 disabled、建立/更新 production control、首輪抓取、API 與前台數字驗證）由使用者自行決定時機，不由這裡代為執行或代為判斷「可以上線」。

## M4 · Phase D2／E — 群聚著色與手冊

**狀態：完成（2026-09-09）。**

| 完成條件（計畫 §3.3、§6） | 結果 |
| --- | --- |
| D2 群聚著色：Google `clusterRenderer` 解構 `markers` 判斷成分 | 完成：新增 `isExchangeOnlyCluster(markers)`，讀取每個 marker 建立時保留的 `__markerContent` class list；全綠才套用 `.marker-cluster.is-exchange` |
| D2 群聚著色：HERE 改用 `cluster.forEachDataPoint` 檢查 | 完成：新增 `isExchangeOnlyDataPoints(forEachDataPoint)`，走訪葉節點確認每個 `DataPoint.getData().isExchange` 皆為 `true` |
| 混合群聚沿用現有樣式 | 完成：兩個判斷函式在任一成員非換匯點時回傳 `false`，維持預設 `.marker-cluster` 樣式 |
| Phase E：驗證通過、資料來源故障可降級、排程首次啟用、breaker 復原、執行期停用與環境變數差異寫入手冊 | 完成：新增 [note/LOCAL_TESTING.md「換匯功能上線與維運手冊」](../note/LOCAL_TESTING.md#換匯功能上線與維運手冊)；[note/TECH_DECISIONS.md](../note/TECH_DECISIONS.md) 更新過時的 marker 章節並新增排程快照/控制旗標架構決策；README 補充功能說明 |

**產出**

- `src/map/map.js` — `isExchangeOnlyCluster`、`isExchangeOnlyDataPoints`，接入 `clusterRenderer` 與 `makeHereClusterTheme`
- `styles.css` — `.marker-cluster.is-exchange`
- `tests/view-first-ui.test.mjs`、`tests/styles-extraction.test.mjs` 新增對應測試
- `note/LOCAL_TESTING.md`、`note/TECH_DECISIONS.md`、`README.md` 文件更新

**驗證**

```text
npm test          # 398 pass / 0 fail
npm run typecheck # pass
```

`npm run build` 在本次工作環境的 Linux VM 因既有的 `@rollup/rollup-linux-arm64-gnu`（npm optional-dependency 已知問題）無法安裝而略過；未改動 build 設定或依賴版本，非本次程式變更所致。

**未解問題：無。**
