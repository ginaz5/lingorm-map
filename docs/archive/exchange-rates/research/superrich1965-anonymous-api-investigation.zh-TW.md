# SuperRich 1965：匿名 token 與 external-app API 調查

> 歷史文件，於 2026-10-24 封存。保留當時的設計、操作與驗收結果；其中的部署狀態、待辦與指令不代表現行流程。維護請從[現行文件索引](../../../README.md)開始。


調查日期：2026-10-19（Asia/Taipei）。初次調查只做公開程式／官網靜態資源研究、
控制狀態唯讀檢查，以及一家的本機真實來源測試；未修改 runtime、Chromium、
環境變數、遠端 control／breaker、報價快取或正式資料，未部署。

## 結論與證據邊界

匿名 token GET + external-app 匯率 POST 在本機成功，兩者皆回 200，
USD 與 TWD 的指定面額買入價可直接通過現有 `parseBranchExchange1965()`。
後續 Netlify Preview 實測在 token GET 收到 403 challenge，尚未送匯率 POST；
詳見本文末的雲端紀錄。下一步改評估
[GitHub Actions 抓取計畫](../plans/superrich1965-github-actions-plan.zh-TW.md)，尚未實作或執行。

2026-10-23 補驗：將獨立 Python runtime 打包到 Netlify 後，Python／Safari 單店
token GET 與 rate POST 都回 200，parser 通過、未發布報價。先前 403 僅是當時
Node 傳輸的結果，不能概括所有 Netlify 取價方式；兩次測試日期不同，也不足以
單獨證實 Node 是原失敗的唯一原因。見 [Netlify Python 實測](../acceptance/superrich1965-netlify-python-probe-2026-10-23.zh-TW.md)。

目前本機程式已退役 Netlify 直接抓價入口與 browser dependencies，三個公開 API
均只讀快取；這批變更尚未部署。匿名來源核心保留供未來外部 runner 使用，
本文的本機 Function 成功與 Preview 403／429 是退役前的歷史證據，不能用舊環境
變數重新啟用目前程式的來源抓取。退役範圍見本文末節。

初次調查未測 Netlify 出口；後續已確認該次 token 請求被擋。
目前仍沒有遍歷 38 家或驗證長期穩定性，本機／第三方成功不能作為本專案
GitHub runner 成功或完整分店覆蓋的證明。

## 來源研究

- [ThaiCash scrape_sr1965() 固定版本](https://github.com/mrfartman77/thaicash-data/blob/4b2015ffa7b86e20f55d502f5ec359d2220fae8f/scrapers/booth_rates.py#L133)
  先 GET `https://api.superrich1965.com/front/exchange-rate/oauth2/callback`，
  從 `accessToken` 取匿名 token，再帶 Bearer POST
  `https://www.superrich1965.com/api/exchange-rate-service/v1/external-app-exchange-rate/get`。
  body 是 `filters` 陣列，包含 `company_code=A04` 與 `branch_no=36`。
- 該程式每幣別取最高 `buy_rate_amount`，只收 USD／EUR／AUD／CNY，
  不收 TWD、不讀 `update_time`。其 green chain 註解有品牌錯誤；
  不沿用該註解或「36 一定最佳價」的推論。
- [ThaiCash 資料檔](https://github.com/mrfartman77/thaicash-data/blob/main/data/booth-rates.json)
  在本次讀取時記錄 `2026-10-19T14:00:32Z`、橘標 `ok=true`、USD 33.43。
  只有 `fetchedAt`，沒有該來源的 `siteTime`；不能把抓取時間當成報價更新時間。
- [官網目前公開匯率元件](https://www.superrich1965.com/_nuxt/DRvywq8b.js)
  仍使用 `/spr/front/exchange-rate/branch-list` 與 `/spr/front/exchange-rate/get`。
  有會員 token 才附 Bearer，匿名 header 為空；未在已查的前端資源找到上述
  external-app／匿名 callback 呼叫。因此，新路徑是已測得可用的另一介面，
  尚不能稱為已確認的官網現行匿名前端流程。JS 雜湊 URL 會隨網站部署改變。

## 單店本機真實測試

台灣時間 2026-10-19 22:30:13～22:30:19 執行。使用一般 Node HTTP，
沿用專案可識別 User-Agent，不使用 Chromium、Cookie、stealth 或來源重試。

測試前取得既有本機鎖並確認本機無有效冷卻；另外唯讀確認正式 store 與
確切 Preview `6ad48de20cfce14e8ddd926f` 的控制／breaker。正式控制與 breaker
當時為空；Preview enabled，保留 blockLevel=1，其冷卻
`2026-10-18T15:15:29.360Z` 已過期。沒有更動控制版本、清除歷史或建立新部署。

| 階段 | 請求 | 結果 |
| --- | --- | --- |
| token | 匿名 callback GET 一次 | 200，JSON，無 `cf-mitigated: challenge` |
| rate | Bearer + external-app POST 一次 | 200，JSON，無 challenge |
| envelope | `status_code=200`、`code=SUCCESS` | `data` 含 `datas`、`update_time` |
| parser | 現有 `parseBranchExchange1965()` | `status=ok`，兩個指定面額都有效 |

固定使用正式 mapping 的 `superrich1965-58`：officialId=58、companyCode=A04、
branchNo=`36`。不得把這筆結果標到 56（branchNo=`00`）或 69（`44`）。
本次回應的 `data` 沒有分店身分欄位，parser 的 branchNo 是 caller echo；
成功回應不構成上游自行證明分店身分，其他 mapping 仍待分店核對。

| 幣別 | 精確 `show_denom` | 原始 `buy_rate_amount` | 現有 parser 的整數值 |
| --- | --- | --- | --- |
| USD | `100-50` | `33.43` | 33430000（scale 1e6） |
| TWD | `1000-100` | `1.005` | 1005000（scale 1e6） |

以上是該次實測值，不是持續更新的報價。其他 USD 面額 `20-10`／`5`／`2-1`，
以及 TWD `2000` 都沒有被拿來替代指定面額；沒有讀 sell 或推算 buy。
結果沒有發布至任何網站快取或 CSV。

### token 與來源時間

token 只留在該次程序記憶體，沒有寫入檔案、console、fixture 或公開回應。
本次 token 是 JWT；僅在記憶體解讀 `iat`／`exp`，未驗證 JWT 簽章。

- `iat` claim：2026-10-19T14:05:02Z。
- `exp` claim：2026-10-19T15:05:02Z。
- claim 間隔一小時；實際取得時剩約 35 分鐘，不能每次 GET 後就當成還有一小時。
- 未觀察到數字 `expires_in`。沒有等待到期或測試 refresh，故實際有效期及
  401 行為尚未驗證；會員 OAuth 的預設 TTL 不能套用到這個匿名 token。

匯率 `data.update_time=1792407087880`，轉為
`2026-10-19T10:51:27.880Z`（台灣 18:51:27.880），早於本次抓取約 3 小時 39 分。
本次只確認此值不是等於本次抓取時間；仍不足以確認它的業務語意及每店更新規則，
不應顯示為已驗證的「官網報價時間」，也不改動現有快取有效期。

## 最小後續整合方式（調查時規劃）

本節保留初次調查時的整合條件。後續曾增加選用的 `anonymous-api` runtime 模式，
再於本次本機變更退役 Netlify 模式選擇與抓價入口；以下不是現行啟用步驟。
目前維運方式見 [本機測試文件](../../../../note/LOCAL_TESTING.md)，
本機與後續 Netlify Preview 結果分別記錄於本文後段。

1. 增加明確選用的匿名 API transport，保留目前 http／browser 路徑與預設。
   僅在 `queryBranchRates()` 通過 control、快取、breaker、CAS lease，且
   重查控制版本後，才 lazy 取得 token。factory 建立本身不得打來源。
2. callback 與 rate 都算來源請求：冷 session 一店成功應為兩次；同一背景
   invocation 後續分店可重用記憶體 token，但到期判斷要用 token 本身的可用
   到期資訊與安全餘裕，不能從 GET 時刻盲目加一小時。未確認 TTL 時不跨 invocation 保存。
3. 兩階段共用 abort／整體 deadline／lease，診斷明確標示 token 或 rate；
   403、429、challenge 任一階段都停止並沿用既有 breaker，不改路徑 fallback、
   不重新取 token，也不清除原冷卻。401 不等同於允許無限制 refresh。
4. token 不進前端、Blobs、URL、log、fixture；Bearer 只傳固定取價 endpoint，
   禁止 redirect。錯誤只記錄受限欄位，不帶任意例外或完整來源 body。
5. 沿用固定 mapping、原 parser 的精確幣別／面額與 1e6 整數契約、每店 cache、
   控制版本、背景 2～5 秒間隔，以及下一個半小時邊界 +35 分鐘的到期規則。
   單店成功不重設既有 breaker 升級歷史。
6. mock 先覆蓋 cache／disabled／breaker／lease 失敗時零 token 請求、token
   成功後的精確 POST、兩階段 403／429／逾時／錯誤 JSON、token 到期、分店錯配、
   缺面額及 log 無 token。再準備 Deploy Preview，遵守既有冷卻，只驗一家；
   單店雲端成功後才驗證全部分店與背景輪次。此研究未授權或觸發新部署。

## guest feed 備選

[ExchangeTHB scrapeSuperrich1965()](https://github.com/shiftshen/exchangethb/blob/main/lib/scrapers/cash.ts#L165)
會呼叫 `superrichrate2.ztidev.com` 的 guest token／locations／booking feed。
其 `buyRate` 是 sell 減去預設或歷史 spread，標為 `sourceKind=hybrid`，
且 supported currencies 沒有 TWD。它不是這張地圖所需的已驗證分店買入價。
本次只讀程式，未呼叫該服務；未確認該網域與官方的關係，不採用推算報價。

## 初次調查驗證紀錄

- 公開程式／資料與官網靜態 JavaScript：唯讀研究。
- 正式與確切 Preview 控制／breaker、本機 state：唯讀確認。
- 真實來源：僅一次 token GET + 一次指定分店 POST，無重試、無發布。
- 現有 parser：以真實單店 payload 驗證 USD／TWD，結果 `ok`。
- 文件：檢查 diff、路徑及連結。未改 runtime，本次不重跑型別檢查、全套 Node
  測試或 build；Netlify 出口驗證仍待選用 transport 實作與獲授權的 Preview 部署。

## 退役前的實作與本機 Function 驗證（同日）

當時增加 `EXCHANGE_RATES_1965_SOURCE_TRANSPORT=anonymous-api` 選用模式，
接入原本單店與背景來源 session；當時預設仍是 `http`，未改 Chromium、公開
API／快取 schema、報價有效期或遠端設定。匿名 token 及兩階段診斷不進公開回應。
此環境變數與 Netlify 來源入口已在本次本機程式退役，保留此段僅供核對實測歷史。

台灣時間 2026-10-19 22:43:53～22:43:56，使用本機 `netlify dev`
`http://localhost:8890` 呼叫原有 `POST /api/exchange-rates-1965-branch`，
僅測 `superrich1965-58`，結果如下。來源前再確認本機、正式及既有 Preview
冷卻，未寫入遠端 control、breaker 或 cache；新報價只寫入 Netlify Dev 的本機 store。

| 驗證 | 結果 |
| --- | --- |
| 首次單店 POST | 200，有效 USD／TWD；來源 GET + POST 各一次 |
| 私有診斷 | `sourceProfile=anonymous-api`、`sourceOutcome=complete`、`sourceRequestCount=2`，兩個 stage 都 200 |
| 指定面額 | USD `100-50` 買入 33.43；TWD `1000-100` 買入 1.005 |
| 第二次相同單店 POST | 200，quote 與首次完全相同；來源請求 0、diagnostics 空陣列 |
| 唯讀 cache GET | 200，提供相同單店 quote；不發來源請求 |
| 到期規則 | attemptedAt=14:43:53Z，下個半小時 15:00Z，加 35 分鐘，expiresAt=15:35Z |

新增 16 項 transport 單元測試與 9 項查詢／背景整合測試，涵蓋 lazy token、
正確來源計數、快取及前置控制、token 到期／重用、403／429／challenge、
401／malformed JSON／abort、不重試、原 cache 到期與 breaker 歷史保留，
以及 log／公開回應／cache 無 token。背景兩店與到期重取只使用 mock，
沒有對真實來源執行全部分店或背景輪次。

`npm run typecheck`、`npm test`（688 項、0 失敗）、`npm run build` 與
`netlify functions:build` 通過，函式打包輸出只放本機暫存目錄。
該次本機驗證沒有發布正式資料；後續雲端實測結果如下。

## Netlify Preview 匿名 token 被擋（2026-10-19）

使用者將 `41fcb8f` 部署至 Preview `6ad62ddf1a2369d43e1e364e` 後，
台灣時間 22:50 查詢 `superrich1965-62`。私有 Function log 已確認：

| 欄位 | 實際結果 |
| --- | --- |
| sourceProfile | `anonymous-api`，模式已生效 |
| diagnostics stage／status | `token`／403 |
| cfMitigated | `challenge` |
| sourceRequestCount | 1，只有匿名 token GET |
| sourceOutcome／cooldownSource | `blocked`／`source_blocked`，本次新來源封鎖 |
| 本站 httpStatus | 429，啟動既有冷卻後的回應 |
| retryAt | `2026-10-19T20:50:01.138Z`，台灣 10 月 20 日 04:50:01 |

[Function log](https://app.netlify.com/projects/lingorm-map/functions/exchange-rates-1965-branch?scope=deploypreview%3A8)
對應 `attemptedAt=2026-10-19T14:50:00.655Z`。
來源匯率 POST 沒有發出，不能宣稱新取價 POST 在 Netlify 也已失敗。
403／challenge 是來源結果；429 是本站保護機制，與既有冷卻擋下的零來源請求不同。
這次診斷沒有重試來源、修改設定或清除冷卻。

## GitHub Actions 的後續方向

目前有本機成功與 ThaiCash 的 Actions 公開成功紀錄，足以支持分階段驗證，
不足以保證本專案的 GitHub runner 可用。runner 網路與 HTTP 特徵都可能不同。
現有本機 CLI 未接匿名模式且發布舊 full snapshot，必須補上逐店 cache 接線，
也需實作明確 Preview target。Netlify 只讀報價已在本機程式完成，尚未部署；
後續須驗收部署切換並核對既有工作，避免外部 runner 與舊部署同時抓來源。

完整階段、target／Secrets、既有冷卻與驗收條件見
[GitHub Actions 抓取與 Netlify 逐店快取計畫](../plans/superrich1965-github-actions-plan.zh-TW.md)。
Actions runner、workflow、Secrets、Preview target 支援與排程尚未實作或啟用。

## 程式與環境變數退役紀錄（2026-10-20，尚未部署）

- 刪除 `exchange-rates-1965-fetch.mjs` 與 `exchange-rates-1965-refresh.mjs`
  兩個 Netlify Functions，移除 HTTP dispatch；保留 shared `runSlowBatch()`、
  工作 token／job claim 與 12 分鐘預算，供未來 Actions runner 接入。
- 刪除 browser helper、Chromium／Playwright dependencies 與專用打包設定。
  `EXCHANGE_RATES_1965_FETCH_MODE`、`EXCHANGE_RATES_1965_SOURCE_TRANSPORT`
  從現行程式及設定範本退役，不再提供 Netlify 抓價模式選擇。
- 保留 `GET /api/exchange-rates-1965` 的完整 snapshot API、
  `GET /api/exchange-rates-1965-cache` 與相容的
  `POST /api/exchange-rates-1965-branch`。三者均只讀已存報價，不取 token、不打來源、
  不寫 cache，也不初始化 control 或取得抓價 lease。branch POST 缺少有效報價時回
  `503 unavailable`，建議 60 秒後重讀。
- 保留 `EXCHANGE_RATES_1965_ENABLED`、control、lease、breaker、逐店 cache、
  anonymous source 與既有本機 full-snapshot CLI。有效期、控制版本與既有冷卻
  契約保留；公開讀取不延長到期、不清除 breaker 或改寫報價。
- 未來 runner 直接使用 `createAnonymousApiSource()` 與
  `ANONYMOUS_SOURCE_PROFILE`；已刪除的來源 session factory 不再是可用入口。
  本機 CLI 仍使用舊取價路徑及完整 snapshot 發布方式，尚不能當成匿名 Actions runner。

兩個退役環境變數已從 Netlify 專案所有 context 移除，CLI 確認需重新部署才會套用。
程式尚未部署，未設定 GitHub Secrets、清除冷卻或刪除遠端 Blobs；先前 Preview
的 403／429 與 control／breaker 歷史全部保留。
Actions 的工作建立、probe、逐店發布及 Preview target 接線仍依計畫待實作。
