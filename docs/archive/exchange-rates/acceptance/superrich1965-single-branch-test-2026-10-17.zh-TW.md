# 橘標單店發布與完整本機驗證

> 歷史文件，於 2026-10-24 封存。保留當時的設計、操作與驗收結果；其中的部署狀態、待辦與指令不代表現行流程。維護請從[現行文件索引](../../../README.md)開始。


> 本文是 2026-10-17 的歷史驗收，保留當時環境變數、時間及結果。
> 2026-10-20 已退役 Netlify 抓價入口與來源模式開關，現行行為見
> [Netlify 只讀快取與外部抓取](../plans/superrich1965-on-demand-plan.zh-TW.md)。

日期：2026-10-17。依使用者要求，將一間橘標分店改為 Published 並完整測試。

## 正式資料變更

- 分店：[SuperRich 1965 — Silom Plaza](https://app.notion.com/p/3d7c23158ea281978384cf4504796bcc)。
- 固定身份：`superrich1965-56`、`officialId=56`、`company_code=A04`、`branch_no=00`。
- Notion 正式 data source `e55c2315-8ea2-837d-9637-07c1118486c8`：
  只將 Status 從 Paused 改成 Published，回讀確認成功。
- 名稱、座標、Slug、Review Needed=false 與原驗證紀錄均未改動。
- 執行 `npm run locations:refresh`，由 exporter 匯出並通過驗證後更新快照。
  Git diff 只有 Silom Plaza 一列的 Verification Status 變動。
- 快照仍為 236 筆，公開數 173→174；橘標 1 Published／37 Paused，綠標 26 Published。

## 真實來源與實際頁面

使用 `netlify dev --offline --no-open --port 8888`，只對該程序設定
`EXCHANGE_RATES_1965_ENABLED=true` 與 `EXCHANGE_RATES_1965_FETCH_MODE=on-demand`。
CLI 明確顯示 Blobs sandbox；控制／快取在本機 `deploy:0:exchange-rates-1965`
store，未讀寫正式 production control。`--offline` 讓 CLI 不抓線上環境設定，
不會阻止 Function 已授權的來源請求。

在實際首頁搜尋 SuperRich 1965，只顯示 1／174 個地點。從真實卡片按鈕查詢：

- HTTP 200，Function 約 1,468ms；單次來源 POST，只查 branch 00，未 retry。
- 查詢開始：2026-10-17 07:45:40.586 UTC（台北 15:45:40）。
- 完成：07:45:41.910 UTC；到期：07:50:40.586 UTC。
- USD：`1 USD = 33.33 THB`；TWD：`1 TWD = 1.020 THB`。
- 列表與實際 HERE popup 同步顯示報價、查詢時間、正確官網連結。
- 選橘標 USD 排序後只標示已取得有效報價的分店為最佳；綠標無報價時不可選。
- 獨立 HTTP 請求命中同一快取，attemptedAt／completedAt／expiresAt 均未改變。
- 實際 390px／320px 手機版無水平溢出；HERE 單店橘色 marker 與手機 popup 已核對。
- 中文／英文切換正常，已還原中文；Google Maps browser key 未設定，因此 Google
  SDK 人工驗收未執行，兩 provider 的 popup／到期／群聚回歸測試則通過。
- 截圖工具無法擷取畫面，以上瀏覽器驗證依 DOM 與可及性狀態記錄。

自然等滿 5 分鐘後，列表與 HERE popup 的數字、查詢時間與最佳標示均撤下，
排序隱藏、查詢按鈕重新開放，期間沒有自動來源請求。

首次重新查詢回 busy（202），查明為 Netlify Dev 的既有 blob 可能不回 ETag：
原本的 onlyIfNew fallback 無法更新既有 lease。已在橘標 storage 增加
NETLIFY_DEV 專用序列化寫入與資料重讀比較；正式 runtime 仍要求 ETag CAS，
沒有 ETag 時不允許覆寫。新增 2 個缺少 ETag／並行刷新／過期 writer 回歸測試。

修正後從實際手機 popup 手動更新再次成功，HTTP 200、約 3,943ms。
新 attemptedAt=07:52:46.442 UTC、completedAt=07:52:50.203 UTC、
expiresAt=07:57:46.442 UTC；報價仍為 USD 33.33、TWD 1.020，查詢時間更新為
台北 15:52，卡片與 popup 同步恢復。兩次成功查詢各只有一次來源 POST。
詳見 [JSON 證據](../../../evidence/superrich1965-single-branch-test-2026-10-17.json)。

## 自動與資料驗證

| 指令／項目 | 結果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | 621 pass／0 fail |
| `npm run build` | PASS |
| `netlify functions:build --src netlify/functions` | PASS |
| `validate-location-snapshot.mjs` | PASS，236 筆、174 公開 |
| `validate-favorite-compatibility.mjs` | PASS，98 個歷史 ID 保留 |
| 綠標／橘標 mapping validators | PASS，26 綠標公開、1 橘標公開／37 未公開 |
| 實際 POST API 的 GET／未知 Slug／跨站 Origin | 正確回 405／400／400，無報價 |
| `git diff --check` | PASS |
| `location:verify -- validate --all` | **FAIL：38 個既有資料工作流問題，詳下** |

完整 Notion 唯讀核對：schema 20／20 PASS；快照與正式資料 236／236 完全一致，
0 changed Slugs、0 changed fields。Live invariants 有 38 個 queue/status mismatch：
37 家仍 Paused 的橘標與 `baiwago-plus-cafe-kmc` 都是 Review Needed=false。
另有 38 個橘標空白 Type 警告（舊 Category 表示，前端已有正規化）。
這些不是快照遺漏或單店匯率錯誤；本次未改其他 37 家的狀態或 review 標記，
也未為了讓全庫檢核變綠而改無關咖啡店。

## 執行邊界

Notion 的發布狀態與本機 CSV 已更新；沒有 commit、push 或部署。
沒有改正式站環境變數、服務控制旗標或排程。實測證明本機出口目前可取得
該店報價，不代表 Netlify 雲端出口已通過來源封鎖或長期穩定性驗收。
