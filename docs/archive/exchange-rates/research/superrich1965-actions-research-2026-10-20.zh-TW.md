# SuperRich 1965：Actions 實作前調查（2026-10-20）

> 歷史文件，於 2026-10-24 封存。保留當時的設計、操作與驗收結果；其中的部署狀態、待辦與指令不代表現行流程。維護請從[現行文件索引](../../../README.md)開始。


本次只讀取專案程式、已安裝 SDK、GitHub 官方文件與 ThaiCash 公開紀錄。
未呼叫 SuperRich token／匯率端點，未執行 workflow、設定 Secrets、改寫 Blobs 或部署。
程式基準為 `5ee520c`；後續工作以 [Actions 計畫](../plans/superrich1965-github-actions-plan.zh-TW.md) 為準。

## 已證明與尚未證明

| 證據 | 可以支持的結論 | 不能支持的結論 |
| --- | --- | --- |
| 10/19 本機 A04／36 token GET＋rate POST 都 200 | 本機曾取得 USD／TWD 指定面額買入價 | 本專案 GitHub runner 或全部分店可用 |
| 10/19 Preview token GET 403 challenge，尚未送 rate POST | 該次 Netlify 出口無法取得 token；本站 429 是冷卻 | external-app rate POST 本身已在 Netlify 實測失敗 |
| ThaiCash 兩次標準 runner 的固定輸出含橘標 `ok:true` | 該流程有公開的單店成功紀錄 | 本專案的 User-Agent、TWD、38 店覆蓋、來源時間或長期穩定已驗證 |
| 本分支的三個 Netlify API 只讀快取 | 已具備外部發布後供前端讀取的程式邊界 | 現行遠端部署已採用此 commit，或 Actions 已完成接線 |

本機／Netlify 原始調查見 [匿名 API 紀錄](superrich1965-anonymous-api-investigation.zh-TW.md)。
本次沒有重新查閱現行 Netlify 部署或 breaker；先前記錄的 retryAt 不當成現在的解封狀態。

## ThaiCash：使用固定版本核對

本次讀到固定 commit `cafce7f3bbd20d77306a82364e61f349a4e2e45e`。
[scraper](https://github.com/mrfartman77/thaicash-data/blob/cafce7f3bbd20d77306a82364e61f349a4e2e45e/scrapers/booth_rates.py#L133)
的 `scrape_sr1965()` 仍採匿名 callback GET，再以 Bearer POST external-app 介面；
body 是 `filters`，固定 company_code=A04、branch_no=36。使用一般 Python HTTP、
Safari User-Agent、20 秒 timeout，沒有 Chromium、橘標分店遍歷或明確重試。
它對每幣別取最高買入價，只收 USD／EUR／AUD／CNY，不含 TWD，也不核對本專案的指定面額。

| 執行時間（台灣） | 公開 run | 該輪固定輸出 | 橘標紀錄 |
| --- | --- | --- | --- |
| 2026-10-19 22:30 | [39269563948](https://github.com/mrfartman77/thaicash-data/actions/runs/39269563948) | [1c3f352…](https://github.com/mrfartman77/thaicash-data/blob/1c3f352107da3bf3ddf10247819b4848aae7ce34/data/booth-rates.json) | fetchedAt=14:30:34Z，ok=true，USD 33.43 |
| 2026-10-20 15:30 | [39386955979](https://github.com/mrfartman77/thaicash-data/actions/runs/39386955979) | [cafce7f…](https://github.com/mrfartman77/thaicash-data/blob/cafce7f3bbd20d77306a82364e61f349a4e2e45e/data/booth-rates.json) | fetchedAt=07:30:34Z，ok=true，USD 33.53 |

兩次均為 workflow_dispatch、ubuntu-latest。這些數字是歷史證據，不能當作即時報價。
其 `main()` 只要任一 booth 成功就可 exit 0，因此 run success 須連同該輪 JSON 的
橘標狀態一起看。run 的 head_sha 是執行前版本，不能直接當成該輪輸出 commit。
兩份橘標資料均無 TWD 或來源 siteTime；fetchedAt 不是已驗證的官網更新時間。

[固定 workflow](https://github.com/mrfartman77/thaicash-data/blob/cafce7f3bbd20d77306a82364e61f349a4e2e45e/.github/workflows/booth-rates.yml)
有每小時第 7 分鐘的備援 cron、手動觸發、固定 concurrency group、cancel-in-progress=false，
以及 commit/push JSON 所需的 contents:write。
[Worker 原始碼](https://github.com/mrfartman77/thaicash-data/blob/cafce7f3bbd20d77306a82364e61f349a4e2e45e/infra/worker.js)
另描述 Cloudflare 派送；程式存在不代表現行 Worker 設定或排程 SLA 已被核實。
本專案直接寫 Blobs，不需要複製它的 JSON commit、write 權限或額外派送服務。

## GitHub 平台核對

| 項目 | 官方事實與本案判斷 |
| --- | --- |
| 首次 dispatch | workflow 檔須先存在預設分支，--ref 只能選執行版本，不能省略 bootstrap。先合併受審閱、僅供手動的初版，再驗來源。[手動執行](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) |
| Runner 出口 | 標準 Ubuntu runner 的網路範圍會變動，沒有本案可指定的固定出口；相同 runner label 不保證相同來源結果。先測標準 Linux，不以升級 runner 當作已知修復。[IP 說明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#ip-addresses) |
| Concurrency | 同一 repo 內用同一 group 才能互斥；本案不得依 ref／target／workflow 名拆組。cancel-in-progress=false，保留遠端 CAS。預設只保留最新 pending，現行另有 queue:max；本案不累積過期取價工作。[官方機制](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) |
| 排程 | 可延遲，繁忙時可丟棄；只跑預設分支。公開 repo 60 天無活動會停用。現行支援 IANA timezone，預設 UTC；不能寫成僅支援 UTC。[schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) |
| Secrets 與執行 ref | Environment 限定哪些 branch/tag 可取得 secret；本案初版明列 main，測試分支若需要另行審閱列入。不要僅靠可被分支改掉的 YAML if；Protected branches only 在未設 branch protection 時可能允許全部分支。[環境規則](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#deployment-branches-and-tags) |
| 權限 | Blobs 發布不需 contents:write。使用 environment secret、contents:read 與固定 SHA 的可信 actions；不接受任意 checkout ref、URL 或 shell input。[官方安全使用](https://docs.github.com/en/actions/reference/security/secure-use) |
| 成本 | 公開 repo 使用標準 hosted runner 免費；larger runner 另計。私人 repo 則消耗帳號共用分鐘。[官方計費](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |

本次唯讀 GitHub API 確認 `ginaz5/lingorm-map` 為 public、default_branch=main、未封存。
這不等同已查核 Actions 啟用狀態、Environment 規則、帳號額度或 Netlify 方案。
容量估算：若未來採全天半小時一次，31 天為 1,488 輪；若每輪完整 job（含 checkout／安裝／抓取／發布）計費 2 分鐘，約 2,976 分鐘，另加其他 CI。
實際分鐘依各 job 執行時間向上進位，見[runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)。
這是試算，不是本案已核准的時段或費用承諾。

## Netlify Blobs 與已安裝 SDK

核對 `@netlify/blobs` 11.0.3 的 `dist/main.js`、`dist/main.d.ts` 與 retry 實作，
以及專案 [storage helper](../../../../netlify/functions/_shared/exchange-rates-1965-storage.mjs)。
本地 SDK 檢查與注入 fake fetch 的 factory 測試不涉及遠端讀寫。

| 項目 | 調查結果 |
| --- | --- |
| Production | 專案依 runtime context=production 呼叫 getStore，使用跨部署的 site-wide exchange-rates-1965 store |
| Preview | 其他 context 呼叫 getDeployStore；不同 deploy ID 的 quote、control、breaker、gate 彼此隔離 |
| 外部 runner | SDK 支援明確 siteID/token/deployID；不能沿用 createAdminStore，因它固定開 site-wide store |
| Region | 純外部 context 的 getDeployStore 會採 SDK 的 auto region；不要硬編碼推測區域或複製 Netlify Dev context |
| 更新一致性 | 保留 strong read、onlyIfNew／onlyIfMatch ETag CAS；跨 key 沒有本案可依賴的交易 |
| SDK 重試 | SDK 對部分 storage 錯誤有內部重試；它與匿名來源 allowRetry=false 是兩回事。deadline／取消／ownership 測試須納入 storage 延遲 |
| Deploy 更換 | Preview alias 指向新 deploy 後會讀新 store；舊 quote 不會自動成為新部署或 production 資料 |
| 憑證 | 固定 siteID 或 deployID 是程式的目標限制，不是 PAT 自身已被限縮到一個 store 的保證 |

平台的 namespace、外部參數與 CAS 依 [Blobs 文件](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)；
PAT 有效期、個人權限與 SSO 行為依 [Netlify API 文件](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/)。
目前查到的官方介面沒有證明可簽發「僅限本 store／deploy 寫入」的 PAT，故計畫不承諾這種隔離。

## 本地核心的實作缺口

| 程式 | 已有能力 | Actions 仍需補上 |
| --- | --- | --- |
| [on-demand 核心](../../../../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs) | control、cache、gate、breaker、精確面額解析與 CAS 發布 | 不自建 control 的入口、不發布 probe、跨 target source guard、結構化結果與發布前 ownership 檢查 |
| [batch 核心](https://github.com/ginaz5/lingorm-map/blob/0a2b122517e686e62c239cc176a31f9038eb1f4a/netlify/functions/_shared/exchange-rates-1965-background.mjs) | pending job claim、串行、2～5 秒間隔、12 分鐘預算 | 已刪 dispatcher，須補 job 建立、operation ledger、取消與 coverage；loaded 不能證明 38 店實測 |
| [anonymous transport](../../../../netlify/functions/_shared/exchange-rates-1965-anonymous.mjs) | lazy token、兩階段計數、已知 TTL 重用、無 retry | runner 的 session lifecycle、取消傳遞與不洩漏的執行摘要 |
| [舊本機 CLI](https://github.com/ginaz5/lingorm-map/blob/0a2b122517e686e62c239cc176a31f9038eb1f4a/scripts/exchange-rates-1965-fetch.mjs) | full-snapshot probe／dry-run／publish | 語意不同，不直接改造成 Actions：舊 probe 不寫遠端且可在無 enabled control 時抓來源 |
| [只讀單店 API](../../../../netlify/functions/_shared/exchange-rates-1965-branch-cache.mjs) | 版本／啟用時間／有效期核對，legacy snapshot fallback | 新發布器須寫既有逐店 schema；不靠公開 API 啟動來源 |

另外兩個不能忽略的差異：

1. 既有 breaker／gate 只在各 target store，無法防止新 Preview 繞過別處冷卻。
   建議新增固定 site-wide source guard，將來源的冷卻與互斥獨立於報價 target。
   它無法約束尚未改用此 guard 的舊部署／本機 collector，首次切換及運行期間都須避免雙跑。
   來源前另需持久化未結案標記：若 403 後保護寫入失敗或被中止，lease 到期不能代表來源可用。
2. 舊 full snapshot 的到期是下一個半小時邊界加 90 秒；逐店 quote 是加 35 分鐘。
   fallback 取原 expiry 的較早值，不能把舊 snapshot 轉格式就延長壽命。
   Actions 只發布逐店資料，舊完整 snapshot API 不會因此自動得到新一輪完整快照。

## 尚須真實驗證

- 本專案受控 GitHub runner 能否取得匿名 token，並取得 A04／36 指定 USD／TWD 買入價。
- 其餘 37 家的 mapping、回應面額及分店對應；目前上游回應未提供獨立分店身分證明。
- source.update_time 的業務語意、長期穩定、同時段 token TTL 與來源更新規律。
- 指定 Preview 的 Blobs 權限／ETag、control 管理、發布後 API 與地圖一致性。
- 新部署重新綁定、production 切換、取消／rerun、部分完成與來源封鎖後跨 target 停止。

這些是後續驗收條件；本次沒有用 mock 或第三方成功將它們標成已完成。
