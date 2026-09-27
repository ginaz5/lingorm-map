# SuperRich 綠標／橘標分支拆分計劃

日期：2026-09-20。狀態：規劃完成，尚未執行分支與程式碼拆分。

## 目標與已確認範圍

使用者已確認：`codex/rates` 只顯示綠標換匯點，橘標資料保留在 Notion 與新分支。

| 分支 | 拆分後內容 |
| --- | --- |
| `codex/rates` | 原有地圖功能與 SuperRich Thailand 綠標功能；保留最新的綠標前三名排序 |
| `codex/rates-superrich1965`（建議名稱） | 以清理後的 `codex/rates` 為基礎，保留完整 SuperRich 1965 橘標功能，供後續獨立開發與合併 |

新分支仍會包含綠標基礎功能；相對 `codex/rates` 的新增差異應集中在橘標。這次採向前新增變更，不重寫已推送的歷史，因此舊橘標實作仍可從 Git 歷史查到。

本計劃不變更 Notion 發布狀態、既有 Slug、Netlify 線上設定或本機排程。橘標功能保留下來，不代表重新發布橘標分店。

## 已核對的現況

- 工作分支為 `codex/rates`，HEAD 為 `c1589d9`；本機保存的 `origin/codex/rates` 指向相同 commit。本次未 fetch，因此實作開始前仍須確認遠端是否更新。
- 盤點開始時工作目錄乾淨。
- 最新 `data/locations.csv` 有 219 筆資料：26 間綠標均為 `Published`，38 間橘標均為 `Paused`。這是已提交快照的狀態，未即時查詢 Notion。
- 橘標不是只有獨立檔案，也接入綠標 feature、共用 state、卡片、排序、Google／HERE marker 與 cluster。
- `48703d8` 同時包含橘標 reconciliation 與通用 UTC 日期調整；`5af9a1c` 是後續綠標前三名功能；`c1589d9` 除橘標狀態外，還把 `baiwago-plus-cafe-kmc` 改為 `Paused`。這些通用或非橘標更新都要保留。
- `bea0836` 可作為橘標加入前的實作參考，不能直接整批還原共用檔案，否則會丟失後續更新。

## 1. 保存基準與安排分支

1. 實作開始前重新檢查工作目錄、目前分支與遠端差異，保留新增的未提交工作。
2. 在拆分前 HEAD 建立備份分支，例如 `codex/rates-before-superrich1965-split`。先確認名稱未被使用，不覆寫既有分支。
3. 在 `codex/rates` 完成以下清理，通過驗證後形成可審閱的綠標變更。
4. 在清理後的綠標 commit 建立 `codex/rates-superrich1965`，依備份與拆分差異加回橘標，形成獨立的橘標新增 commit。可使用另一個 worktree 分別驗證兩個版本。

預期提交關係如下；實際 commit／push 另依使用者授權執行：

```text
A：拆分前完整版本 ── B：綠標版本 ── C：加回橘標功能
↑                    ↑               ↑
備份分支             codex/rates     codex/rates-superrich1965
```

這樣日後 `codex/rates...codex/rates-superrich1965` 會有實際的橘標新增差異。若只把新分支留在 A，再讓 `rates` 往 B 前進，新分支會是 `rates` 的祖先，之後直接 merge 不會把已刪除的橘標功能加回來。

## 2. 從 rates 移出橘標專用檔案

以下檔案保存在備份與橘標分支，從綠標分支移除：

| 範圍 | 檔案 |
| --- | --- |
| 前端資料解析、輪詢與狀態管理 | `src/data/exchange-rates-1965.js`、`src/features/exchange-rates-1965.js` |
| 後端 API 與排程 | `netlify/functions/exchange-rates-1965.mjs`、`netlify/functions/exchange-rates-1965-fetch.mjs` |
| 後端內部模組 | `netlify/functions/_shared/exchange-rates-1965-*.mjs`：contract、source、runner、storage、breaker、control |
| 管理與資料工具 | `scripts/exchange-rates-1965-control.mjs`、`scripts/exchange-rates-1965-fetch.mjs`、`scripts/superrich1965-branch-reconcile.mjs`、`scripts/validate-superrich1965-mapping.mjs` |
| 品牌對照 | `data/superrich1965-branches.json` |
| 專用測試與 fixtures | `tests/exchange-rates-1965-*.test.mjs`、`tests/superrich1965-*.test.mjs`、`tests/fixtures/superrich1965/` |
| 橘標規格與查證資料 | `docs/superrich1965-*.md`、`docs/evidence/superrich1965-*.json` |

移除前檢查所有 import、文件連結、測試與 build 引用，不以檔名刪除作為完成條件。

## 3. 清理共用檔案，保留綠標後續改進

| 檔案／範圍 | 處理方式 |
| --- | --- |
| `src/features/exchange-rates.js` | 移除橘標 mapping、denom、輪詢串接與品牌分派；只接受 `default`、`USD_100`、`USD_50`、`TWD`；控制項只依綠標可用狀態更新 |
| `src/main.js` | 移除 `initExchangeRates1965` 與僅供它使用的引用，保留綠標排序事件和 popup 更新 |
| `src/core/state.js` | 移除 `exchange1965` 狀態與橘標排序型別，保留綠標欄位 |
| `src/ui/render.js` | 移除橘標查價、時間、官網連結、badge 與排序分派；保留綠標前三名、UTC 日期與一般地點功能 |
| `src/map/map.js` | Google、HERE 同步改回僅綠標換匯 marker／cluster；一般地點混合 cluster 維持既有中性色 |
| `src/core/i18n.js`、`index.html`、`styles.css` | 同步移除中英文橘標文字、排序選項與橘標樣式，保留綠標前三名相關內容 |
| `src/app/app-coordinator.js` | 保留綠標排序時切換清單、捲回頂部的最新行為 |
| 共用測試 | 調整 `exchange-rates-ui`、`i18n-ui`、`view-first-ui`、`styles-extraction`、`typecheck-config` 等測試，保留綠標與通用行為覆蓋 |

不整批 revert 橘標時期的 commits；以功能範圍拆除，避免把通用修正一併撤回。

## 4. 地點資料與顯示規則

採用「保留正式快照、限制目前版本支援的換匯點」的方式，維持 Notion 單一資料來源與既有完整匯出流程。

- Notion 的 38 筆橘標資料及 Slug 保留。`data/locations.csv` 仍可包含這些正式匯出的資料列；這是資料保留，不是橘標功能依賴。橘標分支也保留相同資料，沿用目前 `Paused` 狀態。
- 綠標版本顯示地點時，除要求 `Published`，對 `Category=Currency Exchange` 再要求其 Slug 存在於綠標 mapping。判斷寫成通用的「此版本支援的換匯地點」，不加入橘標 Slug 黑名單。
- 套用同一個可顯示判斷到清單、搜尋、收藏結果、類別／主題／目的地選項與計數、Google／HERE marker、選取與 popup 流程，避免各入口行為不一致。
- 加入回歸案例：即使後續完整匯出的快照含有 `Published` 的未支援換匯點，`rates` 仍不顯示它；綠標和一般地點不受影響。
- 不清除 localStorage 中既有橘標收藏 ID。它們在綠標版本中不顯示，未來使用橘標版本時仍可對應原有 Slug。
- 保留正式 Notion schema、完整快照名單與對應資料測試。`tests/notion-export-full.test.mjs` 中的橘標 Slug 屬於正式資料基準，不能隨功能測試一起移除。
- 此方案不需要為拆分手改 CSV、回滾 `c1589d9`，或修改 Notion 狀態。若實作期間要更新快照，仍使用既有 exporter，再執行資料驗證。

驗收時區分「執行中的橘標程式碼」與「正式資料列」：`rates` 可以保留正式快照裡的橘標名稱，不能保留橘標 API、collector、UI 或其功能依賴。

## 5. 建置設定與文件

- `package.json`：移除 `fx:1965:control`、`fx:1965:fetch`，保留 `fx:control`。
- `jsconfig.json` 與對應測試：移除橘標專用 include，確認共用 glob 在檔案移除後仍正確。
- `build.sh`：移除橘標 mapping 驗證步驟，保留 schema／snapshot、綠標 mapping 與收藏相容性驗證。
- `netlify.toml`：移除橘標 included file 與專用設定說明；保留綠標 Functions。
- `.env.example`：移除橘標環境變數，更新「兩個品牌」的敘述。
- `.gitignore`：即使 collector 移出，仍保留 `.local-state/` 忽略規則並改成通用註解，避免既有本機狀態意外被提交。
- README、`note/TECH_DECISIONS.md`、`note/LOCAL_TESTING.md`：綠標分支只保留目前可用的操作步驟；橘標分支保留橘標維運文件。檢查移出文件的連結。
- 綠標也使用 `@netlify/blobs`，因此保留該相依套件；目前沒有因這次拆分必須移除的橘標專用 npm dependency。

Git 分支不隔離 Netlify site-wide Blobs 或外部本機排程。執行本計劃時不呼叫管理 CLI 的 enable／disable／publish；日後部署前另確認目標環境及既有 collector 狀態。

## 6. 建立可延續開發的橘標分支

在綠標版本通過驗證後，以它為基礎加回第 2、3、5 節中橘標所需的差異。保留第 4 節的通用顯示規則，但將「支援的換匯點」擴充為綠標與橘標兩份 mapping。

- 還原橘標來源解析、38 店 mapping、API、排程、本機 collector、管理 CLI、UI、測試與文件。
- 綠標前三名及通用修正保持與 `rates` 一致。
- 兩品牌仍使用獨立的 state、輪詢、快照、control 與 breaker。
- 以 fixtures 驗證橘標 `Published` 場景，不為測試更動 Notion 或正式 CSV 發布狀態。
- 審閱兩分支的差異，確認包含橘標功能新增，且沒有撤回綠標改進、一般地點更新或正式 schema。

## 7. 驗證與完成條件

先跑受影響的集中測試，再於兩個分支各執行：

```bash
npm run typecheck
npm test
npm run build
node scripts/validate-location-snapshot.mjs data/locations.csv
node scripts/validate-favorite-compatibility.mjs
node scripts/validate-superrich-mapping.mjs data/superrich-branches.json data/locations.csv
git diff --check
```

橘標分支另執行：

```bash
node scripts/validate-superrich1965-mapping.mjs data/superrich1965-branches.json data/locations.csv
```

在 `netlify dev` 驗收以下行為：

| 驗收面向 | `codex/rates` 預期 |
| --- | --- |
| 換匯點 | 僅綠標；依目前資料基準，未限制目的地或搜尋時有 26 間 |
| 排序 | 一般排序與三種綠標面額；前三名呈現、手機切換清單正常 |
| 網路 | 瀏覽器只輪詢 `/api/exchange-rates`，不請求橘標 API；橘標 Functions 不在此版本中 |
| 來源故障 | 綠標停用、逾時、快照到期及恢復後，報價與排序符合既有行為 |
| 地圖 | Google 與 HERE 的綠標 marker、cluster、popup 均正常 |
| 地點篩選 | 換匯開關、搜尋、收藏、目的地及計數不漏出未支援的換匯點 |
| 既有功能 | 雙語、一般地點、收藏、綠標前三名與 UTC 日期顯示沒有退步 |

橘標分支另驗證兩品牌故障隔離、橘標卡片與官網連結、各自面額、cluster 顏色，以及本機 collector 的既有離線測試。不得為拆分驗證自動發布匯率快照。

完成時應交付：兩個通過檢查的分支、可回復的拆分前備份、變更與驗證摘要。若之後獲授權推送或合併，先確認遠端更新，再依專案規則進行 Deploy Preview 驗收；本計劃階段不觸發部署。

## 本次規劃交付

已檢查 Git 狀態與歷史、三份專案文件、橘標專用檔案、共用依賴、CSV 狀態與匯出流程。本次只新增此計劃文件，未建立分支、修改 runtime、執行 commit／push 或變更外部資料。

未跑 typecheck、測試與 build：本次沒有程式碼變更；上述命令是後續實作驗收要求，不代表已通過。
