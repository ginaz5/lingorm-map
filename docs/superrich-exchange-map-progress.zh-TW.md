# SuperRich 換匯地圖進度紀錄

> - 專案：Lingorm Bangkok Map
> - 建立日期：2026-09-09
> - 最後更新：2026-09-09
> - 目前里程碑：M1（Phase A 完成，Phase B 未開始）
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
| M1 | Phase A（來源契約）+ Phase B（分店建檔，`Paused`） | 無 | 進行中 |
| M2 | Phase C（排程、Blobs、breaker、控制旗標；`EXCHANGE_RATES_ENABLED=false`） | 無 | 未開始 |
| M3 | Phase D1a／D1b + 分店轉 `Published` + 啟用服務 | **上線** | 未開始 |
| M4 | Phase D2（群聚著色）+ Phase E（手冊） | 群聚樣式 | 未開始 |

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
- `tests/exchange-rates-source.test.mjs` — 29 項
- `tests/fixtures/superrich/{branch-options,branch-10,branch-28,exchange-28}.json`
- `jsconfig.json` 與 `tests/typecheck-config.test.mjs` 加入新模組

**驗證**

```
node --test tests/exchange-rates-source.test.mjs   # 29 pass
npm run typecheck                                   # pass
npm test                                            # 352 pass / 0 fail
```

**實作期間的決定**（未改變計畫語意，僅補齊細節）

- `buyText` 小數位超過 6 位時採**整數字串四捨五入**而非判為無效：靜默截斷會改變顯示給使用者的匯率，直接作廢又會因來源多一位小數而整站失效。縮放全程用 `BigInt` 字串運算，不經過浮點數。
- `parseBranchOptions` 只回傳官方 ID，不回傳來源 `label`；`parseBranchDetail` 丟棄 `address`。兩者都是來源顯示字串，名稱與地址一律以 Notion 為準。
- **測試抓到一個真 bug**：`Number('')` 為 `0`，空白座標會通過範圍檢查變成 lat 0。已改為嚴格數字字串比對後才轉數值。

**未解問題**

- `BRANCH_CODE_PATTERN` 目前只由分店 28（`M17`）佐證。Phase A 沒有逐店收集 26 個代碼；**在 Phase C 首次全量抓取後必須複查**，若有合法代碼被此樣式擋掉即放寬。

---

## M1 · Phase B — 分店建檔

**狀態：未開始**

| 完成條件（計畫 §6、§9） | 狀態 |
| --- | --- |
| `DESTINATIONS`、`DESTINATION_OPTION_COLORS`、Notion select 三處一致，通過 exporter schema gate | 未開始 |
| 新增 `data/superrich-branches.json` 與 `scripts/validate-superrich-mapping.mjs`（計畫 §9.1） | 未開始 |
| 26 筆依 §9.2 範本建入 Notion，`Verification Status` 先 `Paused` | 未開始 |
| 目的地依 §10 附錄歸屬，四筆「需確認」已人工定案 | 未開始 |
| 快照通過 `validate-location-snapshot.mjs` 與 `validate-favorite-compatibility.mjs` | 未開始 |

**開工前要先做的一件事**：在 Notion 新增 `chonburi`、`si-racha` 兩個 Destination select 選項並選定顏色，再把同樣的顏色字串填進 `DESTINATION_OPTION_COLORS`。三處缺一，`npm run locations:export:notion` 會整個失敗，連不相干的地點更新都匯不出來。

---

## M2 · Phase C — 排程、儲存與控制

**狀態：未開始。** 完成條件見計畫 §6 的 C 列與 §5。`EXCHANGE_RATES_ENABLED` 初次上線設 `false`，本里程碑結束時仍為 `false`。

## M3 · Phase D1a／D1b — 前端

**狀態：未開始。**

- D1a：換匯點開關、綠色標記、卡片（三列固定「暫無報價」）、免責元素、篩選規則。不依賴 M2。
- D1b：接 `/api/exchange-rates`、純函式排程 `nextExchangeAction`、最佳匯率排序。
- 上線動作：分店轉 `Published` → 重新匯出 CSV → 部署 → `npm run fx:control -- enable`。

## M4 · Phase D2／E — 群聚著色與手冊

**狀態：未開始。**
