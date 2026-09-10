# SuperRich 1965（橘標）換匯地圖實作計畫：審閱摘要

本檔記錄 [SuperRich 1965（橘標）USD／TWD 換匯地圖實作計畫](superrich1965-exchange-map-plan.zh-TW.md) 歷次審閱提出的問題與採納後的修法。計畫本文只保留現行決定，不保留被推翻的內容；要理解某項決定「為什麼變成現在這樣」時讀這裡。

計畫本文與進度紀錄裡出現的「審閱意見 N」「意見 N」都是指本檔的編號，編號一經指派不重用、不重排。

進度與驗證結果見 [進度紀錄](superrich1965-exchange-map-progress.zh-TW.md)。

## 審閱一覽

| 輪次 | 日期 | 點數 | 編號 | 重點 |
| --- | --- | --- | --- | --- |
| 第一輪 | 2026-09-09 | 5 | 1–5 | `isExchangeLocation()` 回傳型別、前端狀態隔離、跨品牌排序範圍、POST 驗證前移到 Phase A0、`update_time` 驗證方法失效 |
| 第二輪 | 2026-09-09 | 4 | 6–9 | 針對第一輪的修正內容再審：§3.2 根因解釋本身寫錯、§3.3 缺對照表且用了不存在的 key、A0 兩步不可互相取代、39 筆不是定案數字 |
| 第三輪 | 2026-09-09 | 3 | 10–12 | 同步第二輪修正後其他章節的殘留矛盾（§6 D1、§5 結尾、§8 下一步）|
| 第四輪 | 2026-09-09 | 7 | 13–19 | 逐項比對實際程式碼後新增：`renderExchangeRates()` 無品牌分派、`EXCHANGE_SORT_VALUES` 才是守門員、cluster 缺三態、整組契約全有全無、`sort.hidden` 短路、`isExchangeLocation` 參數形狀、A0 Claude 執行不了 |

前三輪為純文件審閱；**第四輪是第一次拿計畫逐項去比對 `src/` 實際程式碼**，因此抓到的都是「文件自洽但與程式碼不符」的問題，前三輪的修正本身則經核對全部正確。

## 第一輪（5 點）

1. **[P1]** `isExchangeLocation()` 不能改回傳品牌字串——會打斷 `src/ui/render.js` 現有的排序比較邏輯。改法：保留原本的 boolean 不動，另外新增 `getExchangeBrand()` 給 marker 顏色專用（見 §3.2）。
2. **[P1]** 兩套前端平行複製時，缺少「各品牌狀態互相隔離」與「共用控制單一負責者」的明文規則，一方停用／過期可能清掉另一方的報價（見 §4.4，新增）。
3. **[P2]** 「USD、TWD 兩項排序」沒有說清楚橘色合併面額（`100-50`／`1000-100`）要怎麼跟綠色分開面額（`USD_100`／`USD_50`／`2000-100`）一起比較，容易誤導使用者以為排名適用於他手上的鈔票面額（見 §3.3，新增）。
4. **[P2]** Cloudflare 可行性驗證只做到 GET，POST 是否真的能過，要等 Phase C 部署才知道太晚——已把最小 POST 驗證前移到 Phase A 當作進入門檻（見 §2.1、§6）。
5. **[P2]** `update_time` 連續兩次呼叫的比較方法本身站不住腳（不管值變不變都無法單靠這個測試判斷語意）——已修正驗證方式並降低優先度（見 §2、§7.2）。

## 第二輪（4 點，針對第一輪修正的內容再審）

6. **[P1]** §3.2 對「為什麼改成品牌字串會壞掉」的解釋本身是錯的——不是字串相減得到 `NaN`，是三元運算對兩個方向都回傳 `-1`，違反比較器反對稱要求；且只保留 boolean 不夠，`isExchangeLocation()` 的實作內容也必須擴充成同時認得兩品牌的 slug，否則橘標分店會被判定成「不是換匯地點」，整個匯率面板不會出現（見 §3.2，已重寫根因與修法）。
7. **[P2]** §3.3 只說「新增兩個橘色排序選項」沒有講清楚這兩個 key 實際對應哪個品牌、哪個資料欄位、由哪個 lookup 函式取值——已補上排序 key 到品牌／欄位／lookup 的對照表，並修正一處跟現有程式碼不符的錯誤 key 名稱（`TWD_2000_100` 應為 `TWD`）（見 §3.3）。
8. **[P2]** Phase A0 原本把「使用者本機終端機」跟「Netlify Deploy Preview」當成任選一種就算完成的等價選項——本機成功不能代表 Netlify 執行環境（不同 IP range）也會被 Cloudflare 放行，已改成兩步都要做、且完成條件明訂為 Netlify 環境驗證成功（見 §2.1、§6 A0）。
9. **[P2]** §5 把 `exchange-rate/branch-list` 的 39 筆直接當成「已排除 Partner Branch」的數字，但分組核對（`groups[]`）要到 A1 才會做，39 筆目前只是上限估算，不是定案——已修正措辭（見 §5）。

## 第三輪（3 點，同步第二輪修正後其他章節出現的殘留矛盾）

10. **[P2]** §6 D1 那行仍寫著「不改動 `isExchangeLocation()`」，跟第二輪修正後 §3.2 的正確做法（`isExchangeLocation(row) = getExchangeBrand(row) !== null`——回傳型別不變，但實作要改）互相矛盾——已同步改成一致的說法（見 §6 D1）。
11. **[P3]** §5 結尾那句「依 39 間分店重新估算請求量」還是把 39 當定案數字用，跟同一節第 1 點剛加的「39 只是上限估算」矛盾——已改成「Phase A1 核對完實際 Our Branch 收錄數之後」才重新估算（見 §5）。
12. **[P3]** §8 的「下一步」還寫著要使用者「協助截 `exchange-rate/get` 的真實請求範例」，但這個前提已經在 §2 被使用者提供的截圖滿足，是失效的舊字句——已移除，改成呼應 §7 已無開放問題、可直接進 Phase A0 的現況（見 §8）。

## 第四輪（7 點，2026-09-09 逐項比對實際程式碼後新增；前三輪的修正已全部核對正確）

13. **[P1]** §3.2 說「擴充 `isExchangeLocation()` 之後橘標的匯率面板才會出現」，這個推論是錯的——實際出現的是**綠標的面板**。`src/ui/render.js:150-186` 的 `renderExchangeRates()` 沒有任何品牌分派：`EXCHANGE_DENOMS` 寫死在 render.js:119、`getExchangeRateCell()` 讀的是綠標的 `state.exchangeRatesBySlug`（橘標三列全部 `fx_unavailable`）、時間戳取自綠標的 `state.exchangeCompletedAt`，而 `OFFICIAL_EXCHANGE_URL`（render.js:118）寫死 `superrichthailand.com`，**橘標卡片會連到綠標官網**，正好是 §3.1 要防的混淆（見 §3.2、§6 D1）。
14. **[P1]** §3.3 只提到 `ExchangeSort` typedef，漏了真正的守門員：`EXCHANGE_SORT_VALUES`（`src/features/exchange-rates.js:13`）是 `['default', ...DENOMS]`，DENOMS 來自綠標的 `src/data/exchange-rates.js`，而 select handler 用 `isExchangeSort()` 過濾，**不在清單裡的值會被靜默降級成 `'default'`**——`USD_1965`／`TWD_1965` 不進這個常數就完全點不動（見 §3.3）。
15. **[P1]** cluster 著色完全沒有三色計畫。`isExchangeOnlyCluster()`（`src/map/map.js:296`）靠 `classList.contains('is-exchange')` 判斷，HERE 端靠 `getData().isExchange !== true`（map.js:337）。橘標不能沿用 `.is-exchange`（會撞色），但後果是**全橘標 cluster 判定成 false、退回無色一般 cluster**，而混合 cluster 要什麼顏色原文完全沒提（見 §3.2，已補上定案）。
16. **[P2]** `parseExchangeRatesPayload`（`src/features/exchange-rates.js:88`）是全有全無的整組契約：`snapshot.branches.length !== BRANCH_SLUGS.size` 直接 `return null`，任一 slug 不符也整包退。橘標的 `data/superrich1965-branches.json` 跟 Notion 收錄名單必須永遠同步，否則不是單店缺值而是**整個橘標面板消失**。§6 Phase B 的「通過既有 validator」不成立——`scripts/validate-superrich-mapping.mjs` 只認綠標（見 §6 Phase B）。
17. **[P2]** §4.4 只寫了「屬於停用品牌的選項要 disable」，但 `syncExchangeControls()`（exchange-rates.js:363）的 `sort.hidden = !state.exchangeLocationsOn || state.exchangeRatesEnabled === false` 是更前面的短路：綠標被停用就整個排序 select 消失，橘標選項一起陪葬（見 §4.4）。
18. **[P3]** `isExchangeLocation(value)` 的簽名是 `string | {id?: string}`，讀的是 `.id` 不是 `.slug`，新增的 `getExchangeBrand()` 必須保持同樣的雙形狀支援（見 §3.2）。
19. **[P2]** Phase A0 Claude 這邊做不到，已實測確認：cloud container 與使用者裝置的 sandboxed shell 對 `superrich1965.com` 的 GET／POST 都是 connection failure，兩步都必須由使用者自己執行（見 §2.1、§6 A0）。
