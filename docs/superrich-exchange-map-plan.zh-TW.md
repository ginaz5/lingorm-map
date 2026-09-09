# SuperRich USD／TWD 換匯地圖實作計畫

建立日期：2026-09-08；更新日期：2026-09-09。狀態：M1－M4 程式與文件皆已完成，M3 停在 PR Deploy Preview；正式發布與匯率服務啟用時機由使用者決定。進度與驗證見 [進度紀錄](superrich-exchange-map-progress.zh-TW.md)。

版本：第十版（2026-09-09）。完整變更歷程見 [修訂摘要](superrich-exchange-map-plan-revisions.zh-TW.md)。

本功能讓使用者在現有踩點地圖上找到 SuperRich Thailand 分店，查看美金與台幣換成泰銖的分店買入價，並比較同幣別、同面額的匯率。

## 1. 已確認需求

| 項目 | 決定 |
| --- | --- |
| 換匯方向 | USD／TWD → THB，使用店家的 Buying Rate |
| 地圖 | 開關開啟時分店與踩點地點一起顯示，分店使用綠色 Icon |
| 預設可見度 | 新增「顯示換匯點」開關，**預設關閉**；使用者開啟後才顯示分店，匯率服務啟用時提供最佳匯率排序（見 §3.1） |
| 篩選 | **換匯點不受踩點類別／主題影響**；仍套用目的地、搜尋與收藏條件。踩點地點維持既有篩選規則 |
| 報價 | 卡片同時顯示 USD 100、USD 50、TWD |
| 點擊行為 | 地圖標記點開才顯示匯率，標記本身不放價格 |
| 排序 | 提供最佳匯率排序 |
| 更新 | 系統全天每 30 分鐘集中抓取全部分店，所有訪客讀同一份結果；**使用者已同意 30 分鐘，2026-09-09 補記確認，取代最初的 15 分鐘需求** |
| 畫面同步 | 換匯點開啟且頁面可見時，每 60 秒向本站確認狀態；切回頁面或恢復連線時立即確認。這些請求不觸發 SuperRich 抓取 |
| 營業時間 | **不顯示、不維護、不依此排程**。卡片提供該分店 Google Maps 連結，由使用者自行確認營業時間（見 §3.2） |
| 失敗 | 顯示「暫無報價」，附分店連結供使用者自行查詢；失敗項目不沿用舊價格 |
| 連結 | 提供該分店 Google Maps 連結與官方匯率頁，提示使用者在官網選擇對應分店 |
| 免責 | 卡片與 popup 必須顯示雙語免責與來源標示，屬必要元素而非選配（見 §3.2） |
| 保存 | 僅最新匯率，不建立歷史走勢 |
| 停用方式 | **使用者於 2026-09-09 確認：主動停用匯率服務時保留分店與連結**。停止抓取及供應報價，卡片與 popup 顯示「暫無報價」；保留換匯點開關、綠色標記、導航與收藏，顯示仍遵守訪客開關及篩選條件；不需重新部署、不需改 Notion 或 CSV（見 §5.12） |

第一版沿用現有 Vanilla JavaScript、Google Maps／HERE Maps、繁中／英文與 Netlify。暫以不另外訂閱服務為方向；實際 Netlify 用量需依站台方案核對，不承諾零成本。

## 2. 已查證的來源與限制

2026-09-08 使用官方頁面、官方前端程式使用的公開 GET 介面進行唯讀查證，沒有使用帳號、Cookie 或第三方憑證。

- [官方匯率頁](https://www.superrichthailand.com/exchange-rate) 的分店選單目前有 26 間分店。
- 26／26 間都成功取得 USD 100、USD 50、TWD 買入價。
- 26／26 間都取得官方座標與 Google Maps 連結；2026-09-09 建檔核對確認其中 24 店有專屬 Place ID，Happitat 與機場店的來源連結只指向場館／車站，仍需發布前複核。詳見 [逐店查證紀錄](superrich-branch-verification.zh-TW.md)。
- 本店與 Terminal 21 Asok 的官網畫面報價和對應介面一致，分店間確實有價差。
- 本次所有分店的 TWD 都使用 `2000 - 100` 面額組。USD 100、50 即使同價，仍需各自保存和顯示。
- 地點涵蓋曼谷、芭達雅、Chonburi、Si Racha 與機場，不能只收曼谷市區。
- 這些是官網目前使用的介面，尚未找到承諾相容性或服務水準的對外 API 文件。

已驗證的介面，基底為 `https://api.superrichthailand.com/api/v1`：

| 用途 | GET 路徑 | 已確認欄位 |
| --- | --- | --- |
| 分店清單 | `/branch-client/options` | `data[].value` 為分店 ID，`label` 為名稱 |
| 分店資料 | `/branch-client/{id}` | 根層成功狀態與 `data`；`data` 內含 `id`、`latitude`、`longitude`、`googleLink`、`address` 等。營業文字與無關欄位不採用 |
| 最新報價 | `/exchange-client/list?branchId={id}&type=exchange` | 根層 `statusCode`／`code`／`message`／`timestamp`／`data`；報價位於 `data.exchange.<幣別>[]`（見 §2.2） |

分店與匯率查詢使用 `X-Language-Code: en`。單店報價回傳所有貨幣，以 `unit`／幣別與 `denomRem` 辨識目標資料，讀取 `buyText`；`sellText` 不進入公開換匯資料。已測試最新報價可不傳日期；日期版亦可使用 `date=YYYY-MM-DD`。不得由空結果自行代入本店價格或向前搜尋歷史價格。

來源回傳的營業文字**不採用**：格式不保證、假日與商場調整不會即時反映，維護 26 店營業時間的成本與出錯風險都高於效益。營業時間一律由使用者透過 Google Maps 連結自行確認。

`branchCode` 位於**匯率回應的每一筆報價項目**（`data.exchange.<幣別>[]` 之內），**不在** `/branch-client/{id}`；2026-09-09 已收齊 26 店代碼：10 為 `H01`、11 為 `B01`、12–35 依序為 `M01`–`M24`。對照檔保存來源 ID 與分店代碼，抓取時核對，避免誤把本店資料套用到其他分店。

### 2.2 2026-09-09 實測的欄位值（Phase A 契約依據）

先以分店 28（Terminal 21 Asok）為主、10（本店）與 34（Happitat）抽驗；M1 再對全 26 店確認分店詳情、代碼與三種目標買入價，供 adapter 與 fixture 使用：

| 項目 | 實測值 |
| --- | --- |
| 匯率回應結構 | 根層 `{ statusCode, code, message, timestamp, data }`；報價在 `data.exchange.<幣別>[]` |
| 單筆報價欄位 | `id`、`currencyId`、`branchCode`、`denomCode`、`unit`、`denomRem`、`buyText`、`image`、`isFavorite` |
| USD 的 `denomRem` 全集 | `100`、`50`、`20 - 10`、`5`、`1`。本計畫只取 `100` 與 `50` |
| TWD 的 `denomRem` | `2000 - 100` |
| `buyText` 小數位 | USD 100／50 為 2 位（`32.83`）；TWD 為 5 位（`0.99500`）。`displayDecimals` 依實際字串決定，不寫死 |
| `branchCode` | 26／26 店的 `H01`、`B01`、`M01`–`M24` 均符合 `/^[A-Z]{1,3}\d{1,3}$/`，全量代碼 fixture 已納入測試 |
| `googleLink` 網域 | **不只一種**：分店 10 為 `https://www.google.com/maps?cid=...`，分店 34 為 `https://maps.app.goo.gl/...`。白名單見 §4.3 |
| `/branch-client/{id}` 欄位 | 分店欄位在 `data` 內，非根層；**沒有** `branchCode`。解析器先確認 `statusCode: 200` 與 `code: SUCCESS`，再取 ID、座標與連結，丟棄地址、營業文字等來源顯示字串 |

**已確認：來源沒有報價發布時間，不顯示「官網報價時間」。** 2026-09-09 兩次查詢確認 `data` 的直接子鍵只有 `exchange`，**沒有 `data.time`**；報價項目本身也只有 `id`、`currencyId`、`branchCode`、`denomCode`、`unit`、`denomRem`、`buyText`、`image`、`isFavorite`，沒有時間欄位。根層 `timestamp` 在兩次查詢間由 `2026-09-09T00:07:05.977Z` 變為 `00:12:08.269Z`，而報價數字未變，可判定它是 **API 回應產生時間**，不是報價發布時間。

因此：根層 `timestamp` 不進入快照、不顯示、不作為新鮮度依據；卡片只顯示本站的「本次查詢時間」（`completedAt`）。`?date=YYYY-MM-DD` 版本亦已實測可用，但本計畫不使用。

### 分店連結：已確認方案

官網在匯率頁選擇分店後不會更新網址。實測 `?branchId=28` 仍顯示本店，因此不能把它當成 Asok 專屬匯率連結。

使用者已確認採用以下方式，清單卡片與地圖 popup 都提供：

- 「查看此分店／View this branch」：來源提供的該店 Google Maps 連結，沿用既有 Google Maps 操作入口，避免重複按鈕。使用者也由此確認營業時間。
- 「前往官網查匯率／Check official rates」：官方匯率頁，旁邊清楚提示「請在官網選擇 Terminal 21 Asok G Floor／Select Terminal 21 Asok G Floor on the official website」等對應分店名稱。

有報價及「暫無報價」時都保留這兩個入口。官方匯率頁連結不附未驗證的分店參數，Google Maps 連結也不標示為匯率查詢頁。

### 2.1 來源使用風險：查證結果與處置

正常情況每日約 1,296 個來源請求，平均每分鐘約 0.9 次；這個平均值不能代表抓取期間的峰值，也不能據此保證來源站台會接受。請求節奏、自動存取限制與報價轉載是三個不同問題：

| 代號 | 風險 | 處置 |
| --- | --- | --- |
| R1 | 被 WAF 判定為機器流量而限流或封鎖 | 工程可降低風險：限制頻率與併發、circuit breaker、自我識別（§5）；不保證來源接受 |
| R2 | 使用未公開文件化的介面，沒有明示授權 | 工程不可解：以禮貌抓取、可辨識身分、隨時可停用來承擔 |
| R3 | 公開轉載他人報價，使用者可能據此做換匯決定 | 產品面處理：卡片必要免責 + 來源標示 + 官網連結（§3.2） |

2026-09-08 的查證結果：

- `https://www.superrichthailand.com/robots.txt` 僅 `Disallow: /en/admin` 與 `/th/admin`，`Allow: /en`、`/th`，沒有封鎖任何資料路徑。
- `https://api.superrichthailand.com/robots.txt` 回應 404，該網域未提供 robots 規則。
- 官網 `policy-green` 頁面為隱私與相關政策，不能代表已查完使用條款。2026-09-09 補查官方 [Terms & Conditions](https://www.superrichthailand.com/terms-and-conditions)：§2 將服務定義為 SuperrichTH Application，§4.1.3 涉及可能干擾 App 或系統安全的 BOT／Remote Applications。**該條款對本計畫所用公開網頁匯率介面的適用範圍尚未確認**，不能由此斷言全面禁止抓取，也不能斷言沒有相關限制。

目前未取得公開介面的明示授權或相容性承諾。維持不主動向 SuperRich 申請授權的既定方向，以以下措施處理來源使用風險並保留停用能力；這些措施與免責文字本身不構成授權：

- 抓取頻率降為 30 分鐘一輪（§5），每日來源請求量由每 15 分鐘版本的約 2,592 降為約 1,296。
- 送出可辨識用途與聯絡方式的 `User-Agent`（例如 `lingorm-bangkok-map/1.0 (+<站台網址>; <聯絡信箱>)`），不偽裝瀏覽器，不使用帳號或 Cookie，不繞過任何存取控制。
- 遵守 `Retry-After`，並以跨輪次 circuit breaker 確保被拒絕後立即停止再打（§5.11）。
- 收到 403／429 或連續整輪失敗時依 §5.11 自動退避；進入停用狀態後停止抓取及供應報價，保留分店與連結，不需等待重新部署（§5.12）。
- 若 SuperRich 提出停止使用要求，分店位置與官網連結不依賴抓取，可乾淨降級為「只連結、不顯示數字」。

本節不構成法律意見。

## 3. 介面與排序規則

以下是依已確認需求採用的實作預設，可在開始實作前調整。

### 3.1 換匯點的預設可見度（已確認）

使用者已核准新增開關且**預設關閉**。原始需求「分店與踩點地點直接一起顯示」現理解為「開關開啟後一起顯示」。

M1 匯出後 `data/locations.csv` 有 181 筆地點、其中 135 筆 `Published`，26 間新分店全為 `Paused`。若原有公開數不變且 26 店全通過審核，公開地點將為 161 筆，換匯點約佔 16%，因此以獨立開關控制是否顯示。`src/ui/render.js` 的 `buildCatFilter` 由資料動態生成選項；換匯點的顯示與計數必須明確接入這條路徑。

行為定義：

- 新增「顯示換匯點／Show currency exchange」切換，i18n key `fx_toggle`，**預設關閉**。
- 狀態持久化到 `localStorage`，與收藏、目的地篩選同一套機制；鍵名需與現有 favorites／destination 鍵不衝突。
- 關閉時：換匯分店不進入 `state.visIdx`、不建立 marker、不出現在 category 選項計數中，`result-info` 的總數也不含這 26 筆；`Currency Exchange` 類別不出現在 category 下拉選單。
- 開啟時：分店與踩點地點一起顯示；匯率服務啟用時解鎖 §3.4 的最佳匯率排序選項。服務停用時仍可開啟分店，卡片顯示「暫無報價」及連結。
- **開啟時的計數語意**：`result-info` 的可見數與總數都包含換匯分店。但因為換匯分店不套用類別條件，選取任一踩點類別時，可見數會大於該類別的選項計數（例如選「餐廳 (59)」時可見 59 + 符合共用條件的換匯分店）。類別下拉的每個選項計數只計踩點地點，維持既有語意不變；差額由 `fx_filter_note` 向使用者說明。不得為了讓數字相等而把換匯分店塞進踩點類別計數。
- **兩類地點分別篩選後合併結果**：踩點地點套用既有全部條件；換匯分店只套用公開狀態、換匯點開關、目的地、搜尋及收藏，不套用類別與主題。例如選取曼谷 + LingOrm + 餐廳，開關開啟後仍顯示符合共用條件的曼谷換匯分店。辨識換匯分店使用經驗證的 Slug → 官方 ID 對照，不依名稱猜測，也不把分店改標成 LingOrm。
- 開關旁提供雙語說明 `fx_filter_note`：「換匯點不受類別與主題篩選影響。／Exchange locations are not filtered by category or collection.」目的地、搜尋及收藏仍依既有行為套用；搜尋特定踩點名稱時，不相關的分店可以被隱藏。
- `Currency Exchange` 類別在開關開啟時保留；選它可只看符合共用條件的換匯分店。由開啟切回關閉時，若目前選中此類別，類別回到「全部」；其他類別與主題選擇不變。
- 由開啟切回關閉時，若目前排序基準是最佳匯率，排序選單須回到一般排序，且 `state.activeIdx` 指向換匯分店時要清除，避免留下指不到卡片的高亮。
- 收藏不受開關影響：收藏中的換匯分店在開關關閉時同樣隱藏，但 Slug 與 `localStorage` 內容不得被清除。
- 這個開關控制訪客是否顯示換匯分店；§5.12 的站台停用只停止匯率服務。站台停用不移除開關、不改寫訪客偏好，也不刪除分店或收藏；原本關閉換匯點的訪客仍維持關閉。

### 3.2 分店卡片與地圖 popup

- 使用綠色底、具換匯辨識度的圖示，搭配「換匯／Currency Exchange」文字，避免只靠顏色辨識。
- 地圖僅顯示圖示；點開後與清單卡片共用同一個匯率呈現元件。
- 同時顯示三列：USD 100 美元鈔、USD 50 美元鈔、TWD（來源所列適用面額）。
- 所有價格均標明「每 1 USD／TWD 可換得多少 THB」；100／50 是鈔票面額，不是報價的計價單位。
- 只顯示「本次查詢時間／Last checked」，值為快照的 `completedAt`，使用泰國時間 UTC+7 並標明時區。**不顯示官網報價時間**——來源未提供報價發布時間（§2.2），不得用 API 回應時間冒充。
- 首次查詢尚未完成時使用雙語 `fx_loading`：「匯率載入中／Loading rates」。沒有可用快照或查詢失敗後顯示「暫無報價」；重新查詢既有有效快照時不切回載入畫面，也不延長報價有效期。
- **不顯示營業時間**。卡片的 `fx_hours_note`（「營業時間請見 Google Maps／Check opening hours on Google Maps」）指向該分店的 Google Maps 連結，由使用者自行確認。系統不解析、不儲存、不顯示來源的營業文字。
- 沿用分店名稱、地址／樓層、導航、Google Maps、收藏，以及上節已確認的官網查詢方式。
- 暫無報價仍保留分店、綠色標記與連結。僅缺一列就只將那列設為無報價；整店失敗則三列都無報價。
- 主動停用匯率服務（含管理者停用與 breaker 自動停用）時，三列均顯示「暫無報價」，不沿用停用前的數字或最佳匯率標示。已開啟的 popup 更新報價區塊，保留分店選取狀態、Google Maps／官網連結、導航與收藏。

#### 免責與來源標示（必要元素）

卡片與 popup 在**任何狀態**（有報價、部分缺值、全無報價）都必須顯示下列文字，與價格區塊同層級、不可摺疊隱藏：

| i18n key | 繁中 | English |
| --- | --- | --- |
| `fx_disclaimer` | 匯率僅供參考，實際以分店櫃檯為準。 | Rates are indicative only; the branch counter is authoritative. |
| `fx_source_note` | 資料來源：SuperRich Thailand 官網 | Source: SuperRich Thailand official website |
| `fx_hours_note` | 營業時間請見 Google Maps | Check opening hours on Google Maps |

- 三段文字都由 `src/core/i18n.js` 產生，不從來源帶入，並納入 `tests/i18n-ui.test.mjs`。
- `fx_source_note` 連往官方匯率頁，與既有「前往官網查匯率」入口併排時不重複兩個相同連結。
- 320px 寬度下不得被截斷或需要水平捲動。

### 3.3 綠色標記的實作範圍（分兩階段）

現行 marker 沒有任何 per-row 著色能力，因此這項工作比表面大，拆成兩段，第二段可延後：

現況：`makeMarkerContent(icon)` 只接受 emoji 字串、class 固定為 `marker-dot`，顏色來自單一 CSS 變數 `--marker-bg`（`styles.css`）；HERE 的 `H.clustering.DataPoint` payload 只有 `{ index, icon }`，`getNoisePresentation` 取不到分類；HERE 的 cluster theme 只用 `cluster.getWeight()`；Google 的 `clusterRenderer` 目前只解構 `{ count, position }`。

- **D1（第一版必做）單店綠色標記**：`makeMarkerContent` 增加變體參數，新增 `.marker-dot.is-exchange` CSS 變數組；HERE 的 DataPoint payload 擴充為 `{ index, icon, isExchange }`，`getNoisePresentation` 依此套用同一個 class。Google 與 HERE 在單店層級必須一致。
- **D2（可延後）群聚著色**：全為換匯點的群聚顯示綠色。Google 需在 `clusterRenderer` 解構 `markers` 判斷成分；HERE 需改用 `cluster.forEachDataPoint` 檢查。延後期間，所有群聚（含全綠群聚）一律沿用現有群聚樣式，這是可接受的降級。

### 3.4 最佳匯率排序

- 保留原本清單順序作為一般排序，另提供 USD 100、USD 50、TWD 三種最佳匯率選項；首次選擇匯率比較時預設 USD 100。排序選項僅在 §3.1 的換匯點開關開啟且匯率服務啟用時可用。
- **初次開啟開關時的初始態**：開關關閉時不查本站 API，因此開啟前不知道 `enabled`。開關開啟後、第一次 API 結果回來前，三個最佳匯率選項一律**顯示為 disabled**（不是隱藏），避免選項憑空出現造成版面跳動；取得 `enabled: true` 後啟用，取得 `enabled: false` 或 API 失敗則維持 disabled。
- 收到服務停用狀態後，隱藏最佳匯率排序選項及最佳標示；目前若採匯率排序，回到一般排序。分店仍留在符合篩選的結果中，已選取的分店與收藏對應不變。
- 三列報價始終一起顯示；排序選項只決定比較基準。
- 以有效買入價由高到低排列，同價分店並列最佳，使用穩定 Slug 作為排序 tie-breaker，避免每次更新跳動。
- 選擇匯率排序時：有該項報價的分店在前、無該項報價的分店其後、其他踩點地點依原順序置後。地圖仍保留全部符合篩選的點。
- 先依 §3.1 分別篩選踩點與換匯分店，再合併並排序；「最佳」只代表目前可見分店中、同幣別面額的有效報價。切換踩點類別或主題本身不改變換匯分店的比較範圍。
- 不比較 USD 與 TWD 的原始數值；USD 100 缺值時也不借用 USD 50。
- 只排序 `state.visIdx`，不重排 `state.data`，保護標記索引、已開啟卡片與收藏對應。已確認現行 `renderList` 以 `card-${i}`／`activateCard(${i})` 綁定 `state.data` 索引、`state.markers` 為以 data 索引定位的稀疏陣列，因此重排 `visIdx` 不會破壞定位。

#### 數值比較與精度

前一版舉的例子是錯的：`Number('0.8912') === Number('0.89120')` 實測為 `true`，同一個十進位值不論寫幾位小數，`Number()` 之後都是同一個 double，直接比較不會出錯。

實際需要防範的是另外兩件事：

1. **每筆各自決定縮放倍率會讓跨列比較失效**。若 A 店存 `8912`（×10⁴）、B 店存 `89120`（×10⁵），整數比較會得到 `8912 !== 89120` 的錯誤結論。
2. 浮點運算的累加與除法（例如自行換算面額或做平均）才會產生 `0.1 + 0.2 !== 0.3` 這類誤差。

因此規則是：

- 定義單一全域常數 `RATE_SCALE = 1_000_000`（10⁻⁶，遠高於來源目前的小數位數），**所有幣別、所有分店一律使用同一個倍率**：`rateScaledE6 = Math.round(rate * RATE_SCALE)`。
- 排序與並列判定只比較 `rateScaledE6` 整數，不對它做除法或累加。
- 顯示用的小數位數另存 `displayDecimals`（數字，非來源字串），由 i18n 格式化，不參與比較。
- 解析時若 `rate * RATE_SCALE` 超出 `Number.MAX_SAFE_INTEGER` 或非有限值，視為無效報價。
- 測試案例改為驗證「不同小數位寫法產生相同 `rateScaledE6`」與「不得出現各列不同倍率」，不再使用 `0.8912` vs `0.89120` 的錯誤例子。

## 4. 靜態地點與即時匯率的資料分工

### 4.1 分店基本資料的來源：方案比較

上一版直接假設分店建進 Notion。這是本計畫最難回頭的決定，先列出取捨再定案：

| 方案 | 做法 | 優點 | 缺點 |
| --- | --- | --- | --- |
| **A（建議）Notion 建檔** | 26 店以正式流程建入 Notion Locations，隨 CSV 匯出；官方 ID 對照另存 | 沿用既有審核、雙語名稱、目的地分類、收藏 Slug 與驗證腳本；不會自動上架未審核地點 | 26 筆人工建檔；名稱／座標與官方 ID 分屬兩處，上游改名或搬遷需人工同步 |
| B 完全由快照供應 | 分店不進 Notion，前端合併「Notion 踩點清單 + 快照分店清單」兩個來源 | 省掉人工建檔；上游改名自動跟上；單一 source of truth | 失去審核與中文名稱；收藏 Slug 需另立命名空間；`isPublicLocation`、目的地篩選、favorite 相容性驗證都要處理第二種 row 型別，改動面比 A 大 |
| C 混合 | Notion 只存名稱／中文名／目的地，座標與連結取自快照 | 名稱可審核、座標自動跟上 | 一筆資料兩個來源，除錯時最難判斷哪邊是對的 |

**採用方案 A**，理由是它不動 `LocationRow` 契約與收藏相容性（`AGENTS.md` 編輯規則 4、位置資料規則），26 筆是一次性成本。若日後分店數量成長到需要頻繁同步，再評估 B。

### 4.2 分店基本資料仍由 Notion 管理

將分店名稱、雙語說明、座標、Google Maps URL、來源、分類、目的地與穩定 Slug 建入正式 Locations，再依現行流程匯出、驗證並更新 `data/locations.csv` 後部署（指令見 `CLAUDE.md` 的 Location data workflow）。既有 17 欄 CSV 結構不變。

- 新增 `Currency Exchange`／「換匯」類別；綠色外觀由渲染規則決定，不能借用 Published 等審核狀態上色。
- 新分店採穩定 `superrich-thailand-{官方ID}` Slug，例如 `superrich-thailand-28`。若去重時已有同店，沿用原 Slug，建立明確的 Slug → 官方 ID 對照。目前 `data/locations.csv` 沒有任何 SuperRich 或換匯類地點，去重預期為零衝突，仍須實際比對確認。
- 官網來源 ID 對照以小型、經驗證的連接設定保存；它不取代 Notion 的名稱、座標或公開狀態。
- 第一版分店 `Type` 留空，沿用現行允許空值的契約（`validate-location-snapshot.mjs` 的 `validateTypes` 接受空值）；不自動視為 LingOrm 或某個推薦主題。前端依 §3.1 對換匯分店略過類別／主題條件，踩點資料仍維持既有 AND 規則。
- **公開分店必須有目的地，不得留空**。`validate-location-snapshot.mjs` 的 `validateDestinations` 對 `Published` 列強制要求 Country Code 與 Destination Key 同時存在，且兩者必須同時有值或同時為空；現有 14 筆空值全部是未公開資料，不是可援引的先例。因此第一版必須：
  - **新增目的地必須三處同時到位，缺一則整個匯出失敗。** `scripts/export-snapshot.mjs` 在 `queryAllPages` 之前先呼叫 `assertCurrentFormalSchema`，比對 Notion 的 `Destination Key` select 選項與 `CURRENT_FORMAL_DESTINATION_OPTIONS`（由 `DESTINATIONS` 與 `DESTINATION_OPTION_COLORS` 組成），任一項不符就 `throw new Error('Notion Locations schema is incompatible ...')`，連不相干的地點更新也匯不出來：

    | 只改了 | `inspectCurrentFormalSelectOptions` 的判定 |
    | --- | --- |
    | 只改 code，Notion 未建選項 | `missing chonburi, si-racha` |
    | 只在 Notion 建選項，code 未改 | `unexpected chonburi, si-racha` |
    | 兩邊都改但顏色不一致（含漏加顏色時 expected 為 `undefined`） | `wrongColors` |

    三處修改：

    1. `src/data/destinations.js` 的 `DESTINATIONS`：新增 `{ key: 'chonburi', countryCode: 'TH', en: 'Chonburi', zh: '春武里' }` 與 `{ key: 'si-racha', countryCode: 'TH', en: 'Si Racha', zh: '是拉差' }`。
    2. `scripts/formal-location-current-schema.mjs` 的 `DESTINATION_OPTION_COLORS`：這是手寫 map，不由 `DESTINATIONS` 推導，必須各補一個顏色，且與 Notion 實際設定的顏色字串完全相同。
    3. Notion Locations 的 `Destination Key` select：新增同名選項並設定與第 2 點一致的顏色；`Country Code` 已有 `TH`，不需新增。

    三處在同一次變更一起改；驗證方式是先跑一次 `npm run locations:export:notion -- --output data/locations.next.csv`，確認 schema gate 通過後再建 26 筆分店資料。
  - 芭達雅分店沿用 `pattaya`；曼谷都會區與機場依現有旅遊目的地原則歸入 `bangkok`。
  - 逐店確認 Country Code 一律為 `TH`，避免 `isValidDestinationPair` 的國家／目的地不匹配錯誤。
- 每次抓取比較來源分店 ID 與已收錄對照；新增／消失的分店列為資料差異，照既有 Notion 審核、匯出流程更新。第一版自動更新報價，不自動發布新增地點或刪除既有地點。
- 上線前必須使來源全部分店與公開收錄分店對照完整；未知分店不能靜默漏掉。

### 4.3 報價獨立保存與快照契約

建立 `/api/exchange-rates`，回傳單一最新批次快照；使用 [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) 保存，部署後資料可持續存在。每輪報價更新不修改 CSV、不寫 Notion、不觸發網站部署。

快照至少包含：

- `schemaVersion`、`runId`、`controlVersion`、`attemptedAt`、`completedAt`、`nextUpdateAt`、`expiresAt`。`controlVersion` 對應 §5.12 的啟用版本；所有系統時間保存為含時區的 ISO 時間。
- 來源分店 ID 集合、成功／失敗／未知分店數。
- 每店官方 ID、分店代碼、抓取狀態。**不含來源報價時間**（來源未提供，§2.2）。
- USD 100、USD 50 與 TWD 各自的面額標籤、有效數值，或無報價原因。

**快照不得包含任何來源的原始顯示字串。** 現行 `src/ui/render.js` 的清單與 popup 全部以樣板字串 + `innerHTML` 組出，沒有任何跳脫處理；目前安全是因為資料源是受控的 Notion。第三方字串一旦進入同一條渲染路徑就是注入風險，因此在抓取端（而非渲染端）收斂型別：

| 欄位 | 型別 | 規則 |
| --- | --- | --- |
| `rateScaledE6` | `number \| null` | `Math.round(rate * 1_000_000)`，全站單一倍率；非數字、0、負值、非有限值、超出安全整數範圍一律 `null` |
| `displayDecimals` | `number` | 顯示用小數位數，不參與比較 |
| `denom` | `'USD_100' \| 'USD_50' \| 'TWD'` | 列舉，不是來源字串。來源對照：`unit`+`denomRem` 為 `USD`+`100` → `USD_100`、`USD`+`50` → `USD_50`、`TWD`+`2000 - 100` → `TWD`。字串需完全相符（含空白），不做模糊比對；`20 - 10`、`5`、`1` 等其他面額一律忽略。來源若改動面額字串，該列記為 `missing` 而非猜測對應 |
| `unavailableReason` | `'timeout' \| 'invalid' \| 'missing' \| 'http_error' \| 'expired' \| null` | 列舉，不是來源錯誤訊息 |
| `branchCode` | `string \| null` | 取自匯率回應的報價項目（§2.2），非 `/branch-client/{id}`。同一店所有取用列的 `branchCode` 必須一致；格式白名單 `/^[A-Z]{1,3}\d{1,3}$/` 已由 26 店驗證，不符則視為身分不明並整店標記失敗；對照設定必須非空，失敗的報價結果可為 null |
| `googleLink` | `string \| null` | 需 `new URL()` 解析成功、protocol 為 `https:`，且 host 屬於白名單 `maps.app.goo.gl`、`www.google.com`、`google.com`、`maps.google.com`、`goo.gl`（兩種型式均已實測出現，見 §2.2），否則 `null` |

來源的營業文字不進入快照。顯示文字（面額標籤、無報價說明、免責、來源標示、營業時間提示）全部由 `src/core/i18n.js` 的雙語字典產生，不從來源帶入。

以 Slug 對照官方 ID 將快照加入獨立的 `exchangeRates` state；靜態 `LocationRow` 不放會反覆變動的價格。基本地點可先載入，匯率 API 失敗不影響踩點地圖啟動。

`state.js` 新增的欄位形狀先定義如下，變更前依 `AGENTS.md` 編輯規則 4 稽核 state、CSV 解析、render、map、forms 與兩個 Netlify Function：

```js
/**
 * @typedef {Object} ExchangeRatesState
 * @property {boolean} toggleOn           換匯點開關（訪客偏好，持久化）
 * @property {boolean|null} enabled       服務啟用狀態；null 表示尚未取得
 * @property {string|null} controlVersion
 * @property {string|null} runId
 * @property {number|null} expiresAtMs    由 expiresAt - checkedAt 換算的本地到期時刻
 * @property {Map<string, BranchRates>} bySlug  key 一律用 Slug，不用官方 ID
 * @property {'idle'|'loading'|'ready'|'unavailable'} status
 */
```

`bySlug` 以 Slug 為 key，理由是 render、markers、收藏與排序 tie-breaker 都以 Slug 定位；官方 ID 只存在對照檔與快照裡，不進入渲染路徑。

公開 API 使用固定外層 `{ schemaVersion, checkedAt, enabled, controlVersion, snapshot }`；`snapshot` 為上述快照或 `null`。停用、尚無快照、版本不符或已過期時一律不回傳舊數字。完成控制狀態與必要快照讀取時回 HTTP 200；控制旗標或儲存讀取失敗回 HTTP 503 與固定錯誤代碼，不把未知狀態偽裝成已停用。`checkedAt` 為本站本次讀取時間，不得冒充來源抓取時間。

## 5. 抓取排程與失敗處理

[Netlify Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/) 支援標準 5 欄 cron（UTC）定時執行，每次有 30 秒上限，只有已發布（published）的部署會自動排程，Deploy Preview 與 branch deploy 需以 UI 的 Run now 或 `netlify functions:invoke` 手動觸發。

**排程 Function 無法以 URL 直接呼叫**，因此本功能必須是兩個獨立的 function 檔，不能合成一個：

| 檔案 | 角色 | 設定 |
| --- | --- | --- |
| `netlify/functions/exchange-rates-fetch.mjs` | 抓取與寫入快照 | `export const config = { schedule: '0,30 * * * *' }` |
| `netlify/functions/exchange-rates.mjs` | 對外唯讀 API | `export const config = { path: '/api/exchange-rates', method: 'GET' }`，與現行 `locations.mjs` 寫法一致 |

儲存層需新增相依 `@netlify/blobs`（目前不在 `package.json`），並使用 `getDeployStore()` 取得 deploy-scoped store 以隔離非正式環境；正式環境使用站台層級 store（`getStore()`）。快照、circuit breaker 狀態與控制旗標分屬三個 key，避免條件寫入互相干擾。

1. **排程與請求量**：cron `0,30 * * * *`（UTC）全天每 30 分鐘一輪，一天 48 輪。目前 26 店加一次分店清單，正常一輪約 27 個來源請求、每天約 1,296 個來源請求，相較每 15 分鐘版本的約 2,592 次減少 50%。這不是 Netlify 計費金額估算。不依營業時間排程——營業時間由使用者自行確認（§1、§3.2）。
2. **單輪請求節奏**：取得分店清單後，以最多 2 個同時請求抓逐店匯率。整輪共用同一個派送器，任兩次請求啟動至少相隔 200ms，包含分店清單與重試；上限約每秒啟動 5 次，不宣稱每秒 1 次。正常輪次不重複抓座標，也不呼叫歷史或圖表 API。
3. **逾時與來源重試預算**：

    | 項目 | 第一版設定 |
    | --- | --- |
    | 單次來源請求 | 5 秒，涵蓋讀取回應內容；剩餘整輪預算不足時取較短值 |
    | 整輪來源截止 | 從 function 啟動起 25 秒；停止派送並取消尚未完成的來源請求，保留最後 5 秒處理狀態與儲存 |
    | 額外重試 | **整輪最多 1 次額外來源請求**；只限網路錯誤、timeout 或 HTTP 5xx |
    | 重試等待 | 至少 500ms；若有有效 `Retry-After`，取較晚時間；剩餘預算不足以等待並完成 5 秒請求就放棄重試 |
    | 不重試 | 403／429 直接走 §5.11；非 JSON、結構錯誤、身分不符、缺面額及其他 HTTP 4xx 不重試 |

    分店清單的重試先於逐店抓取；逐店重試則等每店至少獲得一次派送機會後，才使用剩餘的全輪重試額度。正常來源請求數為「分店數 + 1」，含重試最多再加 1；遇封鎖或截止可以更少。清單最終失敗時，為已收錄分店發布本輪無報價結果；清單成功而部分分店失敗時，只保留本輪成功的項目，未完成者以無報價入批次。本機曾測得的 3 併發 6.8 秒不代表新設定或正式環境表現；需量測全輪含儲存時間，無法穩定完成時採本節末尾的背景工作方案，不以提高來源速率補救。
4. 驗證 HTTP 與業務狀態、JSON 結構、幣別、面額、分店代碼與數字，並依 §4.3 的型別表收斂為列舉與整數，不讓任何來源字串進入快照。空值、0、負值、非數字或無法確定適用面額均為無報價，不補其他分店或面額的值。
5. 單一完整物件寫入最新 key，同一批同時含成功及明確失敗結果。**本輪開始、任何來源請求之前**就讀取快照的 etag 與控制版本；寫入前再次確認 §5.12 的版本條件。已存在快照用該次讀到的 `onlyIfMatch`，首次建立用 `onlyIfNew`；檢查回傳的 `modified`，條件不成立就放棄，不重新取得 etag 強行覆蓋。這些是單一 key 的條件寫入，控制版本仍須另外核對，不能把它當成跨 key 交易。參考 [Blobs set](https://docs.netlify.com/build/data-and-storage/netlify-blobs/#set)。
6. **控制、breaker 與快照讀取一律使用強一致性**（`getStore({ name: 'exchange-rates', consistency: 'strong' })` 或 `store.get(key, { consistency: 'strong' })`）；非正式環境使用 `getDeployStore({ name: 'exchange-rates', consistency: 'strong' })`，**強一致設定兩條路徑都要帶**，不可只設在正式路徑（§5.13）。這只處理儲存讀取的一致性，HTTP 快取另由 §5.9 控制。
7. **快照時間定義**（刷新排在失效之前）：

    | 欄位 | 值 | 用途 |
    | --- | --- | --- |
    | `attemptedAt` | 取得本輪有效控制版本後、開始來源查詢前的時間 | 核對本次啟用與來源查詢；function 啟動時間另存於執行期，仍由該時間起算 25 秒預算 |
    | `completedAt` | 本輪實際完成查詢時間 | 本次來源查詢時間顯示，不隨訪客讀取更新 |
    | `nextUpdateAt` | `attemptedAt` 之後下一個 UTC 整點或半點 | 下一輪預期抓取時點，與 cron 對齊；前端在此附近額外確認 |
    | `expiresAt` | `nextUpdateAt + 90 秒` | 到此仍未拿到新資料才清空價格 |

    已知抓取失敗立即撤下對應舊價。若排程整體未執行或儲存失敗，舊快照在 `expiresAt` 之後失效，對外呈現「暫無報價」。
8. 「抓取新鮮度」一律依本站實際成功查詢時間（`completedAt`）計算；來源沒有報價發布時間可引用（§2.2），不得以 API 回應時間替代。來源在休息時間沒有改價，不等於系統抓取失敗。跨日空回應不得自行挪用歷史資料。
9. **公開 API 不快取**：API 只讀控制旗標與共用快照，不因訪客請求重抓 SuperRich。所有正常、停用及錯誤回應都送 `Cache-Control: no-store` 與 `Netlify-CDN-Cache-Control: no-store`；瀏覽器使用 `fetch(..., { cache: 'no-store' })`。不得另設 stale-while-revalidate 或以 ETag 304 略過控制狀態確認。前端記憶體只保留尚未到期的快照，每次 API 仍重新讀取控制狀態。參考 [HTTP 快取規則](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control#no-store)、[Netlify 快取標頭](https://docs.netlify.com/build/caching/caching-overview/#supported-cache-control-headers)。
10. **前端查詢、到期與恢復使用同一套排程**：

    | 情境 | 行為 |
    | --- | --- |
    | 開啟換匯點 | 立即查本站 API；第一次尚無結果時顯示 `fx_loading` |
    | 換匯點開啟且頁面可見 | 每 60 秒確認一次，即使服務停用或目前無報價仍持續，以便偵測恢復 |
    | 接近下一輪更新 | 在 `nextUpdateAt + jitter(0–30 秒)` 額外確認；若已有同一輪排程觸發的查詢則合併 |
    | API 錯誤、尚無快照，或下一輪應到但仍是相同 `runId` | 依 10s → 20s → 40s 退避重試，之後維持每 60 秒；**不因超過 `expiresAt` 而停止查詢** |
    | 收到新批次 | 套用各列本輪成功／失敗結果，更新卡片、popup、排序並回一般 60 秒確認節奏 |
    | 收到 `enabled: false` | 立即撤價、取消等待新批次的快速重試，依 §3.4 回一般排序；之後仍每 60 秒確認控制狀態 |
    | 關閉換匯點或頁面進入背景 | 暫停網路輪詢並取消未完成請求；保留收藏與開關偏好 |
    | 切回頁面或觸發 `online` | 換匯點開啟時先清除已到期價格，再立即查詢；不等待 `nextUpdateAt` |

    - **排程決策必須實作為純函式**，否則本節的行為無法可靠測試（現有測試以正則從原始碼取出函式並自備假 DOM，沒有 fake timer 基礎設施）。介面固定為 `nextExchangeAction(now, state) => { action, delayMs }`，`state` 至少含 `enabled`、`controlVersion`、`runId`、`nextUpdateAtMs`、`expiresAtMs`、`retryLevel`、`lastAttemptAtMs`、`visible`、`online`、`toggleOn`；`action` 為 `'fetch' | 'expire' | 'idle'`。計時器與 `fetch` 只是薄殼，只負責把 `now` 餵進去並執行回傳的動作。§7 的所有時序驗收都對這個純函式下斷言，不靠真實計時器等待。
    - 單次本站 API 查詢逾時 8 秒。同時最多一個請求；一般 60 秒時點、更新時點及重試由同一個計時器協調，取最早應查時間並合併重複觸發。每個 `controlVersion + runId` 的更新時點只觸發一次；過去的 `nextUpdateAt` 不得再排成零延遲循環。過期或缺快照不得反覆從 10 秒重新開始退避；只有取得新批次、收到停用狀態或新的一次啟用才重置。取消後晚到的回應以請求序號丟棄。
    - 60 秒確認以請求啟動時間計算；快速重試從失敗完成時計算等待間隔。頁面持續可見、瀏覽器正常執行且 API 正常回應時，停用狀態會在下一次確認收到，目標上限為 60 秒加最多 8 秒請求時間。離線或背景頁面不承諾這個同步上限，回到可見且連線時立即確認。
    - 到期計時器獨立於網路重試。未取得新批次時，必須在 `expiresAt` 撤價；收到停用或新的失敗結果則提早撤下對應價格。計時使用 `expiresAt - checkedAt` 的剩餘有效期並扣除請求耗時，不依訪客裝置時鐘延長期限；重讀相同 `runId` 不重設其有效期。
    - 本站 API 暫時失敗時，尚未到期的已知快照可顯示至原期限；API 回覆有效的停用狀態、過期／版本不符的空快照或新批次缺值時，不沿用舊數字。無價格的項目不參與最佳匯率判定。
    - 來源仍僅每 30 分鐘抓取一次；前端每分鐘的請求是本站 API／Blobs 讀取量，需納入用量估算，不能誤算成額外的 SuperRich 請求。
11. **跨輪次 circuit breaker**。單輪內重試無法防止被封鎖後每輪仍持續打 27 個請求。以獨立 blob key 保存狀態：

    ```js
    // key: exchange-rates/breaker
    {
      controlVersion: '本次控制版本 UUID',
      consecutiveFailedRuns: 0,
      blockLevel: 0,
      blockedUntil: null,
      lastStatus: null,
      lastError: null
    }
    ```

    規則：
    - **403／429 優先於所有成功結果**：任一來源請求收到此狀態，立即停止派送新請求並取消尚未完成者；本輪其他已成功的分店不能重置封鎖狀態。一輪最多增加一次 `blockLevel`，不依同輪多個拒絕回應重複升級。
    - 第一次拒絕退避 6 小時，第二次 24 小時，第三次依 §5.12 自動停用直到管理者重新啟用。前兩次的 `blockedUntil` 取基本退避期限與有效 `Retry-After` 的較晚值；支援秒數及 HTTP 日期，無效值忽略，不提前重新請求。
    - 沒有 403／429 的輪次分三種：清單有效且所有已收錄分店三列均有效為「完整成功」；至少一列有效但不完整為「部分成功」；零列有效或清單最終失敗為「整輪失敗」。完整成功且快照發布成功才清除全部 breaker 記錄。部分成功把 `consecutiveFailedRuns` 歸零，但保留 `blockLevel`；整輪失敗才累加該計數。
    - 連續 3 輪整輪失敗退避 1 小時，觸發後將該連續失敗計數歸零。跳過的排程不算新失敗；儲存故障記錄於執行日誌，不冒充來源抓取失敗或成功重置。
    - `blockedUntil` 尚未到期時直接返回，一個來源請求都不發。暫時退避期間使用已發布快照的原有效期；本輪失敗項目仍立即記為無報價，截止後全部撤價，不延長舊價。第三次拒絕進入停用後，API 直接停止供應全部數字。
    - breaker 使用本輪讀到的 etag 條件寫入並帶 `controlVersion`；過時版本不能重置新版本的 breaker，也不能自動停用新版本的控制旗標。只有成功更新 breaker 的輪次可執行對應的自動停用；衝突時重新確認封鎖狀態後結束，不盲目覆蓋。`lastError` 使用固定代碼，不儲存來源的原始錯誤文字。
12. **匯率服務停用在執行期生效，分店與連結保留**。`enabled` 只控制來源抓取與報價供應，不控制靜態地點是否公開。Netlify 環境變數以部署當下的值套用，更新後必須建立新的部署，因此採用兩層控制：

    | 層級 | 位置 | 生效時間 | 用途 |
    | --- | --- | --- | --- |
    | 執行期控制旗標 | Blobs key `exchange-rates/control`，強一致讀取 | 後端下一次讀取時 | 停止來源抓取及供應報價；breaker 自動停用也寫這裡 |
    | 建置期預設值 | 環境變數 `EXCHANGE_RATES_ENABLED` | 需重新部署 | 控制旗標不存在時的回退預設；初次上線設 `false` |

    ```js
    // key: exchange-rates/control
    {
      enabled: true,
      controlVersion: '每次變更重新產生的 UUID',
      enabledAt: '本次啟用的 ISO 時間',
      changedAt: '本次變更的 ISO 時間',
      disabledReason: null,
      disabledAt: null,
      updatedBy: 'manual'
    }
    ```

    - 讀取順序：控制旗標（強一致）→ 不存在時回退 `EXCHANGE_RATES_ENABLED` → 皆無則視為 `false`。只有旗標不存在才回退；讀取故障不可當成不存在。尚無旗標時 API 的 `controlVersion` 與 `snapshot` 均為 `null`；排程若依預設需要啟用，先以 `onlyIfNew` 建立帶版本的控制物件，再重讀成功後才能抓來源。控制資料無效則停止來源抓取，API 回固定錯誤。
    - 提供受本機 Netlify 憑證保護的管理腳本 `scripts/exchange-rates-control.mjs`，以 `npm run fx:control -- status|enable|disable [--reason <代碼>]` 執行（比照既有 `location:verify` 的 `--env-file-if-exists=.env` 寫法），以條件寫入修改控制物件。`updatedBy` 只允許 `manual`／`breaker`；每次停用或重新啟用都產生新的 `controlVersion`，重新啟用另設定 `enabledAt`。不直接手改單一布林值，不刪除控制物件來重新啟用；管理手冊附啟用、停用、查看狀態指令。
    - 停用後，新排程啟動時直接返回。已執行中的輪次在發布前確認控制仍啟用且版本與啟動時相同，否則丟棄結果。API 核對控制版本、快照版本與 `attemptedAt >= enabledAt`，並在完成讀取前再次確認控制版本；不符就回空快照。即使出現停用 → 重新啟用 → 舊工作結束的順序，舊數字也不能重新公開。
    - 控制停用時依 §4.3 回 `enabled: false`、`snapshot: null`；前端撤價並回一般排序，保留分店卡片、綠色標記、Google Maps／官網連結、導航、收藏與換匯點開關。篩選仍依 §3.1，包含換匯點略過踩點類別／主題的規則。**不需重新部署、不需改 Notion 或 CSV。**
    - 前端同步採 §5.10 的 60 秒確認與 8 秒請求逾時；停用不要求正在背景或離線的頁面即時同步，但恢復可見或連線後必須先處理已過期數字並立即確認。
    - 重新啟用時，新版本的 breaker 計數歸零，但管理腳本必須保留尚未到期的 `blockedUntil`（含 `Retry-After`），不能靠切換開關提前重抓。封鎖期已過時，首次抓取沿用下一個每 30 分鐘排程，也可由管理者按手冊人工觸發。只有本次啟用後新抓取且有效的快照可恢復數字；等待期間顯示「暫無報價」。訪客開關與一般排序不變，不自動切回先前的匯率排序。
    - 若只改環境變數，必須另外建立新的部署才會生效；上線手冊要把這一步寫清楚，避免誤以為改完即生效。
13. 本機、Deploy Preview 與正式環境使用獨立儲存命名；非正式環境不得寫正式快照與正式控制旗標。Deploy Preview 不會自動排程，只能手動觸發，測試計畫不得假設它會自己跑。首次正式上線先人工執行一輪（UI Run now 或 `netlify functions:invoke`），再驗證接下來兩個批次。

若正式環境無法穩定在 30 秒限制內完成，才調整成排程觸發受保護的背景工作（Netlify Background Functions 上限 15 分鐘），並另行驗證併發及權限。

## 6. 分階段實作與主要檔案

| 階段 | 工作 | 主要檔案／範圍 | 完成條件 |
| --- | --- | --- | --- |
| A | 確認 §2.2 的報價時間欄位；固定來源契約、純資料解析及驗證 | 新增 `src/data/exchange-rates.js`（`RATE_SCALE`、型別、解析與對照）、來源 adapter、測試 fixture 與驗證測試 | 正確區分買入／賣出、USD 面額、分店身分、缺值；輸出只含 §4.3 的列舉與單一倍率整數 |
| B | 整理全部分店、去重與正式建檔 | Notion、既有 exporter、`data/locations.csv`、`data/superrich-branches.json`、`src/data/destinations.js`、`scripts/formal-location-current-schema.mjs`、`src/data/csv-parser.js` | 所有來源分店有唯一對照、有效座標、來源連結；`DESTINATIONS`、`DESTINATION_OPTION_COLORS` 與 Notion select 選項三處一致並通過 exporter 的 schema gate；快照通過 validator（公開列不得有空目的地） |
| C | 建立定時抓取、breaker、控制旗標與共用最新快照 | 新增 `netlify/functions/exchange-rates-fetch.mjs`（排程）與 `netlify/functions/exchange-rates.mjs`（HTTP）、共用儲存模組、breaker 與 control 模組、`scripts/exchange-rates-control.mjs`、`@netlify/blobs` 相依、`netlify.toml`（`included_files` 需加入 `data/superrich-branches.json`）、`EXCHANGE_RATES_ENABLED` | 請求間隔與逾時／重試預算固定；完整／部分成功與整輪失敗明確；API no-store；403／429 優先退避；條件寫入與控制版本防止舊工作復活 |
| D1 | 混合地圖、雙語卡片、免責元素、換匯點開關、單店綠色標記、排序與恢復查詢 | `src/core/state.js`、`src/features/`（含純函式排程 `nextExchangeAction`）、`src/ui/render.js`、`src/map/map.js`、`src/main.js`、`src/app/app-coordinator.js`、`src/core/i18n.js`、`index.html`、`styles.css` | 換匯點略過類別／主題，保留共用篩選；每 60 秒向本站確認、逾期後仍可恢復；三列報價與提示雙語同顯、預設關閉且持久化、Google／HERE 單店綠色標記一致、停用保留分店、排序與更新不破壞定位及收藏 |
| D2（可延後） | 群聚著色 | `src/map/map.js`（Google `clusterRenderer` 解構 `markers`、HERE `forEachDataPoint`） | 全綠群聚顯示綠色，混合群聚沿用現有樣式 |
| E | 本機整合測試與上線手冊 | `tests/`、README、`note/TECH_DECISIONS.md`、`note/LOCAL_TESTING.md` | 驗證通過、資料來源故障可降級、排程首次啟用、breaker 復原、執行期停用與環境變數需重新部署的差異都寫入手冊 |

只新增必要的模組與小範圍連接，不搬動整體架構。技術決策文件中舊有 marker 狀態上色範例與目前程式不一致；本功能以現有程式與最新資料契約為準。

## 7. 驗收與測試

- 逐分店比對來源買入價；覆蓋本店、商場、外府、機場，確認沒有誤用本店或其他店的報價。
- 26 店初始資料完整；檢查分店座標、實際商場樓層、Google Maps 連結、中文名稱與目的地分類。
- **exporter schema gate**：`npm run locations:export:notion` 在三處一致時通過；分別模擬「code 有、Notion 無」「Notion 有、code 無」「顏色不一致／漏加顏色」三種情形，確認各自產生 `missing`／`unexpected`／`wrongColors` 並中止匯出（可擴充 `tests/formal-location-current-schema.test.mjs`）。
- **目的地驗證**：`node scripts/validate-location-snapshot.mjs` 對含 26 店的快照通過；刻意把一筆公開分店的 Destination Key 清空應驗證失敗（回歸測試新增 `chonburi`／`si-racha` 後的 `isValidDestinationPair`）。
- 三種排序各自正確；涵蓋同價、部分缺值、全無報價、精度較多的 TWD、篩選後結果與語系切換。
- **數值比較**：驗證不同小數位寫法（`0.8912`、`0.89120`）產生相同的 `rateScaledE6`；驗證所有列使用同一個 `RATE_SCALE`，不存在各列不同倍率；驗證超出安全整數或非有限值被判為無效報價。
- **免責與提示元素**：有報價、部分缺值、全無報價三種狀態下，`fx_disclaimer`、`fx_source_note`、`fx_hours_note` 都出現在卡片與 popup；zh／en 皆有；320px 下不截斷、不水平溢出；快照與畫面都沒有來源營業文字。
- **換匯點開關與篩選**：預設關閉且持久化；關閉時分店不進入 `visIdx`、marker、計數及類別選項。開啟後，曼谷 + LingOrm + 餐廳仍能看到曼谷換匯分店；目的地、搜尋與收藏仍可排除分店，踩點維持既有全部篩選。選換匯類別後關閉開關，類別回「全部」；其他類別／主題不被重置。切換關閉時排序回一般、換匯 `activeIdx` 清除但收藏不刪除；停用匯率服務則保留分店選取狀態。
- **來源契約**：以 §2.2 的實測 fixture 驗證 `unit`+`denomRem` 完全相符才對應列舉；`20 - 10`／`5`／`1` 被忽略；面額字串被改動時記為 `missing` 而非猜測。驗證兩種 `googleLink` 網域（`www.google.com`、`maps.app.goo.gl`）都通過白名單，其他網域被丟棄。驗證同一店各列 `branchCode` 不一致時整店標記失敗。
- **排程純函式**：`nextExchangeAction(now, state)` 的全部時序驗收（60s、`nextUpdateAt` jitter、10/20/40 退避、`expiresAt` 到期、背景／離線、取消後晚到回應）以直接呼叫純函式斷言，不使用真實計時器等待。
- **抓取節奏**：全天每 30 分鐘；單輪併發不超過 2、所有請求啟動間隔至少 200ms。驗證 5 秒單次 timeout、25 秒來源截止、取消未完成請求及儲存餘裕；正常請求數為「分店數 + 1」，額外來源重試全輪至多 1 次且不包含 403／429。重試不能擠掉其他分店的首次派送，`Retry-After` 超出預算則放棄重試。
- **API 與快取**：正常、停用與錯誤回應均 no-store，瀏覽器也不用快取。先讀舊批次再更新 Blobs，下一次 API 必須反映新結果；停用回固定外層、`enabled: false`、`snapshot: null`，所有路徑都不回過期或版本不符的數字。控制讀取故障回 503，不回退環境變數或誤報停用。
- **刷新與恢復**：可見且換匯點開啟時每 60 秒確認，另在 `nextUpdateAt`～`nextUpdateAt + 30s` 確認新輪次；來源正常於 25 秒內完成且 API 正常時不出現空窗。涵蓋初次失敗、相同 `runId`、空快照、HTTP 錯誤、跨過 `expiresAt` 的 10s／20s／40s → 60s 重試；過期撤價後仍能無需重新整理而恢復。重讀相同批次不延長壽命，過去的更新時點不造成忙迴圈，同時最多一個 API 請求。
- **背景與離線**：隱藏頁面或關閉開關不持續輪詢；取消後舊回應不得覆蓋新狀態。切回可見或恢復連線時先處理到期，再立即確認；模擬裝置時鐘偏差也不能延長報價壽命。正常可見及 API 可用時，驗證停用確認不晚於下一個 60 秒時點加最多 8 秒請求時間。
- **circuit breaker**：同輪同時有 200 與 403／429 時，封鎖規則優先、停止新派送且只升級一次；較晚成功回應不能清掉紀錄。驗證 6h → 24h → 停用，`Retry-After` 秒數／日期取較晚期限；完整成功才清除全部紀錄，部分成功只歸零連續整輪失敗數；連續 3 輪整輪失敗退避 1h。封鎖期間零來源請求，舊控制版本不得重置新 breaker 或停用新版本。
- **停用開關**：管理者與 breaker 停用均產生新控制版本；新輪次不抓取，舊版本不發布可讀報價。前端三列改「暫無報價」、撤下最佳標示並回一般排序；保留分店卡片、綠色標記、開關、導航、收藏及兩個查詢連結，既有 popup 仍指同一店。篩選依 §3.1，原本關閉的開關維持關閉；Google／HERE 與 zh／en 均須覆蓋。
- **重新啟用與版本競態**：依序模擬舊工作開始、停用、重新啟用、新工作完成、舊工作才完成；API 只能公開新啟用版本的有效快照。控制變更發生在發布或 API 讀取期間也不能洩出舊版本數字。尚無新快照時持續無報價，開關偏好及一般排序不變。
- **初始化與管理**：控制 key 不存在時的 API 為空快照；排程初始化需 `onlyIfNew` 成功後重讀版本才能抓取。已有控制旗標時，改環境變數不能覆蓋它；不存在旗標時，環境變數修改仍需重新部署。驗證管理腳本的啟用、停用及狀態查詢、重新啟用仍保留未到期的封鎖期限，並確認 Preview／本機不修改正式 store。
- 模擬 429、timeout、非 JSON、錯誤分店代碼、缺面額、無效數字、來源改結構、儲存失敗、排程漏跑與過期快照。
- 快照契約測試：來源回傳含 HTML／引號／控制字元的字串時，快照只保留列舉與數字，不含任何原始字串；非白名單網域的 `googleLink` 被丟棄。
- 條件寫入測試：etag 必須於來源抓取前讀取；涵蓋首次 `onlyIfNew` 與既有 `onlyIfMatch` 衝突、`modified: false` 不強行重試，及快照／breaker／control 的控制版本驗證。不可只驗證單一 key 寫入而忽略跨 key 的版本關聯。
- 確認新輪次失敗不保留舊數字、不冒充已更新；開著的 popup 和排序也立即反映到期。
- 同一分店排序前後、刷新後仍開啟正確位置，收藏 Slug 與共享收藏連結保持穩定。
- Google Maps、HERE fallback、深淺色與 320px 手機版都能看清三列報價、時間、免責與連結，沒有水平溢出。
- i18n：新增的所有字串（`fx_toggle`、`fx_filter_note`、`fx_loading`、排序選項、面額標籤、無報價原因、免責、來源標示、營業時間提示、時間標示）在 zh／en 都有對應，並依 `AGENTS.md` 規則 3 更新 `tests/i18n-ui.test.mjs`。
- 確認快照 API 不包含 source 介面的無關欄位、憑證或第三方 Cookie；外部文字與 URL 在插入 HTML 前做好安全處理。
- 確認送出的 `User-Agent` 含站台網址與聯絡方式，且未攜帶任何 Cookie 或授權標頭。
- 本機用 Netlify Dev 人工觸發排程 Function；Preview 只能人工觸發，不假設它會自動執行。

實作後必要檢查：

```bash
npm run typecheck
npm test
npm run build
node scripts/validate-location-snapshot.mjs data/locations.csv
node scripts/validate-favorite-compatibility.mjs
npm run location:verify -- validate --all
```

正式 Notion schema／選項修改（新增 `Currency Exchange` 類別與 `chonburi`／`si-racha` 目的地，含 `DESTINATION_OPTION_COLORS` 的對應顏色）與快照匯出需一併驗證。啟動排程、提交、推送、PR 與部署均留待實作與相應使用者指示，不在本次規劃中執行。

## 8. 本次交付界線

使用者已核准並完成 M1、M2 與 M3 程式實作：來源契約、26 店建檔與發布、快照與對照驗證、停用狀態下的排程、Blobs、breaker、控制旗標、唯讀 API，以及前端換匯點與匯率比較介面均已完成。正式站台仍維持既有版本，匯率服務尚未在 production 啟用；PR Deploy Preview 驗收、正式發布、服務啟用及 M4 的實際進度見 [進度紀錄](superrich-exchange-map-progress.zh-TW.md)。

## 9. 建檔與識別決定

以下三項已於 M1 依核准預設值實作；逐店證據與 Notion 頁面見 [建檔查證](superrich-branch-verification.zh-TW.md)。

### 9.1 換匯分店的識別方式與對照檔

「Slug → 官方 ID 對照」有三個消費者：排程 function（要抓哪 26 個 ID）、前端（哪些 row 是換匯分店，才能套用 §3.1 的略過類別規則）、驗證（來源分店與收錄分店對照完整）。

| 方案 | 做法 | 取捨 |
| --- | --- | --- |
| **A（採用）獨立 JSON** | `data/superrich-branches.json` 供後續前端與 function 共用；`netlify.toml` 的 `included_files` 已加入此檔 | 單一 source of truth；獨立 validator 已接入建置檢查 |
| B 前端用 Category 判斷 | 前端看 `catEn === 'Currency Exchange'`，function 另存 ID 清單 | 兩份判斷邏輯；改 Notion 類別名即失效；違反 §3.1「不依名稱猜測」 |
| C CSV 加欄位 | 加第 18 欄 | 破壞 17 欄契約與既有 parser／validator 測試，排除 |

採方案 A。檔案格式：

```json
{
  "schemaVersion": 1,
  "branches": {
    "superrich-thailand-28": { "officialId": 28, "branchCode": "M17" }
  }
}
```

26 店 `branchCode` 已收齊，對照設定不得留 `null`。`scripts/validate-superrich-mapping.mjs` 檢查 Slug、`officialId` 與分店代碼唯一，逐筆核對 CSV 存在且類別為 `Currency Exchange`，具有有效泰國目的地與座標；可另傳來源 options JSON，檢查新增／消失的來源 ID。

### 9.2 26 店的 Notion 欄位填寫範本

`validate-location-snapshot.mjs` 對 `Published` 只強制 Lat／Lng、有效 Google Maps URL、Country Code + Destination Key，其餘欄位仍須有一致填法：

| 欄位 | 建議值 |
| --- | --- |
| `Category` | `Currency Exchange` |
| `Icon` | `💱`（單一 emoji；綠色由 §3.3 的 CSS 決定，不靠 emoji 表達） |
| `Location Name` | 來源 `label` 去除換行後的分店名（例：`Terminal 21 Asok G Floor`） |
| `Location Name ZH` | 人工中文名（例：`SuperRich Terminal 21 Asok 分店`） |
| `Notes` / `Notes ZH` | 來源 `address` 的樓層／位置描述雙語化；**不得**填入營業時間（§2） |
| `Source URL` | 官方匯率頁 `https://www.superrichthailand.com/exchange-rate` |
| `Source Tags` | 留空；正式 schema 無 `official` 選項，不新增標籤字彙，官方來源保存在 `Source URLs` |
| `Verification Status` | 先 `Paused`，逐店核對商場樓層後才改 `Published` |
| `Type` | 留空（§4.2） |

Notion 實際屬性為 `Name`／`Name ZH`、`Notes EN`／`Notes ZH`、`Source URLs`、`Status`；上表對應既有 CSV 17 欄。`Icon` 為頁面 emoji，非新增屬性。`Review Needed=true`、`Last Verified` 留空；Happitat 與機場店未確認櫃位專屬 Place ID，先保留官網提供連結與待審註記，發布前須解決。

`Verification Status` 先設 `Paused` 不影響抓取：抓取目標來自 §9.1 的對照檔，不是 CSV 的公開狀態；未公開的分店不會出現在地圖上，但排程仍會為它們取得報價。這是刻意的，讓資料核對與匯率管線可以並行。

### 9.3 26 店的目的地歸屬

規則：芭達雅用 `pattaya`；曼谷都會區與機場歸 `bangkok`；Chonburi 市區用 `chonburi`；Si Racha 用 `si-racha`。Westgate／Westville 位於 Nonthaburi，Happitat／素萬那普機場位於 Samut Prakan，已依都會區／機場規則定案為 `bangkok`；證據見建檔查證。

## 10. 附錄：26 間分店清單（2026-09-09 唯讀查證）

來源 `GET /branch-client/options`，官方 ID 為連續的 10–35，共 26 間，與 §2 的計數一致。`branchCode` 已全數填入 §9.1 的對照檔。

| 官方 ID | Slug | 來源 label | Destination Key |
| --- | --- | --- | --- |
| 10 | `superrich-thailand-10` | Headquarter Rajdamri 1 | `bangkok` |
| 11 | `superrich-thailand-11` | Vibhavadi 22 | `bangkok` |
| 12 | `superrich-thailand-12` | The Mall Thaphra 3rd floor | `bangkok` |
| 13 | `superrich-thailand-13` | Central Rama 2 G floor | `bangkok` |
| 14 | `superrich-thailand-14` | Gaysorn Centre 2nd floor | `bangkok` |
| 15 | `superrich-thailand-15` | The Platinum Fashion Mall 1st floor | `bangkok` |
| 16 | `superrich-thailand-16` | MBK Center 3rd floor | `bangkok` |
| 17 | `superrich-thailand-17` | Central World 1st floor | `bangkok` |
| 18 | `superrich-thailand-18` | Central Ramindra 3rd floor | `bangkok` |
| 19 | `superrich-thailand-19` | Central Ladprao 2nd Floor | `bangkok` |
| 20 | `superrich-thailand-20` | Central Westgate 3rd Floor | `bangkok`（Nonthaburi，曼谷都會區） |
| 21 | `superrich-thailand-21` | Central Rama 3 4th Floor | `bangkok` |
| 22 | `superrich-thailand-22` | Paradise Park 2nd Floor | `bangkok` |
| 23 | `superrich-thailand-23` | Central Westville 1st Floor | `bangkok`（Nonthaburi，曼谷都會區） |
| 24 | `superrich-thailand-24` | Mahanakhon Cube G floor | `bangkok` |
| 25 | `superrich-thailand-25` | The Mall Bangkapi 2nd Floor | `bangkok` |
| 26 | `superrich-thailand-26` | Fashion Island B Floor | `bangkok` |
| 27 | `superrich-thailand-27` | Terminal 21 Rama 3 LG Floor | `bangkok` |
| 28 | `superrich-thailand-28` | Terminal 21 Asok G Floor | `bangkok` |
| 29 | `superrich-thailand-29` | Central Chidlom G Floor | `bangkok` |
| 30 | `superrich-thailand-30` | Central Pattaya 1st Floor | `pattaya` |
| 31 | `superrich-thailand-31` | Central Pinklao 4th Floor | `bangkok` |
| 32 | `superrich-thailand-32` | Central Chonburi 1st Floor | `chonburi` |
| 33 | `superrich-thailand-33` | Central Si Racha 2nd Floor | `si-racha` |
| 34 | `superrich-thailand-34` | Happitat 3rd Floor, Bloominas Building | `bangkok`（Samut Prakan，曼谷都會區） |
| 35 | `superrich-thailand-35` | Suvarnabhumi Airport B floor | `bangkok`（Samut Prakan，機場規則） |

來源 label 只作為建檔起點，正式名稱、樓層與座標仍須依 §9.2 逐店人工核對；本表不取代 Phase B 的驗證。
