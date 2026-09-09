# SuperRich 1965（橘標）USD／TWD 換匯地圖實作計畫

建立日期：2026-09-09。狀態：**規劃初稿，尚未動程式碼／Notion／Netlify 設定**。本文件延續已上線的 [綠色 SuperRich 換匯計畫](superrich-exchange-map-plan.zh-TW.md)（`superrichthailand.com`）的方法論，但目標是另一家公司、另一套 API，因此另立文件，不在原文件上加註。

本功能讓使用者在現有踩點地圖上找到 **SuperRich Currency Exchange (1965) Company Limited.**（`superrich1965.com`）分店，查看報價並與已上線的綠色 SuperRich 並存。**這兩家是完全不同的公司**，只是品牌名稱相似；Chinese-speaking 旅遊社群慣稱前者「綠色 SuperRich」、後者「橘 SuperRich／SuperRich 1965」。

### 審閱意見（2026-09-09，已採納，共三輪）

**第一輪（5 點）：**

1. **[P1]** `isExchangeLocation()` 不能改回傳品牌字串——會打斷 `src/ui/render.js` 現有的排序比較邏輯。改法：保留原本的 boolean 不動，另外新增 `getExchangeBrand()` 給 marker 顏色專用（見 §3.2）。
2. **[P1]** 兩套前端平行複製時，缺少「各品牌狀態互相隔離」與「共用控制單一負責者」的明文規則，一方停用／過期可能清掉另一方的報價（見 §4.4，新增）。
3. **[P2]** 「USD、TWD 兩項排序」沒有說清楚橘色合併面額（`100-50`／`1000-100`）要怎麼跟綠色分開面額（`USD_100`／`USD_50`／`2000-100`）一起比較，容易誤導使用者以為排名適用於他手上的鈔票面額（見 §3.3，新增）。
4. **[P2]** Cloudflare 可行性驗證只做到 GET，POST 是否真的能過，要等 Phase C 部署才知道太晚——已把最小 POST 驗證前移到 Phase A 當作進入門檻（見 §2.1、§6）。
5. **[P2]** `update_time` 連續兩次呼叫的比較方法本身站不住腳（不管值變不變都無法單靠這個測試判斷語意）——已修正驗證方式並降低優先度（見 §2、§7.2）。

**第二輪（4 點，針對第一輪修正的內容再審）：**

6. **[P1]** §3.2 對「為什麼改成品牌字串會壞掉」的解釋本身是錯的——不是字串相減得到 `NaN`，是三元運算對兩個方向都回傳 `-1`，違反比較器反對稱要求；且只保留 boolean 不夠，`isExchangeLocation()` 的實作內容也必須擴充成同時認得兩品牌的 slug，否則橘標分店會被判定成「不是換匯地點」，整個匯率面板不會出現（見 §3.2，已重寫根因與修法）。
7. **[P2]** §3.3 只說「新增兩個橘色排序選項」沒有講清楚這兩個 key 實際對應哪個品牌、哪個資料欄位、由哪個 lookup 函式取值——已補上排序 key 到品牌／欄位／lookup 的對照表，並修正一處跟現有程式碼不符的錯誤 key 名稱（`TWD_2000_100` 應為 `TWD`）（見 §3.3）。
8. **[P2]** Phase A0 原本把「使用者本機終端機」跟「Netlify Deploy Preview」當成任選一種就算完成的等價選項——本機成功不能代表 Netlify 執行環境（不同 IP range）也會被 Cloudflare 放行，已改成兩步都要做、且完成條件明訂為 Netlify 環境驗證成功（見 §2.1、§6 A0）。
9. **[P2]** §5 把 `exchange-rate/branch-list` 的 39 筆直接當成「已排除 Partner Branch」的數字，但分組核對（`groups[]`）要到 A1 才會做，39 筆目前只是上限估算，不是定案——已修正措辭（見 §5）。

**第三輪（3 點，同步第二輪修正後其他章節出現的殘留矛盾）：**

10. **[P2]** §6 D1 那行仍寫著「不改動 `isExchangeLocation()`」，跟第二輪修正後 §3.2 的正確做法（`isExchangeLocation(row) = getExchangeBrand(row) !== null`——回傳型別不變，但實作要改）互相矛盾——已同步改成一致的說法（見 §6 D1）。
11. **[P3]** §5 結尾那句「依 39 間分店重新估算請求量」還是把 39 當定案數字用，跟同一節第 1 點剛加的「39 只是上限估算」矛盾——已改成「Phase A1 核對完實際 Our Branch 收錄數之後」才重新估算（見 §5）。
12. **[P3]** §8 的「下一步」還寫著要使用者「協助截 `exchange-rate/get` 的真實請求範例」，但這個前提已經在 §2 被使用者提供的截圖滿足，是失效的舊字句——已移除，改成呼應 §7 已無開放問題、可直接進 Phase A0 的現況（見 §8）。

**第四輪（7 點，2026-09-09 逐項比對實際程式碼後新增；前三輪的修正已全部核對正確）：**

13. **[P1]** §3.2 說「擴充 `isExchangeLocation()` 之後橘標的匯率面板才會出現」，這個推論是錯的——實際出現的是**綠標的面板**。`src/ui/render.js:150-186` 的 `renderExchangeRates()` 沒有任何品牌分派：`EXCHANGE_DENOMS` 寫死在 render.js:119、`getExchangeRateCell()` 讀的是綠標的 `state.exchangeRatesBySlug`（橘標三列全部 `fx_unavailable`）、時間戳取自綠標的 `state.exchangeCompletedAt`，而 `OFFICIAL_EXCHANGE_URL`（render.js:118）寫死 `superrichthailand.com`，**橘標卡片會連到綠標官網**，正好是 §3.1 要防的混淆（見 §3.2、§6 D1）。
14. **[P1]** §3.3 只提到 `ExchangeSort` typedef，漏了真正的守門員：`EXCHANGE_SORT_VALUES`（`src/features/exchange-rates.js:13`）是 `['default', ...DENOMS]`，DENOMS 來自綠標的 `src/data/exchange-rates.js`，而 select handler 用 `isExchangeSort()` 過濾，**不在清單裡的值會被靜默降級成 `'default'`**——`USD_1965`／`TWD_1965` 不進這個常數就完全點不動（見 §3.3）。
15. **[P1]** cluster 著色完全沒有三色計畫。`isExchangeOnlyCluster()`（`src/map/map.js:296`）靠 `classList.contains('is-exchange')` 判斷，HERE 端靠 `getData().isExchange !== true`（map.js:337）。橘標不能沿用 `.is-exchange`（會撞色），但後果是**全橘標 cluster 判定成 false、退回無色一般 cluster**，而混合 cluster 要什麼顏色原文完全沒提（見 §3.2，已補上定案）。
16. **[P2]** `parseExchangeRatesPayload`（`src/features/exchange-rates.js:88`）是全有全無的整組契約：`snapshot.branches.length !== BRANCH_SLUGS.size` 直接 `return null`，任一 slug 不符也整包退。橘標的 `data/superrich1965-branches.json` 跟 Notion 收錄名單必須永遠同步，否則不是單店缺值而是**整個橘標面板消失**。§6 Phase B 的「通過既有 validator」不成立——`scripts/validate-superrich-mapping.mjs` 只認綠標（見 §6 Phase B）。
17. **[P2]** §4.4 只寫了「屬於停用品牌的選項要 disable」，但 `syncExchangeControls()`（exchange-rates.js:363）的 `sort.hidden = !state.exchangeLocationsOn || state.exchangeRatesEnabled === false` 是更前面的短路：綠標被停用就整個排序 select 消失，橘標選項一起陪葬（見 §4.4）。
18. **[P3]** `isExchangeLocation(value)` 的簽名是 `string | {id?: string}`，讀的是 `.id` 不是 `.slug`，新增的 `getExchangeBrand()` 必須保持同樣的雙形狀支援（見 §3.2）。
19. **[P2]** Phase A0 Claude 這邊做不到，已實測確認：cloud container 與使用者裝置的 sandboxed shell 對 `superrich1965.com` 的 GET／POST 都是 connection failure，兩步都必須由使用者自己執行（見 §2.1、§6 A0）。

## 1. 已確認決定

| 項目 | 決定 | 相對綠色版本的差異 |
| --- | --- | --- |
| 架構 | 獨立一套，不共用綠色的 module／Netlify Function／contract | 綠色的 `src/features/exchange-rates.js`、`netlify/functions/exchange-rates*`、`src/data/exchange-rates.js` 全部平行複製一份，不重構成多 provider 抽象。優點是改動範圍小、不影響已上線的綠色功能；代價是兩套程式碼要各自維護，且前端 state／共用 UI 控制項需要明確的隔離規則（見 §4.4） |
| 分店資料來源 | 仍走 **Notion 正式建檔**流程，不直接把 1965 官方 API 當前端 runtime 資料源 | 跟綠色一致（§4.1 方案 A）。1965 官方 API 資料只用來**輔助填 Notion 欄位**，加快建檔，不取代審核流程 |
| Icon 顏色 | `#f26622`（橘） | 取自 1965 官方前端實際載入的 CSS（`.cookie-consent__btn--primary{background:#f26622}` 等），不是猜測值 |
| 幣別範圍 | **已確認：只做 USD、TWD**（2026-09-09 使用者確認） | 1965 官方 API 一次回傳 33 種幣別（USD/EUR/GBP/CHF/AUD/CNY/JPY/MYR/SGD/HKD/CAD/TWD/KRW/PHP/NZD/ZAR/VND/INR/IDR/SAR/AED/QAR/OMR/BHD/KWD/JOD/RUB/SCO/MOP/BND/TRY/MMK/NPR），比綠色多得多，但只取 USD、TWD 兩筆，其餘忽略 |
| USD 面額分桶 | 需重新設計 contract | 1965 把 `100` 與 `50` 合併成單一 bucket `"100-50"`；綠色是 `USD_100`／`USD_50` 兩個獨立列。不能沿用綠色的 `SOURCE_DENOMS` |
| TWD 面額分桶 | 需重新設計 contract | 1965 預設 bucket 是 `"1000-100"`；綠色是 `"2000-100"` |

## 2. 已查證的來源與限制（2026-09-09，透過瀏覽器分頁與 WebFetch 唯讀查證）

同綠色方法論：沒有使用帳號、Cookie 或第三方憑證，只讀取官方前端本身會呼叫的公開介面。

- 官方換匯頁：<https://www.superrich1965.com/en/exchange-rate>。前端是 **Nuxt SPA**（`_nuxt/*.js`），資料一律透過 XHR 打自家的 `/spr/front/*` REST 介面，不是伺服端渲染 HTML 表格。
- 已確認可用、已讀取到實際回應的 GET 端點：

| 用途 | GET 路徑 | 已確認欄位 |
| --- | --- | --- |
| 分店清單 | `/spr/front/branches?page=1&limit=1000` | 每筆直接含 `id`、`slug`、`title{cn,en,th}`、`latitude`／`longitude`、`address{cn,en,th}`、`phone`、`openingHours{cn,en,th}`、`landmark`、`images`、`iframeCode`（Google Maps embed）、`groups[]` |
| 分店分組 | `/spr/front/branch-groups?page=1&limit=100` | 目前只有 2 組：`main-branch`（「Our Branch／總店」，`mainBranchId: 56`）與 `partner`（「Partner Branch／合作夥伴」，`mainBranchId: 106`）——**綠色版本沒有這個分組概念，見 §7 開放問題** |
| 公司基本資料 | `/spr/front/system-setting` | 公司全名（含中／英／泰文）、電話、社群連結 |

- **匯率介面是 `POST /spr/front/exchange-rate/get`**，需要在 request body 帶分店識別（從瀏覽器網路紀錄看到會依目前選中分店變化回傳內容）。

**Response 契約（2026-09-09 由使用者截取 3 筆不同分店／時間點的真實回應確認）：**

```json
{
  "request_id": "string",
  "status_code": 200,
  "code": "SUCCESS",
  "message": "get external application exchange rate success",
  "data": {
    "datas": [
      {
        "currency_code": "USD",
        "currency_name": "USD",
        "currency_image_url": "string",
        "country_name": "string（泰文國名，不採用）",
        "denom_list": [
          { "show_denom": "100-50", "buy_rate_amount": "32.77", "sell_rate_amount": "32.89", "is_default": true },
          { "show_denom": "20-10", "buy_rate_amount": "32.64", "sell_rate_amount": "32.84", "is_default": false }
        ],
        "currency_description": "United States"
      }
    ],
    "update_time": 1788949918238
  }
}
```

- 三筆樣本（時間點相差約 1.5 小時，涵蓋不同分店）的 `datas` 都是同一組 33 種幣別，只是每筆 `denom_list` 的 `buy_rate_amount`／`sell_rate_amount` 不同，且陣列內幣別／面額的**排列順序不保證穩定**（例如 `PHP`／`KRW` 前後順序在三筆樣本中互換）——解析時必須用 `currency_code` 與 `show_denom` 字串比對取值，不能依陣列索引，比照綠色抓 `unit`＋`denomRem` 的做法。
- **`data.update_time`（Unix 毫秒）是 1965 特有、綠色沒有的欄位，但語意還沒有確定的驗證方法。** 原計畫想用「連續打兩次同一分店比較 `update_time` 是否改變」判斷，**這個測試本身不成立**（審閱意見 5）：值不變也可能只是快取或固定批次產生的回應時間，不能因此斷言是報價時間；值改變也不能排除「本來就每次重新產生回應時間，跟報價有沒有更新無關」。單靠打兩次無法判斷任何一種結果。要驗證只能：（a）長時間觀察 `update_time` 變化的時間點是否跟官網畫面上匯率數字實際變動的時間點吻合，或（b）找到來源對這個欄位的說明。**這是低優先度、可以晚點做的驗證**（見 §7.2），在驗證完成前，卡片一律只顯示「本次查詢時間」，不顯示「官網報價時間」，跟 §3.1 的預設行為一致。
- `sell_rate_amount` 只用作 buy／sell 兩欄一起出現時的判斷依據，比照綠色只取 buy（本功能只做「換出泰銖」方向，不使用 sell）。
- **同一套 API 的兩個端點 envelope 不一致（第四輪新增）**：`exchange-rate/get` 成功時回 `code: "SUCCESS"`，但 `exchange-rate/branch-list` 成功時回 `code: "200"`（見 §2.3 的實際回應）。解析層必須為兩個端點寫**各自獨立的 envelope 檢查**，不能共用一個「兩種都收」的 helper——那樣會讓 `exchange-rate/get` 也接受 `"200"`，等於放行不該放行的回應。
- **Request body 已確認格式，但識別碼是一套全新的、獨立的編號空間**（2026-09-09 使用者截圖）：

  ```json
  { "filters": [
      { "field": "company_code", "value": "A04" },
      { "field": "branch_no", "value": "51" }
  ] }
  ```

  `company_code` 目前看到固定是 `"A04"`（推測是這套後台系統裡代表「SuperRich 1965」這家公司的代碼——`/spr/*` 這個後台架構本身可能是多租戶／被多家換匯業者共用的系統，`A04` 就是 1965 在裡面的租戶代碼，這只是觀察，不影響本功能）。`branch_no` 是字串數字（`"51"`、`"52"`），**跟 `/spr/front/branches` 回應裡的 `id`（56、57…）或 `sorting`（0、1…）都對不起來，是完全獨立的第三套編號**——已經直接查證過 `/spr/front/branches`（含逐店的完整 JSON）跟 `/spr/front/branches/56`（單店 detail）都**沒有**任何欄位叫 `branch_no`／`code`／`company_code`，這套編號在分店清單 API 裡完全找不到對照。
  - **`exchange-rate/get` 的回應本身不回傳分店識別碼**——`data.datas[]` 只有幣別／面額資料，沒有像綠色的 `branchCode` 那樣可以核對「這筆報價是不是真的屬於我要的那間分店」。這個風險由 §2.3 的對照表解決：抓取前用對照表查出 `branch_no`，抓取後沒有二次核對手段，所以對照表本身必須正確且穩定（不能每輪重新猜）。

### 2.1 Cloudflare 可行性 spike（本次任務重點）——結論：低風險，但未 100% 排除

瀏覽器分頁載入官方頁面時，先看到一個 `POST /cdn-cgi/challenge-platform/h/g/jsd/oneshot/...` 請求，才接著看到 `/spr/front/*` 陸續回 200。這代表 Cloudflare 的 bot-management 腳本在跑，需要確認：一個**沒有瀏覽器、不執行 JS**的伺服端排程（未來的 Netlify Function）直接打這些端點，會不會被擋。

驗證方式：用 `WebFetch`（純伺服端 HTTP GET，不執行 JS、不帶瀏覽器 cookie／fingerprint）直接呼叫：

| 端點 | 方法 | 結果 |
| --- | --- | --- |
| `/spr/front/branches?page=1&limit=5` | GET | 乾淨回傳 JSON 分店資料，無 Cloudflare 驗證頁 |
| `/spr/front/system-setting` | GET | 乾淨回傳 JSON 公司資料，無 Cloudflare 驗證頁 |
| `/spr/front/branch-groups?page=1&limit=100` | GET | 乾淨回傳 JSON，無 Cloudflare 驗證頁 |
| `/spr/front/exchange-rate/get`（改用 GET，非其正式方法） | GET | 回一般 `404 client error`（JSON 層級的方法不符），**不是** Cloudflare 阻擋頁／驗證頁 |

**結論：** 沒有證據顯示 Cloudflare 會擋 server-side（無瀏覽器）請求打這批 `/spr/front/*` API；瀏覽器上看到的 challenge-platform 請求較可能是標準的背景風險評分／打點，不是強制擋 API 呼叫的關卡。**殘留風險**：無法排除 `exchange-rate/get` 這個具體端點在真正的 POST 請求下有更嚴格規則（GET 打它只驗證到「方法不符」，沒有驗證到「POST 通不通過」）。

**這一點原計畫打算等 Phase C 部署 Netlify Function 後才驗證，審閱意見 4 指出這樣太晚**——如果建完 Notion、寫完排程邏輯後才發現 POST 被擋，等於整段 B、C 的工都可能要重做。**改為 Phase A0 一開始就做一次最小 POST 驗證**（見 §6 Phase A0 的完成條件），確認過再往下走：

- 這個容器與 Claude 這邊能操作的裝置 shell（`device_bash`）對這個網域的 outbound 都被 proxy 擋掉（403），**不能**用來測；但這個限制只針對 Claude 工具走的那層 sandboxed VM，**使用者自己電腦上直接開的 Terminal（不透過 Claude 的裝置工具）沒有這層限制**，應該可以正常連到外網。
- **審閱意見糾正了原計畫把「本機終端機」跟「Netlify 執行環境」當成等價、任選一種就算完成的做法**：這兩者驗證的是不同的殘留風險。本機終端機用的是使用者自己家用／辦公網路的 IP，Cloudflare bot management 對它的風險評分，跟對 **Netlify Functions 實際跑在的雲端/資料中心 IP range** 完全不是同一件事——本機成功只能證明「這個 API 本身接受這個 request body 格式的 POST」，**不能**證明「排程之後從 Netlify 的 serverless 環境送同一個 POST 也會成功」，而後者才是這個 spike 真正想排除的風險，因為正式排程就是跑在 Netlify Functions 上。
- **正確驗證方式（兩步都要做，缺一不可）**：
  1. **本機終端機**先跑一個最小 Node/curl script，對 `POST https://www.superrich1965.com/spr/front/exchange-rate/get` 送 §2.3 已確認的 request body（例如 `branch_no: "00"`），確認拿到 `status_code: 200`／`code: "SUCCESS"` 的真實回應——這一步只是「先確認 API 本身能力沒問題」的快速前置檢查，**單獨這一步不算 A0 完成**。
  2. **在 Netlify 環境裡重跑同一個 POST**：建一個最小的 Netlify Function 丟上 Deploy Preview，用 `netlify functions:invoke` 或直接呼叫該 preview 的 function URL 觸發，確認同樣拿到 `status_code: 200`／`code: "SUCCESS"`。**這一步才是 A0 真正的完成條件**——Netlify 的執行環境本身有正常外網，但 IP 段跟一般使用者不同，是排程未來實際會用的環境，必須實際用它驗證過才算排除殘留風險，本機成功不能替代。
- 這兩步各只需要做一次、確認「POST 打得通」即可，不用在這階段就把重試／逾時／breaker 那些正式邏輯寫出來——那些留給 Phase C。
- **A0 兩步都必須由使用者執行，Claude 做不到（2026-09-09 實測確認）**：cloud container 與裝置端 sandboxed shell 對 `superrich1965.com` 的 GET 與 POST 都是 connection failure，且 `AGENTS.md` 也規定不主動 deploy。Claude 的交付是兩支 script（`scripts/superrich1965-a0-probe.mjs` 本機 CLI、`netlify/functions/superrich1965-a0-probe.mjs` Deploy Preview 用），使用者跑完把 JSON 結果貼回來判讀。**這兩支都是暫時性的，A0 記錄完就刪，且 Netlify 那支不可 merge 到 `main`。**
- probe 的通過標準不只是 HTTP 200：必須連 response 都能被 §4.3 的解析層解出可用的 USD／TWD 數字才算 `ok`，同時會嗅出 Cloudflare interstitial（HTML content-type／`Just a moment`／`challenge-platform`），避免把驗證頁誤判成成功。

其他查證：

- `https://www.superrich1965.com/robots.txt`：`User-agent: *`，`Disallow` 只涵蓋會員／登入／密碼重設／OAuth／付款成功等帳戶相關路徑，`Allow: /`，**沒有**封鎖 `/spr/front/*` 或任何資料路徑。跟綠色查證結果一致，沒有額外限制。
- Terms and Conditions（<https://www.superrich1965.com/en/terms-and-conditions>）：頁面內容由前端 JS 渲染，`WebFetch` 不執行 JS，只拿到 meta 標籤，**條款正文尚未查證**。跟綠色文件當初 §2.1 的處理方式一致：不能因為查不到就斷言「沒有限制」，也不能因為查不到就斷言「全面禁止」。這點必須在 Phase A 用瀏覽器分頁實際載入頁面內容才能查證，比照綠色的 R1／R2／R3 風險分類與應對方式（頻率限制、可辨識的 `User-Agent`、遵守 `Retry-After`、circuit breaker、隨時可停用）。

### 2.2 分店規模與分組——待確認的新問題

1965 有「Our Branch／總店」與「Partner Branch／合作夥伴」兩個分組，**綠色版本沒有這個概念**（綠色 26 間全部是同一品牌直營）。Partner Branch 可能是其他業者代操作的合作櫃台，品牌背書程度可能較低，匯率或服務品質未必等同直營店。

**已確認（2026-09-09）：第一版只收錄 Our Branch，Partner Branch 排除在外。** 如果之後要收錄，再另開一版計畫處理。

分店精確總數：先前兩次用 `WebFetch` 摘要工具讀 `/spr/front/branches` 得到「53 之 5」跟「27 筆」兩個互相矛盾的答案，是摘要模型在處理大型 JSON payload 時失真，不是來源資料本身有矛盾。**§2.3 從分店選單自己的 API 拿到準確數字：39 筆**，取代本節原先的猜測，以此為準。

### 2.3 分店識別碼對照表（已解決，2026-09-09）

`POST /spr/front/exchange-rate/branch-list` 就是官方分店選單背後的清單，使用者已截取其 **Response**：

```json
{
  "status_code": 200, "code": "200", "message": "filter branch success",
  "data": { "datas": [
    { "code": "00", "name": "Silom Plaza (สีลมพลาซ่า)", "branch_group_no": "", "company_code": "A04", "is_default": true },
    { "code": "51", "name": "The Emsphere 2nd Floor (...)", "branch_group_no": "", "company_code": "A04", "is_default": false }
  ], "total": 39 }
}
```

`code` 就是 `exchange-rate/get` request body裡的 `branch_no`。**錨點確認**：`code: "00"`、`is_default: true` 的是 Silom Plaza，跟 `/spr/front/branches` 的 `id: 56`／`sorting: 0`（Silom，也是預設分店）對得上，證實這兩份清單指的是同一批分店，只是編號系統不同。

- **`branch_group_no` 這個欄位在全部 39 筆都是空字串**，沒有直接標示「Our Branch」或「Partner Branch」——分組判斷還是要靠 `/spr/front/branches` 每筆的 `groups[].slug`，用這裡的 `name` 去比對，不能靠這份清單自己判斷。
- **`company_code` 不是恆定的 `"A04"`**：38 筆是 `"A04"`，唯一例外是 `code: "E52-01"`、`name: "Terminal 21 Pattaya"`、`company_code: "E52"`。這很可能是另一個法律實體（分公司／加盟／不同登記），也可能剛好落在「該不該收錄」的灰色地帶——建議 Phase A 對到 `/spr/front/branches` 的 `groups[]` 之後再決定，不要假設它一定算 Our Branch。
- **這份清單沒有座標／地址／照片**，只有 `code` 和 `name`（英文＋泰文）。Phase A 要拿完整地點資料，仍需要**用 `name` 去比對 `/spr/front/branches` 的 `title.en`**，兩邊的名稱格式不完全一致（例如這裡的 `"Central World"` 對 `/spr/front/branches` 的 `"CentralWorld"`，`"Big C Ratchadapisek"` 對 `"Big C Place Ratchadapisek"`），**必須人工逐筆核對**，不能自動字串完全比對，比照綠色當初逐店查證的做法（§9.2）。

**完整 39 筆對照（`code` → `name`，company_code 均為 `A04` 除非另外標註）：**

| code | name |
| --- | --- |
| 00（預設） | Silom Plaza |
| 03 | Central Ladprao |
| 04 | Platinum Pop |
| 05 | Central Bangna |
| 09 | Station One China Town |
| 11 | The Mall Bangkapi |
| 16 | MRT Sukhumvit |
| 17 | MRT Phra Ram 9 |
| 19 | Central Embassy |
| 20 | Seacon Square Srinakarin |
| 21 | MBK |
| 23 | Central Eastville |
| 26 | The Mall Bangkae |
| 27 | Bangkok Hospital |
| 34 | Central World |
| 35 | Ratchadamri 2 |
| 36 | Ratchadamri 1 |
| 40 | Big C Ratchadamri |
| 41 | MRT Chatuchak Park |
| 44 | The Mall Ngamwongwan |
| 45 | Central Pinklao |
| 46 | Seacon Bangkae |
| 47 | ICS |
| 48 | ICONSIAM |
| 49 | Riverside Plaza |
| 50 | Big C Ratchadapisek |
| 51 | The Emsphere 2nd Floor |
| 52 | Samitivej Sukhumvit Hospital |
| 53 | The Old Siam Plaza |
| 55 | Baan Silom |
| 56 | Around Lifestyle Station (ปตท.ประตูน้ำ) |
| 57 | One Bangkok |
| 58 | Imperial World Samrong |
| 59 | MRT Sanam Chai |
| 60 | MRT Kamphaeng Phet |
| 62 | Dusit Central Park |
| 63 | MBK Skywalk |
| 64 | THE EMSPHERE G FLOOR |
| E52-01（`company_code: E52`） | Terminal 21 Pattaya |

本表只作為建檔起點，跟綠色附錄§10 的定位一樣：正式名稱、樓層、座標仍須逐店比對 `/spr/front/branches` 後才能建 Notion。

## 3. 介面與圖示

### 3.1 沿用綠色已確認的規則

- 「顯示換匯點」開關預設關閉、持久化到 `localStorage`。
- 換匯分店不受類別／主題篩選影響，只套用公開狀態、換匯點開關、目的地、搜尋、收藏。
- 卡片與 popup 必須顯示雙語免責與來源標示（比照綠色 §3.2 的必要元素），文字需明確寫出「SuperRich Currency Exchange (1965) Company Limited.」全名，避免使用者把兩家公司搞混。
- 地圖標記點開才顯示匯率，標記本身不放價格；預設只顯示「本次查詢時間」——除非 Phase A 驗證 §2 的 `data.update_time` 確實是報價時間（不是回應產生時間），才額外顯示「官網報價時間」。
- 營業時間不維護、不排程，卡片提供 Google Maps 連結由使用者自行確認。
- 提供最佳匯率排序（USD、TWD 兩項，已依 §1 定案，比較範圍見 §3.3）。

### 3.2 與綠色不同、需要額外處理的部分

- **Marker 顏色是這次真正的新問題，不是新增一種顏色那麼簡單**：綠色當初的 §3.3 把 `makeMarkerContent(icon)` 從「無顏色」擴充成「有／無換匯顏色」兩種狀態（`isExchange: boolean`）。現在要從兩種狀態（無色／綠）變成三種（無色／綠／橘）。
  - **審閱意見 1 糾正了原計畫的做法，而且原計畫對「為什麼會壞」的解釋本身也是錯的**：原本打算把 `isExchangeLocation()` 從回傳 boolean 改成回傳品牌值（`'green' | 'orange' | null`）。**這樣改確實會壞掉，但原因不是「字串相減得到 `NaN`」**——`src/ui/render.js` 的 `sortVisibleIndexes()` 實際的比較器是：
    ```js
    if (leftExchange !== rightExchange) return leftExchange ? -1 : 1;
    ```
    若 `leftExchange`/`rightExchange` 改成品牌字串，`!==` 比較字串本身沒問題（不是相減，也不會得到 `NaN`）；真正的錯誤在後面的三元運算——只要 `leftExchange` 是任何非空字串（`'green'` 或 `'orange'`）都是 truthy，於是比較 (綠, 橘) 回傳 `-1`；反過來比較 (橘, 綠) 時 `leftExchange` 換成 `'orange'`，一樣是 truthy，**也回傳 `-1`**。兩個方向都回傳 `-1`，違反比較器必須反對稱（antisymmetric）的基本要求，`Array.sort()` 在這種矛盾比較器下的排序結果未定義、且與輸入順序相依（已用 Node 做最小驗證重現）。現有測試沒有涵蓋「綠橘混合排序」這個案例，不會被抓到。
  - **正確做法：`isExchangeLocation(): boolean` 的回傳型別維持不變，但實作內容必須擴充成同時認得兩個品牌**——目前 `src/features/exchange-rates.js` 的 `isExchangeLocation()` 只查 green 專屬的 `BRANCH_SLUGS`（來自 `data/superrich-branches.json`）。橘標上線後如果不改這個判斷依據，橘標分店的 slug（`superrich1965-*`）不會被判定為換匯地點——不只 marker 顏色不對，`src/ui/render.js` 的 `renderExchangeRates()`／`bestVisibleRate()` 一樣是靠 `isExchangeLocation()` 把關，會直接跳過橘標分店的整個匯率面板，等於橘標功能整個不會出現。
  - **但擴充 `isExchangeLocation()` 只解決一半，第四輪意見 13 指出剩下那一半更危險**：`renderExchangeRates()`（render.js:150-186）本身沒有任何品牌分派，橘標分店通過判斷之後拿到的是**綠標的面板**——`EXCHANGE_DENOMS` 寫死綠標三個 key（render.js:119）、`getExchangeRateCell()` 讀綠標的 `state.exchangeRatesBySlug`（橘標三列全部顯示為無資料）、`state.exchangeCompletedAt` 是綠標的查詢時間，而最嚴重的是 `OFFICIAL_EXCHANGE_URL`（render.js:118）寫死 `https://www.superrichthailand.com/exchange-rate`，**橘標的卡片會把使用者導到綠標官網**。所以 D1 除了 `getExchangeBrand()`，還必須讓 `renderExchangeRates()`／`bestVisibleRate()` 依品牌分派到各自的 denom 清單、rate lookup、時間戳與官網連結。
  - **第四輪意見 18**：`isExchangeLocation(value)` 的簽名是 `string | {id?: string}`，取的是 `.id` 不是 `.slug`（render.js 與 map.js 傳整個 row，`getExchangeRateCell` 傳 `row.id`）。`getExchangeBrand()` 必須支援同樣的兩種輸入形狀，否則呼叫端要逐處改寫。**修正方式**：新增 `getExchangeBrand(row): 'green' | 'orange' | null` 作為唯一的品牌判斷來源（查 green 的 `BRANCH_SLUGS` 聯集橘標新增的 `BRANCH_SLUGS_1965`），再把 `isExchangeLocation(row)` 改成 `getExchangeBrand(row) !== null`——對外回傳型別仍是 boolean，現有排序／篩選邏輯完全不用碰，但兩個品牌都會被正確識別。`getExchangeBrand()` 的回傳值只給 `makeMarkerContent`、HERE 的 `DataPoint` payload、Google 的 `clusterRenderer` 這些**畫顏色**用的地方讀取，不進入任何排序／比較邏輯。CSS 新增 `.marker-dot.is-exchange-orange{--marker-bg:#f26622;...}`（不能沿用綠色專用的 `.is-exchange` class，會撞色）。
  - **cluster 著色（第四輪意見 15，2026-09-09 使用者定案：三態）**：不沿用 `.is-exchange` 的直接後果是，`isExchangeOnlyCluster()`（map.js:296，靠 `classList.contains('is-exchange')`）與 HERE 端的 `isExchangeOnlyDataPoints()`（map.js:337，靠 `getData().isExchange !== true`）都會把**全橘標的 cluster 判成 false**，退回無色的一般 cluster。**定案做法**：把這兩個 boolean 判斷改成回傳品牌的函式（`'green' | 'orange' | null`），全綠→綠、全橘→橘、**混合→中性（沿用現有無色樣式）**。Google 的 `clusterRenderer` 與 HERE 的 cluster theme 兩邊都要同步改，且既有的 cluster 著色測試需要一併擴充。
  - **§7 測試計畫新增一項**：混合綠色＋橘色資料的排序回歸測試（驗證 `sortVisibleIndexes` 在兩品牌並存時仍給出穩定、跟輸入順序無關的排名），不能只測單一品牌。
- **已確認（2026-09-09）：類別（Category）維持單一「換匯／Currency Exchange」**，不拆成兩個品牌各自的類別——篩選邏輯不變，使用者體驗一致；改用**marker 顏色 + 卡片上的公司全名**區分兩家公司，而不是靠使用者自己認品牌顏色。

### 3.3 跨品牌最佳匯率排序範圍（新增，審閱意見 3）

原計畫「提供 USD、TWD 兩項排序」沒有說清楚兩個品牌的面額分桶形狀不同時要怎麼一起比較——**這不是小事，處理不好會讓使用者誤以為排名適用於他手上的鈔票面額**：

- 綠色 USD 分兩個獨立排序選項：`USD_100`、`USD_50`；橘色只有一個合併 bucket（原始欄位 `100-50`），沒有辦法拆成「只對應 100 元」或「只對應 50 元」。TWD 同理：綠色現有排序 key 是單一的 `TWD`（對應 `src/data/exchange-rates.js` 的 `SOURCE_DENOMS.TWD.denomRem = '2000 - 100'`——**先前版本這裡寫成 `TWD_2000_100`，是跟現有程式碼不符的錯誤 key 名稱，已修正**），橘色是合併桶 `1000-100`，橘色的報價**不能**被呈現成「也適用於 2000 元鈔票」。
- **決定（2026-09-09 使用者確認，已定案）**：排序選項不合併兩品牌的桶。以下補上排序 key 到品牌／實際欄位的對應（**審閱意見 2 要求的映射，D1 動工前必須以此為準**）：

  | 排序 key | 品牌 | 來源欄位 | 對應的 lookup |
  | --- | --- | --- | --- |
  | `USD_100` | 綠色 | `SOURCE_DENOMS.USD_100`（`unit:USD, denomRem:100`） | 既有 `getExchangeRateCell(slug, 'USD_100')` |
  | `USD_50` | 綠色 | `SOURCE_DENOMS.USD_50`（`unit:USD, denomRem:50`） | 既有 `getExchangeRateCell(slug, 'USD_50')` |
  | `TWD` | 綠色 | `SOURCE_DENOMS.TWD`（`unit:TWD, denomRem:'2000 - 100'`） | 既有 `getExchangeRateCell(slug, 'TWD')` |
  | `USD_1965`（原提案 `USD_100_50`，改名避免跟綠色 `USD_100` 混淆） | 橘色 | `denom_list` 中 `show_denom:'100-50'` 的 bucket | 新增橘色專屬 lookup（暫定 `getExchangeRateCell1965(slug, 'USD_1965')`，實際命名依 §4.4 定案） |
  | `TWD_1965`（原提案 `TWD_1000_100`，同上理由改名） | 橘色 | `denom_list` 中 `show_denom:'1000-100'` 的 bucket | 新增橘色專屬 lookup（暫定 `getExchangeRateCell1965(slug, 'TWD_1965')`） |

  `state.exchangeSort` 現有型別是 `'default'|'USD_100'|'USD_50'|'TWD'`（`src/features/exchange-rates.js` 的 `ExchangeSort` typedef），D1 要擴充成同時接受橘色的兩個新 key。**但 typedef 只是型別，真正的守門員是 `EXCHANGE_SORT_VALUES`（第四輪意見 14）**：`src/features/exchange-rates.js:13` 的 `EXCHANGE_SORT_VALUES = Object.freeze(['default', ...DENOMS])` 是從綠標的 `DENOMS` 衍生出來的，而 `initExchangeRates()` 的 select handler 用 `isExchangeSort(sort.value)` 過濾，**任何不在這個陣列裡的值都會被靜默降級成 `'default'`**——`USD_1965`／`TWD_1965` 沒有進這個常數，選項就完全點不動，而且不會有任何錯誤訊息。D1 要先決定這個常數是改成兩品牌聯集、還是橘標另立一個，再談 typedef。此外，`sortVisibleIndexes()`／`bestVisibleRate()` 需要依排序 key 判斷該去查哪個品牌的 rate cell（key 屬於橘色時，只在 `getExchangeBrand(row) === 'orange'` 的資料列上取值，綠色資料列一律視為「無此排序資料」，反之亦然）——這是實際要寫的 if/else 分支，不是只有「新增兩個排序選項」這句話帶過。使用者選某個排序選項時，另一品牌的分店一律排在「無此排序資料」那一段（沿用綠色 §3.4 現有「有該項報價的分店在前、無的在後」規則），不是被排除，只是不參與該次比較。
- 面額標籤要明確標出品牌與實際鈔票面額（例如「SuperRich 1965：USD 100+50」而不是只寫「USD」），卡片上的免責文字也要涵蓋「不同分店可能有不同面額組合」這一點。
- 缺值與「最佳」標示規則沿用綠色既有邏輯（同分桶內比較，缺值不參與），只是分桶範圍照上面拆開。

## 4. 資料分工

- **分店基本資料**：Notion 建檔（已定案）。1965 官方 API 的欄位（地址／電話／營業時間／經緯度／相片）直接可以拿來輔助填 Notion，比綠色當初純靠人工上網逐店核對容易很多——但**營業時間欄位比照綠色規則，不建入 Notion、不維護**（§3.1），只是說「查證時比較快確認地址跟樓層資訊」。
- **Slug 命名**：`superrich1965-{官方id}`（比照綠色 `superrich-thailand-{id}` 的命名慣例），例如 `superrich1965-56`。
- **對照檔**：新建 `data/superrich1965-branches.json`，跟既有 `data/superrich-branches.json` 平行、**不合併**。理由：1965 目前看到的官方 ID 是純數字（`56`、`57`…），沒有看到綠色那種字母＋數字的 `branchCode`（`H01`／`M17` 等）概念；對照檔要存哪些欄位得等 Phase A 確認 `exchange-rate/get` 的實際回應格式後才能定案，現在先不假設格式跟綠色一致。
- **匯率快照儲存**：需要獨立的 Netlify Blobs key 命名空間（例如 `exchange-rates-1965/*`），不能跟綠色共用 key，避免兩邊的 `control`／`breaker`／快照版本互相干擾。

### 4.4 前端狀態隔離與共用資源的責任歸屬（新增，審閱意見 2）

「獨立一套」是指**程式碼／後端儲存**平行複製，但原計畫沒有講清楚**前端 runtime 狀態**跟**共用 UI 元素**怎麼分——這兩者處理不好，會出現「橘色更新／停用／過期時，把綠色的報價也清掉」這種互相打架的問題：

- **`src/core/state.js` 現況**：`exchange-rates.js` 直接讀寫 `state.exchangeRatesBySlug`、`state.exchangeRatesEnabled`、`state.exchangeCompletedAt`、`state.exchangeNextUpdateAtMs`、`state.exchangeExpiresAtMs`、`state.exchangeSort` 等欄位，這些是單一組欄位，不是以品牌分開的結構。實測統計：`state.exchange*` 全專案共 **96 個引用點**（`src/features/exchange-rates.js` 72、`src/ui/render.js` 11、`src/map/map.js` 2），其中 **51 個是賦值**。

**已定案（2026-09-09 使用者確認）：橘標用單一巢狀物件 `state.exchange1965.*`，綠標欄位一個都不動。**

- 14 個 exchange 欄位裡，`exchangeLocationsOn` 與 `exchangeSort` 依下方「共用 DOM 元素」的定案本來就是**兩品牌共用**，不分品牌；真正需要一式兩份的是其餘 **12 個**。
- 橘標把這 12 個收進 `state.exchange1965`（`ratesBySlug`／`runId`／`controlVersion`／`enabled`／`completedAt`／`nextUpdateAtMs`／`expiresAtMs`／`retryLevel`／`lastAttemptAtMs`／`updateCheckPending`／`ratesLoading`／`hasUsableSnapshot`），`state.js` 只多一個 top-level 欄位，綠標的 96 個引用點 0 改動。
- **選這個而不是 flat prefix（`exchange1965RunId` 等 12 個平行欄位）的實質理由，是 §4.4 的隔離驗收條件**：綠標現行的 `expireExchangeRates()` 手動清 5 個欄位、`applyExchangeRatesPayload()` 在 `!enabled` 與 `!snapshot` 兩個分支各手動清 7～10 個（51 個賦值點的由來）。這種「加新欄位時忘記在某個清空分支也清掉」正是最容易漏的 bug，flat prefix 等於把這個模式再複製一次；巢狀物件讓「停用／過期整個品牌」變成 `state.exchange1965 = emptySnapshot1965()` 一行賦值，型別系統保證不會漏欄位。
- 代價（已接受）：橘標 module 跟綠標不再是逐行對照的機械複製品，`state.exchangeX` 對應到 `state.exchange1965.x`。這是一次性的改名，不影響用 cross-module 等價測試守住行為一致（比照 `parseRateText` 的做法）。
- 未採用**全巢狀**（`state.exchange = { green, orange }`）：結構最乾淨，但要改動已上線綠標的 77 個引用點，回歸風險集中在能跑的功能上，違反 §1「不影響已上線的綠色功能」。
- 兩品牌的計時器、retry level、breaker 狀態一律各自獨立運作，不共用任何一個。
- **共用 DOM 元素**：目前只有一個「顯示換匯點」開關（`#exchange-toggle`）跟一個排序下拉選單（`#exchange-sort`），是綁定在單一組換匯狀態上。兩品牌並存後，這個開關的語意要先定案：是「兩品牌共用一個開關（開了兩個都顯示）」還是「各自一個開關」？**已定案（2026-09-09 使用者確認）：維持單一開關 + 單一排序 select。**

- 「顯示換匯點」開關維持一個，開了兩品牌的分店一起顯示。
- 排序 select 也維持一個，但可見性與選項狀態要拆開看：**可見性取兩品牌的聯集**（只要任一品牌有可用快照就顯示），**每個 option 的 `disabled` 只看它自己所屬品牌**的 `enabled`／`hasUsableSnapshot`。
- **第四輪意見 17 指出這裡有一個比 option disable 更前面的短路**：`syncExchangeControls()`（`src/features/exchange-rates.js:363`）現在寫的是 `sort.hidden = !state.exchangeLocationsOn || state.exchangeRatesEnabled === false`——綠標一被管理者停用，整個 select 直接 `hidden`，橘標的排序選項跟著消失。這條 `hidden` 判斷必須先改成看兩品牌聯集，光改 option 的 `disabled` 不夠。
- 同理，`syncExchangeControls()` 開頭的 `if (!state.exchangeHasUsableSnapshot) state.exchangeSort = 'default';` 也是綠標專屬條件，橘標排序選項會在綠標沒有快照時被強制重設，一併要改成品牌感知。
- **驗收條件（新增進 §6 D1 與 §7 測試計畫）**：任一品牌的排程故障、管理者停用，或快照過期，**必須不影響另一品牌**——另一品牌的分店、報價、排序、marker 都必須維持正常顯示。這一條要能被自動測試覆蓋，不是只靠肉眼檢查。

## 5. 抓取排程與失敗處理——沿用治理框架，細節數字待 Phase A 定案

沿用綠色整體設計哲學：兩個獨立 Netlify Function（排程抓取 + 對外唯讀 API）、跨輪次 circuit breaker、執行期 control flag、強一致讀取、`Cache-Control: no-store`。**這節目前只能定調方向，不能像綠色文件一樣寫死頻率／併發／逾時數字**，理由：

1. `exchange-rate/get` 一次請求只回單一分店的全部幣別（§2 已確認回應結構），跟綠色一樣是「一間分店一個請求」。`exchange-rate/branch-list` 目前回傳 39 筆，但**審閱意見指出這 39 筆還不能當作「已排除 Partner Branch 後」的數字**——`branch_group_no` 全部是空字串（§2.3），這份清單本身沒有標示 Our Branch／Partner Branch，分組要等 A1 用 `/spr/front/branches` 的 `groups[]` 交叉核對後才能定案，結果可能等於 39、也可能比 39 少（如果這 39 筆裡混了 Partner Branch）。因此每輪來源請求數目前只能**以 39 當上限估算**，不是原先猜測的「規模不明」，但也還不是已確認排除 Partner Branch 後的定案數字；估算上仍比綠色的 27 間略多，頻率／併發預算需要重新算，不能直接套用綠色的數字，也不能在 A1 完成分組核對前把 39 當成定案。
2. §2.1 前移的最小 POST 驗證（審閱意見 4）還沒做，在確認 POST 真的能穩定成功之前，重試／退避／breaker 的具體門檻數字寫了也可能是空想。

Phase A0 完成 POST 驗證、**Phase A1 用 `groups[]` 核對完實際 Our Branch 收錄分店數後**（39 只是上限估算，見上方第 1 點，實際數字可能比 39 少），再依那個確認後的分店數，比照綠色 §5 的框架（cron 頻率、單輪併發上限、逾時／重試預算、403/429 優先退避、control flag 讀取順序等）填入具體數字，不在本次文件先寫死、也不先用 39 這個估算值定案。

## 6. 分階段實作

| 階段 | 工作 | 主要檔案／範圍 | 完成條件 |
| --- | --- | --- | --- |
| A0 | **最小 POST 可行性驗證（審閱意見 4，其他 Phase A 工作前的門檻）**：先在使用者自己終端機對 `exchange-rate/get` 送一次真實 POST（`branch_no: "00"`）做前置檢查，**再**於 Netlify Deploy Preview 的 Function 環境重跑同一個 POST。**兩步都必須由使用者執行（意見 19）**，Claude 交付 script 與判讀 | `scripts/superrich1965-a0-probe.mjs`（本機 CLI，已交付）＋`netlify/functions/superrich1965-a0-probe.mjs`（Deploy Preview 用，已交付；標記 TEMPORARY、不可 merge 到 `main`，A0 記錄完連同前者一併刪除） | **Netlify 環境**拿到真實 200／SUCCESS 回應、且能解析出可用的 USD／TWD 數字，並存下 request／response 紀錄（本機成功僅為前置檢查，不能取代這一步，見 §2.1）；沒過就要重新評估整個排程可行性，不進 A1 剩餘工作 |
| A1 | 固定來源 contract、純資料解析與驗證；用 §2.3 的 39 筆對照表比對 `/spr/front/branches` 的 `groups[]`，定案 Our Branch 名單（含 `E52-01` 該不該收） | `src/data/exchange-rates-1965.js`、`tests/exchange-rates-1965-source.test.mjs`、`tests/fixtures/superrich1965/`、`jsconfig.json` 與 `tests/typecheck-config.test.mjs` 的 allowlist | **解析層已完成（2026-09-09）**：USD/TWD 分桶對應清楚、兩端點各自的 envelope 檢查、29 個測試通過。**剩餘**：用 `groups[]` 核對 39 筆的 Our Branch／排除名單定案（需 A0 通過後連線取得 `/spr/front/branches`） |
| B | 整理 Our Branch 分店、去重、正式建入 Notion；**新增橘標專屬的對照驗證 script**（審閱意見 16） | Notion、既有 exporter、`data/locations.csv`、`data/superrich1965-branches.json`、新增 `scripts/validate-superrich1965-mapping.mjs` | 所有收錄分店有唯一對照、有效座標、來源連結；**橘標對照檔與 `data/locations.csv` 的收錄名單逐筆一致**，且該驗證納入 pre-push gate——`scripts/validate-superrich-mapping.mjs` 只認綠標，不涵蓋橘標 |
| C | 建立定時抓取、breaker、control flag、獨立快照 | 新增 `netlify/functions/exchange-rates-1965-fetch.mjs`／`exchange-rates-1965.mjs`、獨立 Blobs key 命名空間 | 部署後**人工觸發第一輪**並核對成功；比照綠色的失敗降級與退避規則 |
| D1 | 新增 `.is-exchange-orange` CSS；新增 `getExchangeBrand()`（支援 `string \| {id}` 兩種輸入，意見 18）並把 `isExchangeLocation()` 改成委派給它（`isExchangeLocation(row) = getExchangeBrand(row) !== null`——**對外回傳型別維持 boolean，呼叫方／排序邏輯不用改**，但函式內部實作要調整成同時認得兩品牌，見 §3.2）；**`renderExchangeRates()`／`bestVisibleRate()` 依品牌分派 denom 清單、rate lookup、時間戳與官網連結（意見 13）**；**cluster 三態著色，Google 與 HERE 同步（意見 15）**；**`EXCHANGE_SORT_VALUES` 納入橘標 key（意見 14）**；**`syncExchangeControls()` 的 `hidden` 與 sort 重設改成兩品牌聯集（意見 17）**；§4.4 的 `state.exchange1965` 狀態隔離；§3.3 的跨品牌排序範圍；卡片／popup 顯示公司全名與免責 | `src/core/state.js`、`src/features/`、`src/ui/render.js`、`src/map/map.js`、`src/core/i18n.js`、`styles.css` | 綠色既有行為（含排序、cluster 著色）不受影響；橘標卡片顯示自己的匯率、時間與**橘標官網連結**；marker 與 cluster 在 Google/HERE 一致；任一品牌故障不影響另一品牌（§4.4 驗收條件） |
| E | 測試、上線手冊 | `tests/`、README、`note/TECH_DECISIONS.md` | 涵蓋：混合品牌排序回歸測試（§3.2）、任一品牌故障隔離測試（§4.4，含綠標停用時橘標排序仍可用）、跨品牌篩選／cluster 三態著色回歸測試、**橘標卡片不得出現綠標官網連結的回歸測試**（意見 13） |

## 7. 決定紀錄與剩餘開放問題

### 7.1 已決定（2026-09-09）

1. 幣別範圍：只做 USD／TWD。
2. Partner Branch：第一版排除，只收 Our Branch。
3. Currency Exchange 類別：維持單一類別，靠 marker 顏色＋卡片上的公司全名區分兩家公司。

4. **分店識別碼對照表已解決**（§2.3）：`POST /spr/front/exchange-rate/branch-list` 的回應就是完整的 `branch_no` ↔ 分店名稱對照表，共 39 筆。

**第四輪後追加定案（2026-09-09）：**

5. **cluster 三態著色**：全綠→綠、全橘→橘、混合→中性，Google 與 HERE 同步（§3.2）。
6. **排序控制項**：維持單一 select，可見性取兩品牌聯集，每個 option 的 disabled 只看所屬品牌（§4.4）。
7. **跨品牌排序 key 拆開不合併**：新增 `USD_1965`／`TWD_1965`，不跟綠標的桶混在同一個排名裡（§3.3）。
8. **state 欄位命名**：橘標用單一巢狀物件 `state.exchange1965.*`，綠標欄位一個都不動（§4.4）。

### 7.2 剩下的兩件小事（均不卡動工）

9. `code: "E52-01"` 的 Terminal 21 Pattaya（`company_code: "E52"`，跟其他 38 筆的 `"A04"` 不同）算不算 Our Branch？需要對照 `/spr/front/branches` 的 `groups[]` 判斷，Phase A1 剩餘工作會一起定案，不需要現在決定。
10.（次要，可以晚點）`data.update_time` 的語意還沒驗證，且原先「打兩次比較」的方法本身不成立（見 §2 修正說明）——優先度低，即使一直沒驗證，卡片預設行為（只顯示「本次查詢時間」）也不受影響，不會卡到任何 Phase。解析層已經把這個值解出來放在 `sourceUpdatedAtMs`，但明確標註語意未驗證、UI 不得當作「官網報價時間」顯示。

**沒有卡著的開放問題——目前卡在 Phase A0 的兩步 POST 驗證，需要使用者執行（§2.1、§6 A0）。**

## 8. 本次交付界線

§2、§2.1、§2.2 的查證结果來自 2026-09-09 透過瀏覽器分頁與 `WebFetch` 的唯讀存取，沒有使用帳號、Cookie 或第三方憑證；本節不構成法律意見（比照綠色文件 §2.1 的免責寫法）。

**已完成（2026-09-09）：**

- 四輪計畫審閱（第四輪逐項比對實際程式碼，見文件開頭意見 13–19）。
- **Phase A1 的純解析層**：`src/data/exchange-rates-1965.js`（無 network／DOM／storage）、`tests/exchange-rates-1965-source.test.mjs`（29 測試）、`tests/fixtures/superrich1965/`，並把新模組加進 `jsconfig.json` 的 typecheck allowlist（`tests/typecheck-config.test.mjs` 逐字斷言該陣列，必須同批修改）。驗證：`npm run typecheck` 通過、`npm test` 437 全通過。
- **Phase A0 的兩支 probe script**（暫時性，A0 記錄完即刪）。

**尚未動的**：Notion 資料、Netlify 設定、任何前端／UI 程式碼（D1 之後才碰）。`src/data/exchange-rates-1965.js` 目前沒有被 `src/main.js` import，不在 bundle graph 內。

**兩個實作面的註記：**

- `parseRateText1965()` 是綠標 `parseRateText()` 的**刻意複製**（§1 的「平行複製一份」），不是 import。代價是 BigInt 進位邏輯有兩份、可能長歪，因此補了一個 cross-module 等價測試逐一比對兩個 parser 在同一組輸入向量下的輸出，發散就紅燈。
- **橘標補不上綠標那道 identity guard**：綠標每一列都有 `branchCode`，`parseBranchExchange()` 拿它交叉核對，所以 A 店的數字不可能掛在 B 店名下；橘標的回應**完全沒有分店識別碼**，`branchNo` 只是從 caller 回填的。唯一防線就是 `data/superrich1965-branches.json` 對照表本身正確——這放大了審閱意見 16 的嚴重性，Phase B 的橘標 validator 不是可選項。

**下一步**：使用者執行 §2.1／§6 列的本機＋Netlify 兩步 POST 驗證（Claude 無法執行，見意見 19），結果判讀後接 A1 剩餘的 `groups[]` 分組核對。
