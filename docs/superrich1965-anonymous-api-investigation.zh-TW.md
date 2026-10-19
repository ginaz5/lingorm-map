# SuperRich 1965：匿名 token 與 external-app API 調查

調查日期：2026-10-19（Asia/Taipei）。本次只做公開程式／官網靜態資源研究、
控制狀態唯讀檢查，以及一家的本機真實來源測試；未修改 runtime、Chromium、
環境變數、遠端 control／breaker、報價快取或正式資料，未部署。

## 結論與證據邊界

匿名 token GET + external-app 匯率 POST 在本機成功，兩者皆回 200，
USD 與 TWD 的指定面額買入價可直接通過現有 `parseBranchExchange1965()`。
這是值得準備 Netlify 驗證的路徑，不能由 Chromium 被擋就推論全 Netlify 不可行。

本次沒有在 Netlify 出口測這兩個端點，沒有遍歷 38 家，沒有驗證長期穩定性；
本機成功不能作為雲端成功或完整分店覆蓋的證明。

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

## 最小後續整合方式（尚未實作）

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

## 驗證紀錄

- 公開程式／資料與官網靜態 JavaScript：唯讀研究。
- 正式與確切 Preview 控制／breaker、本機 state：唯讀確認。
- 真實來源：僅一次 token GET + 一次指定分店 POST，無重試、無發布。
- 現有 parser：以真實單店 payload 驗證 USD／TWD，結果 `ok`。
- 文件：檢查 diff、路徑及連結。未改 runtime，本次不重跑型別檢查、全套 Node
  測試或 build；Netlify 出口驗證仍待選用 transport 實作與獲授權的 Preview 部署。
