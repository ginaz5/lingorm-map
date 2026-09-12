# SuperRich 1965（橘標）USD／TWD 換匯地圖實作計畫

建立日期：2026-09-09；更新日期：2026-09-11。狀態：**M1～M5 本機實作、38 筆正式建檔與資料發布已完成**。Phase C 尚待 Deploy Preview 人工觸發首輪匯率快照，Phase D1 的 HERE fallback 本機驗收已通過，Google Maps 驗收待辦。進度與驗證見 [進度紀錄](superrich1965-exchange-map-progress.zh-TW.md)。

已完成四輪審閱（共 19 點，全部採納）。本文只保留現行決定，完整審閱歷程見 [審閱摘要](superrich1965-exchange-map-plan-revisions.zh-TW.md)——本文出現的「審閱意見 N」「意見 N」都是指該檔的編號。

本文件延續已上線的 [綠色 SuperRich 換匯計畫](superrich-exchange-map-plan.zh-TW.md)（`superrichthailand.com`）的方法論，但目標是另一家公司、另一套 API，因此另立文件，不在原文件上加註。

本功能讓使用者在現有踩點地圖上找到 **SuperRich Currency Exchange (1965) Company Limited.**（`superrich1965.com`）分店，查看報價並與已上線的綠色 SuperRich 並存。**這兩家是完全不同的公司**，只是品牌名稱相似；Chinese-speaking 旅遊社群慣稱前者「綠色 SuperRich」、後者「橘 SuperRich／SuperRich 1965」。

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

### 2.1 A0：最小 POST 可行性驗證與收尾

A0 的驗收範圍是確認 `POST /spr/front/exchange-rate/get` 能在本機與 Netlify Deploy Preview 執行，回傳 `200 / SUCCESS`，且解析出可用的 USD／TWD。兩個環境都需有實測紀錄；排程長期穩定性另在 Phase C 驗證。

2026-09-10 使用者已提供兩步成功結果，符合此門檻。較早的 Netlify 單一 POST 曾收到 403 HTML；後來的 Netlify 診斷矩陣中，GET `/branches` 收到挑戰頁，兩個 POST 則成功。逐筆結果見 [進度紀錄](superrich1965-exchange-map-progress.zh-TW.md)，請求設定與使用者貼出的 probe JSON 保存於 [A0 實測紀錄](evidence/superrich1965-a0-2026-09-10.json)。紀錄中的 `bodySnippet` 是截斷內容，沒有完整上游 response body。

這些結果的判讀範圍如下：

- Netlify 已能取得真實匯率；同一匯率端點曾失敗也曾成功。具體攔截規則、出口 IP 與重現條件仍未確認。
- 新舊 probe 的匯率 URL、method、body 與明訂 headers 相同，但新矩陣在匯率請求之前多了兩次請求與間隔。不能把成功歸因於改版，也不能據此認定請求順序是原因。
- GET 與兩個 POST 使用不同路徑、不同 body，這次差異不能證明「GET 被禁、POST 一律放行」。本次使用者提供的本機紀錄只有匯率 POST，本機 GET 的可用性仍待 A1 查證。
- `cf-mitigated: challenge` 可確認 Challenge Page；HTML 摘要本身不能確認挑戰類型。觸發來源可能包括 WAF、Bot Management 或限流，缺少 `Retry-After` 也不能排除限流。參考 [Cloudflare 挑戰辨識](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/) 與 [觸發來源](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/)。
- 兩次成功結果的 `update_time` 相同，仍可能是報價、快取或批次回應的時間，沿用 §2／§7.2 的未確認狀態。

A0 收尾時移除 `scripts/superrich1965-a0-probe.mjs` 與 `netlify/functions/superrich1965-a0-probe.mjs`。歷史實作可從 Git commit `f7239b6` 查閱，實測紀錄供離線分析使用。移除工作區檔案不會撤下已部署的 Preview；既有 Preview 的處理由後續明確授權的部署或清理處理。此收尾不新增部署。

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
- **對照檔**：新建 `data/superrich1965-branches.json`，跟既有 `data/superrich-branches.json` 平行、**不合併**。理由：1965 目前看到的官方 ID 是純數字（`56`、`57`…），沒有看到綠色那種字母＋數字的 `branchCode`（`H01`／`M17` 等）概念；對照欄位已定案為 `officialId`、保留前導零的字串 `branchNo`、`companyCode`；第一版全部為 `A04`。橘標 validator 同時核對 Slug／官方 ID／報價代碼與已審閱來源，並反向檢查 CSV 是否多出未對照的橘標分店。
- **匯率快照儲存**：需要獨立的 Netlify Blobs key 命名空間（例如 `exchange-rates-1965/*`），不能跟綠色共用 key，避免兩邊的 `control`／`breaker`／快照版本互相干擾。

### 4.1 Phase B 正式建檔範圍（2026-09-10）

- 官方分店目錄 53 筆：41 Our Branch、12 Partner。報價清單 39 筆中有 38 筆 Our Branch（A04）及 1 筆 Partner（E52-01／Terminal 21 Pattaya）。第一版收錄 38 筆；完整配對與排除理由見[逐店查證](superrich1965-branch-verification.zh-TW.md)。
- Our Branch 中的 Vibhavadi 22（id 87）、Airport Rail Link Suvarnabhumi（94）、Airport Rail Link Phaya Thai（95）沒有出現在當前報價清單，列待補清單；不猜測 `branchNo`。
- 沿用綠標 §4.2／§9.2 的正式欄位範本：`Category=Currency Exchange`、`Type` 空白、`Icon=💱`、`Source Tags` 空白；初始 `Status=Paused`、`Review Needed=true`、`Last Verified` 空白。Google Maps 使用官方 iframe 的分店 CID 連結，Google Place ID 尚未獨立取得則留空，兩種識別碼不可混用。
- Lat／Lng 初建時保存官方分店 API 同一筆的成對原值並記來源；**Phase B 機器驗證只證明數值格式與欄位一致，不等於櫃位位置已核實**。2026-09-11 依使用者審核決議，13 筆疑點座標採用已由官方 iframe CID 核對身份的 Google Place ID 所回傳 Places Details 座標；其餘保留既有座標。
- 對照與已匯出 CSV 的雙向名單驗證納入 `npm test`（pre-push／CI gate）與 `build.sh`。38 筆初始皆不公開；2026-09-11 完成審核後全部轉為 Published。

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

## 5. 抓取排程與失敗處理

沿用綠標的排程抓取、對外唯讀 API、獨立快照、執行期 control flag、強一致讀取與 `Cache-Control: no-store`。Phase C 依 38 店固定對照定案為每半小時（UTC `:00`／`:30`）一輪、最多 2 個同時請求、請求起始至少相隔 200ms、單請求 5 秒、整輪 25 秒；整輪只允許 1 次 5xx／網路／逾時重試。2026-09-11 單店本機 POST 實測為 HTTP 200、約 0.19 秒；這筆樣本只用於確認預算有餘裕，不代表長期穩定性。

`exchange-rate/get` 每次只回單一分店。39 筆是 `branch-list` 的清單筆數；A1 已核對其中 38 筆 Our Branch 納入第一版，排程請求預算以這 38 筆計算。

A0 留下的限制與 Phase C 處理結果：

- 每次請求只記錄有界的 status、`cf-mitigated`、content-type、`Retry-After` 與 Ray ID；不記錄完整來源 body。公開 `unavailableReason` 固定為 `timeout`、`invalid`、`missing`、`http_error`、`expired`，診斷 header 不進公開快照。
- 403、429 或 `cf-mitigated: challenge` 立即中止整輪且不重試。跨輪依序退避 6 小時、24 小時，第三次自動停用；`Retry-After` 若更晚則尊重更晚時間。一般整輪失敗連續三次時暫停 1 小時。
- 缺少 `Retry-After` 時仍套用上述 6／24 小時退避；5xx、網路與逾時只在整輪首輪全部完成後挑一筆重試，4xx 與契約不符不重試。
- 驗收須涵蓋先成功後受挑戰、部分分店失敗、快照到期與管理者停用，並確保橘標故障不影響綠標。
- 自動請求維持可辨識的 User-Agent；不增加挑戰解題、瀏覽器身分偽裝或代理切換機制。

`GET /branches` 用於 A1／B 的分店建檔。正式匯率排程依已核對的固定對照檔抓取，不在每輪重新取得或猜測分店對照。

## 6. 分階段實作

| 階段 | 工作 | 主要檔案／範圍 | 完成條件 |
| --- | --- | --- | --- |
| A0 | 本機與 Netlify 的最小 POST 可行性驗證；保存請求與回應紀錄，收尾時移除暫時 probe | [A0 實測紀錄](evidence/superrich1965-a0-2026-09-10.json)、進度紀錄；probe 歷史版本為 `f7239b6` | **已通過並完成本機收尾（2026-09-10）**：兩個環境取得 `200 / SUCCESS` 與可解析的 USD／TWD，probe 已自工作區移除。長期穩定性待 Phase C；既有 Preview 尚未撤下 |
| A1 | 固定來源 contract、純資料解析與驗證；用 §2.3 的 39 筆對照表比對 `/spr/front/branches` 的 `groups[]`，定案 Our Branch 名單（含 `E52-01` 該不該收） | `src/data/exchange-rates-1965.js`、`tests/exchange-rates-1965-source.test.mjs`、`tests/fixtures/superrich1965/`、`jsconfig.json` 與 `tests/typecheck-config.test.mjs` 的 allowlist | **解析層已完成（2026-09-09）**：USD/TWD 分桶對應清楚、兩端點各自的 envelope 檢查、29 個測試通過。**分組核對亦完成（2026-09-10）**：38 筆 Our Branch 收錄、E52-01 Partner 排除；3 間未列報價的 Our Branch 暫緩，見 §4.1 |
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

### 7.2 待確認事項

9. **已解決（2026-09-10）**：Terminal 21 Pattaya 的 `groups[]` 為 `partner`（id 106），依第一版規則排除 `E52-01`。
10.（次要，可以晚點）`data.update_time` 的語意還沒驗證，且原先「打兩次比較」的方法本身不成立（見 §2 修正說明）——優先度低，即使一直沒驗證，卡片預設行為（只顯示「本次查詢時間」）也不受影響，不會卡到任何 Phase。解析層已經把這個值解出來放在 `sourceUpdatedAtMs`，但明確標註語意未驗證、UI 不得當作「官網報價時間」顯示。

A0／A1 已完成，38 筆正式資料已建檔、完成位置審核並發布。Phase C 的抓取預算及失敗處理依 §5 定案。

## 8. 本次交付界線

§2 的來源格式查證包含 2026-09-09 的瀏覽器／唯讀存取紀錄與使用者提供的樣本；§2.1 的 A0 結果來自使用者於 2026-09-10 提供的本機及 Netlify probe 輸出。收尾時未重新請求來源，也未取得新的完整上游回應。

本文件是規格，不記進度。已完成的工作、驗證結果、每個階段的未解問題，一律見 [進度紀錄](superrich1965-exchange-map-progress.zh-TW.md)；歷次審閱提出什麼、怎麼改的，見 [審閱摘要](superrich1965-exchange-map-plan-revisions.zh-TW.md)。

**目前的交付界線**：A0／A1、正式建檔、Phase C 後端、Phase D1 前端與 Phase E 測試手冊的本機工作均已完成。38 筆 Place ID 已用官方 Maps CID 逐店交叉核對；13 筆疑點座標依使用者決議採用 Place ID 座標，全部分店已為 Published。Phase C 尚未部署、啟用或產生正式匯率快照，HERE fallback 實際瀏覽器驗收已通過，Google Maps 驗收待完成。

**下一步**：完成 Published 橘標的 Google Maps marker、卡片與排序驗收。Deploy Preview 保持 `EXCHANGE_RATES_1965_ENABLED` 未設定／false，先驗證停用回應，再由管理 CLI 人工啟用及觸發第一輪，核對 38 店快照後決定是否維持啟用。
