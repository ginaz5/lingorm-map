# SuperRich 1965：Python 單店 Preview 發布

> 歷史文件，於 2026-10-24 封存。保留當時的設計、操作與驗收結果；其中的部署狀態、待辦與指令不代表現行流程。維護請從[現行文件索引](../../../README.md)開始。


更新：2026-10-21。本文件記錄固定單店的發布與頁面驗收；後續五店／38 家驗證見
[多店文件](superrich1965-python-batches.zh-TW.md)。不新增 production target 或排程，
PR #8 保持開啟，正式站維持原發布版本。

## 已完成的來源驗證

[Python probe run 39606619491](https://github.com/ginaz5/lingorm-map/actions/runs/39606619491)
使用 main `b5def89477444d5dd6c66040638452da296f7040`、Python 3.12.3 與 Safari 17 UA，
匿名 token GET／rate POST 都回傳 200，USD 100-50／TWD 1000-100 買入價解析通過。
sourceRequestCount=2、sourceValidated=true、replayed=false、published=0。

該次依使用者明確要求，先備份再以 CAS 提前結束 common／target 的冷卻，保留原 epoch、
controlVersion 與封鎖層級。這是一次性管理操作，不新增 force／reset 入口。測完 guard
已重新 paused、lease 已釋放、unresolvedAttempt=null；quote／snapshot 均未寫入。
單次成功不代表已確認 Cloudflare 先前封鎖的原因，或全部分店與不同 runner 都穩定。

## 單店發布介面

```text
npm run fx:1965:actions -- publish-python --target preview-reviewed
```

新模式固定 `superrich1965-58`（A04／36，Ratchadamri Soi 1），拒絕 `--scope`、
`--slug`、production、任意 URL 或自訂 transport；單店範圍維持不變，Python helper
共用正式 mapping 白名單。
只在可信 main 的 workflow_dispatch 執行，不偽造本機 GitHub 身分。
Workflow 的 action 下拉選單明確選 `publish-python`，不因 inspect／probe 自動發布。

沿用 JS token 驗證、parser、job／operation ledger、guard、lease、control 與 quote CAS，
Python 模式沒有 Node fallback。同 run 重播只回既有結果，不能換模式重新抓取。
成功只寫逐店 quote，不寫完整 snapshot；來源成功與發布成功分開統計。

遇 challenge 先持久化共同保護，再更新 target breaker。摘要的 retryAt 取較晚的共同
冷卻，不能把 target 的 6 小時顯示成共同 guard 的 24 小時；若來源已 paused，回報
paused 並省略自動 retryAt，不能把 null 截止當成已恢復。單店成功仍保留封鎖歷史。

## 發布與驗收順序

1. 完成本機 focused／完整測試、checkJs、Vite／Functions build、workflow YAML／Bash
   檢查與獨立審閱。經獨立 PR、CI 與必要 Preview 驗收進 main，最終 squash 訊息使用
   `[skip netlify]`，核對正式站 published deploy 未變。
2. 只讀 inspect 固定 target／control／common guard，確認無 active lease、未結案來源或
   其他執行中的來源 job。保留已有冷卻與封鎖層級；符合條件後以既有管理工具 resume。
3. 從 main 只啟動一次 `publish-python`。成功需 sourceValidated=true、published=1、
   sourceSucceeded=1、replayed=false；冷 session token／rate 兩階段 200，共 2 個 HTTP。
   cache hit 或歷史 replay 不當成新的來源驗收，失敗不自動重試。
4. 工作結束即 source-pause，保留 target control 原 UUID 啟用。核對 quote 合約、有效期、
   job／operation 完成、source／target lease 釋放與 unresolvedAttempt=null。
5. 讀取固定 Preview 的 cache GET／單店 POST，再驗頁面中英文、列表與 popup、排序、
   Google／HERE 及過期撤價。重讀 API 或頁面不觸發來源，對照已完成 operation 的請求數。

| 固定身分 | 值 |
| --- | --- |
| Target | preview-reviewed |
| Deploy | 6ad779f97644e6fb5b04b05c |
| Preview commit | 74b9013494b94201bd0841ee8090f583c7994288 |
| Control version | b8d0b4cc-2585-43d6-b1b3-9f18193c0041 |
| Source epoch | 4eb55ef8-212f-4bd3-b1b0-ebe760769c26 |

[固定 Preview](https://6ad779f97644e6fb5b04b05c--lingorm-map.netlify.app/) 的讀取入口：

- GET `/api/exchange-rates-1965-cache`：逐店 quote 的主要入口。
- POST `/api/exchange-rates-1965-branch`，JSON `{"slug":"superrich1965-58"}`：只讀相同 quote。
- GET `/api/exchange-rates-1965`：相容舊完整 snapshot，不能用它判斷逐店發布有無成功。

## 頁面與過期驗收

搜尋 `Ratchadamri Soi 1`，核對 USD 100＋50、TWD 1,000–100、擷取時間與目前 API
數字一致，選卡片確認 popup，再切中英文。來源 guard 暫停不影響有效報價的純讀取。
HERE 必須以實際 fallback 或明確的本機 provider 測試驗證，不能把 Google 畫面當成 HERE。

有效期沿用 attemptedAt 之後下一個 UTC 整點／半點＋35 分鐘，不因快取重讀延長。
到期須撤除數字、擷取時間與最佳標示，排序回 default，保留分店及官網連結。
本機以模擬時鐘驗背景、離線、請求中及兩種 map popup 的撤價；遠端現場驗收結果另記，
不把 mock 時鐘測試描述成實際等到 Preview 到期。

```bash
node --test tests/exchange-rates-1965-actions-integration.test.mjs tests/exchange-rates-1965-actions-runner.test.mjs
python3 -I -B tests/exchange-rates-1965-python-http.test.py
npm run typecheck
npm test
npm run build
```

PR #8 的前端／純讀取回歸測試位於該分支：

```bash
node --test tests/exchange-rates-1965-branch-ui.test.mjs tests/exchange-rates-1965-read-only.test.mjs tests/exchange-rates-1965-ui.test.mjs
```

此文件中的單店發布步驟完成後再補實際 run／quote／頁面驗收紀錄。後續才擴大 3 家、
38 家與不同時段的穩定性驗證，並核對 token TTL 與來源 update_time 的語意。

本次發布入口的本機驗證：647 項 Node 測試、12 項 Python 離線測試、strict checkJs、
Vite／Functions build 與 workflow YAML／Bash 語法皆通過。前端輸出與既有 main 基準
逐檔相同，4 個公開 Function 封包未帶入橘標 collector／Python。PR #8 分支另有
56 項 UI／只讀／模擬時鐘過期回歸通過；獨立審閱沒有阻擋合併的問題。
