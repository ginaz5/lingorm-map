# SuperRich 1965：Python 五店與全店 Preview 驗收

更新：2026-10-21。使用者要求先驗五間，成功後才嘗試全部店家。沿用已驗收的 Python
Safari transport 與原固定 PR #8 Preview；不改正式站、production target 或排程。
單店的來源與發布成功紀錄見 [單店文件](superrich1965-python-single-publish.zh-TW.md)。

## 固定模式與店家

Workflow 手動 action 新增 `publish-five-python` 與 `publish-all-python`；CLI 同名模式
只接受 `--target preview-reviewed`，不接受 scope／slug／URL／transport override。
既有 `publish-python` 仍固定單店；舊三店 pilot 的定義與歷史 ledger 身分不變。

| 五店順序 | Slug | 官方 company／branch | 分店 |
| --- | --- | --- | --- |
| 1 | superrich1965-58 | A04／36 | Ratchadamri Soi 1 |
| 2 | superrich1965-56 | A04／00 | Silom Plaza |
| 3 | superrich1965-57 | A04／35 | Ratchadamri Soi 2 |
| 4 | superrich1965-59 | A04／40 | Big C Ratchadamri |
| 5 | superrich1965-60 | A04／50 | Big C Place Ratchadapisek |

全店使用正式 mapping 的 38 個唯一 Slug。JS 與 Python 共同讀取受版本控制的
`data/superrich1965-branches.json`；Python 只從 helper 的固定相對路徑載入，嚴格驗
schema、38 筆數量、Slug／officialId、唯一 company／branch 與欄位格式。Mapping 缺失、
損壞或任意未收錄店號均在 HTTP opener 前失敗，不接受額外 URL 或任意店家清單。

## 執行規則

1. 本機、獨立審閱、CI 與 Preview 驗收後才進 main；最後 squash message 使用
   `[skip netlify]`。PR #8 保持開啟，target 維持 deploy `6ad779f97644e6fb5b04b05c`、
   Preview commit `74b9013494b94201bd0841ee8090f583c7994288`。
2. 只讀 inspect control／common guard，核對無有效冷卻、active lease、未結案來源或
   其他來源工作；保留原 epoch、controlVersion 與 blockLevel。沒有來源或快取 reset。
3. 恢復 guard，從 main 只啟動一次五店模式，工作結束先 source-pause 再核對結果。
4. 五間全部新取價及發布成功才往全店：requested=5、sourceSucceeded=5、published=5、
   failed=0、notAttempted=0、sourceValidated=true、replayed=false；每店逐筆 quote 身分、
   USD／TWD 指定面額、控制版本與有效期均通過，兩個只讀 API 回傳一致。
5. 上述驗收通過後，重新檢查 guard 並恢復，從 main 啟動一次全店模式；結束即 pause，
   核對每店終態、實際 HTTP 與有效 cache coverage，再驗頁面及排序。

任一來源 challenge／格式錯誤／缺面額／timeout／發布 CAS 失敗都停止該輪，不重試，
保留先前成功發布與未過期 quote。既有 source guard、target gate、job／operation
ledger、取消與 deadline 檢查不變；共用來源層級 2 再遇 challenge 會升為 3 並暫停。
缺有效報價的店家仍顯示暫無報價，不用其他店或賣出價補值。

## Token、節奏與快取計數

每輪只有一個匿名 token session，token 只在 JS 記憶體中，Python 每次接收 stdin 的
單次 HTTP 訊息。沿用已知 TTL 的 30 秒預留、未知 TTL 不跨店重用與過期下一店重新
取 token；同店失敗不刷新 token 或 fallback。串行取價，實際 HTTP 店家之間隨機
2～5 秒，保留 gate 間隔；整輪應用預算 12 分鐘、GitHub job 20 分鐘。

冷 session、全數需要更新且 token 全輪有效時，五店通常 1 GET＋5 POST＝6 次，
38 店通常 1 GET＋38 POST＝39 次。以 telemetry 實際值為準，不將此數量當作保證。

全店輪次遵守既有半小時刷新資格：五店剛完成且仍未到下個邊界時，這五店會是 cache
hit，接著新抓其餘 33 店；通常是 1 token GET＋33 rate POST＝34 次。此時全店輪次
sourceValidated=false、cacheHit=5、sourceSucceeded=33、published=33，仍可在五店先前
成功證據與 38 筆有效 quote 覆蓋都齊全時完成本次整體驗收。不可清 cache、重標時間或
強制提早刷新來製造「38 店都是本輪新抓」；跨過刷新邊界則如實記錄新抓店數。

## 驗收輸出

- 記錄五店與全店各自的 run ID、main commit、mode／scope、sourceSucceeded、published、
  cacheHit、failed、notAttempted、sourceRequestCount、replayed 與 sourceValidated。
- 以固定 Preview 的 GET `/api/exchange-rates-1965-cache` 檢查 coverage，POST
  `/api/exchange-rates-1965-branch` 逐店核對；重讀前後 guard／gate／job／ledger 不變。
- 全店期望 38 個受控 Slug 均有有效 quote、無未知／重複分店；只寫逐店 cache，不合成
  舊完整 snapshot，不能用相容 snapshot GET 判斷本輪 coverage。
- 頁面檢查中英文、列表／popup 與 USD／TWD 排序，僅比較有有效報價的橘標分店。
  固定 Preview 只有 HERE key；Google popup 與過期行為以現有回歸測試另外驗證。
- 不持久化 source token／Authorization／原始來源 body；來源 update_time 語意及回應
  缺獨立分店身分的限制維持如實記錄，不能將本次成功當成所有時段都穩定的證明。

本次執行結果另記於對應 PR／Actions run；未完成的來源或發布不能寫成成功。
