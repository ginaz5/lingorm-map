# 地圖互動分析追蹤

更新日期：2026-08-08

## 目的與目前進度

網站已透過 `index.html` 載入 Google Tag Manager（`GTM-NVNXGP44`），由 GTM
連接 GA4（`G-31MF79LHFM`）。前兩批應用程式事件已完成：使用者探索、打開地點、
啟動地圖操作或變更偏好時，前端會將結構化事件推入 `window.dataLayer`。

已完成項目：

- `location_open`：記錄打開哪個地點，以及從清單卡片或地圖 marker 打開。
- `location_action`：記錄點擊大眾運輸導航或在 Google Maps 開啟。
- `favorite_toggle`：記錄加入或移除收藏。
- `filter_apply`：記錄分類、Type、目的地與收藏篩選器的變更及結果數。
- `search_complete`：輸入停止 700ms 後，記錄搜尋字數與結果數，不傳搜尋文字。
- `locate_result`：記錄定位成功、拒絕、逾時、不可用或不支援。
- `tab_view`：記錄使用者手動切換手機版地圖／清單 tab。
- `language_change`：記錄中文與英文之間的切換。
- Google Maps 與 HERE Maps marker 都使用 `map_marker` 來源。
- 清單卡片與 popup 的操作可分別識別為 `list_card`、`popup`。
- 未傳送搜尋文字、GPS 經緯度、聯絡資料或其他使用者輸入。
- 已加入自動測試，驗證事件名稱、共用維度與 GTM queue 行為。

前端完成不等於 GA4 已開始收到資料。仍需在 GTM 建立觸發條件與 GA4 Event
tag，預覽驗證後發布 container；設定步驟見下方。

## 地點互動事件契約

三個事件共用以下參數：

| 參數 | 範例 | 用途 |
|---|---|---|
| `location_id` | `the-siam-hotel` | 穩定的 Notion Slug；主要地點識別值 |
| `location_name` | `The Siam Hotel` | 英文地點名稱，方便閱讀報表 |
| `location_category` | `Hotel` | 正規化英文分類 |
| `location_type` | `JKR Picks` | 地點主題；空值送 `unspecified` |
| `destination` | `bangkok` | 正規化目的地 key |
| `map_provider` | `google` | `google`、`here` 或 `unavailable` |
| `ui_language` | `zh` | 事件發生時的介面語言 |
| `interaction_source` | `map_marker` | `list_card`、`map_marker`、`popup` 或 `unknown` |

事件特有參數：

| 事件 | 額外參數 | 可能值 |
|---|---|---|
| `location_open` | 無 | — |
| `location_action` | `action` | `directions`、`open_google_maps` |
| `favorite_toggle` | `favorite_action` | `add`、`remove` |

`location_name` 是報表顯示輔助值；跨版本串接與統計應以不輕易變動的
`location_id` 為準。事件次數代表互動次數，不等於不重複使用者數。

## 探索與偏好事件契約

這五個事件都包含 `map_provider` 與事件發生時的 `ui_language`。

| 事件 | 參數 | 行為 |
|---|---|---|
| `filter_apply` | `filter_type`、`filter_value`、`filter_action`、`selected_count`、`result_count` | 分類、Type、目的地或收藏篩選器由使用者變更後送出 |
| `search_complete` | `query_length`、`result_count`、`has_results` | 非空搜尋輸入停止 700ms 後送出；後續輸入會取消前一次排程 |
| `locate_result` | `result` | `success`、`denied`、`timeout`、`unavailable`、`unsupported` 或 `map_unavailable` |
| `tab_view` | `tab` | 使用者點擊 tab bar 時送 `map` 或 `list`；卡片自動切到地圖不會送出 |
| `language_change` | `from_language`、`to_language` | 使用者切換語言完成後送出 |

`filter_apply.filter_type` 可能是 `category`、`type`、`destination` 或
`favorites`。分類值固定正規化為英文，目的地單選值使用
`destination:<key>`，國家整組操作使用 `country:<code>`；清除目的地則使用
`filter_value=all`。`filter_action` 可能是 `set`、`select`、`deselect`、
`clear`、`enable` 或 `disable`。

## GTM 必要設定

在 GTM workspace 中完成以下設定：

1. 確認既有 Google tag／GA4 Configuration tag 使用 measurement ID
   `G-31MF79LHFM` 並在所有頁面載入。
2. 為上表參數建立 Data Layer Variable；Data Layer Variable Name 與參數名稱
   完全相同，使用 Version 2。
3. 為每個事件名稱建立一個精確匹配的 Custom Event trigger：
   `location_open`、`location_action`、`favorite_toggle`、`filter_apply`、
   `search_complete`、`locate_result`、`tab_view`、`language_change`。
4. 為每個事件建立對應的 GA4 Event tag，只加入該事件契約列出的參數與共用
   參數，再套用同名 trigger。不要用一個 tag 掛上所有事件的參數；Data Layer
   Variable 可能保留前一事件的值，造成不相關事件帶到舊參數。
5. 使用 GTM Preview／Tag Assistant，分別點擊清單卡片、marker、popup 操作及
   收藏按鈕，確認每次只觸發一個預期事件且參數正確。
6. 在 GA4 DebugView 再次核對事件，確認後發布 GTM container。

需要在 Preview 中一次觀察所有應用程式事件時，可另外使用以下 regex 作為除錯
trigger，但不要用它取代上述正式的事件專屬 tags：

```text
^(location_open|location_action|favorite_toggle|filter_apply|search_complete|locate_result|tab_view|language_change)$
```

## GA4 自訂定義與建議報表

在 GA4「管理 → 資料顯示 → 自訂定義」將以下參數註冊為事件範圍自訂維度：

- `location_id`
- `location_name`
- `location_category`
- `location_type`
- `destination`
- `map_provider`
- `ui_language`
- `interaction_source`
- `action`
- `favorite_action`
- `filter_type`
- `filter_value`
- `filter_action`
- `has_results`
- `result`
- `tab`
- `from_language`
- `to_language`

將下列數值註冊為事件範圍自訂指標：

- `selected_count`
- `result_count`
- `query_length`

建議先建立六個探索報表：

1. **熱門地點**：列使用 `location_id`、`location_name`，值使用事件計數與總使用者，
   篩選 `event_name = location_open`。
2. **地點行動意圖**：列使用 `location_name`、`action`，篩選
   `event_name = location_action`。
3. **收藏變化**：列使用 `location_name`、`favorite_action`，篩選
   `event_name = favorite_toggle`。
4. **篩選成效**：列使用 `filter_type`、`filter_value`、`filter_action`，值使用
   `result_count`，篩選 `event_name = filter_apply`。
5. **搜尋成效**：以 `has_results` 拆解事件數及使用者數，搭配 `query_length` 與
   `result_count`，篩選 `event_name = search_complete`。
6. **功能偏好**：依事件篩選後，分別以 `result`、`tab` 與語言切換方向檢視
   定位阻力、手機 tab 偏好及語言需求。

漏斗可設定為：`location_open` → `location_action`，並以 `location_id`、
`interaction_source` 或裝置類別拆解。由於第一版沒有唯一的「一次卡片瀏覽 ID」，
轉換率建議優先使用使用者數，而不是直接用事件次數相除。

## 接下來可收集的資訊

以下事件尚未實作，應依產品問題排序，而不是一次全部加入。

| 優先度 | 建議事件 | 建議參數 | 可回答的問題 |
|---|---|---|---|
| 中 | `favorites_filter_use` | `favorite_count`、`result_count` | 收藏是否被用於實際行程規劃 |
| 中 | `issue_report_result` | `result=success/validation_error/network_error` | 問題回報流程的開始、完成與失敗情況 |
| 低 | `theme_change` | `theme=light/dark` | 介面主題偏好 |
| 低 | `source_link_click` | `location_id`、`source_platform` | 哪些資料來源標籤會被進一步查閱 |

收藏篩選的開關與結果數目前已包含於 `filter_apply`；若現有資料足以回答需求，
可不再建立獨立的 `favorites_filter_use`，避免重複計數。

### 分析方向

- **探索效率**：篩選或搜尋後，有多少使用者打開地點。
- **無結果診斷**：哪些篩選條件最常產生零結果。
- **清單與地圖差異**：不同裝置從 `list_card` 或 `map_marker` 開啟的比例。
- **地點意圖漏斗**：打開地點 → 收藏 → 開啟導航／Google Maps。
- **內容缺口**：搜尋頻繁但無結果的主題或目的地。
- **來源品質**：不同 UTM campaign 帶來的使用者偏好哪些地點，以及行動意圖率。

## 隱私與資料品質界線

- 不傳送 GPS 經緯度，即使使用者允許網站定位。
- 不傳送問題回報內容、聯絡方式或其他表單欄位。
- `search_complete` 不傳送原始搜尋文字，只用長度與結果數衡量。若未來確實需要
  搜尋詞，應先完成隱私評估、過濾個資並更新隱私告知。
- 不建立使用者、工作階段或時間戳的高基數自訂維度。
- 正式環境應依適用地區的隱私規範維護同意機制、資料保存期限與隱私說明。

## 部署後驗證清單

- GTM Preview 顯示所有事件均命中預期 GA4 Event tag。
- 清單卡片送 `interaction_source=list_card`。
- Google 與 HERE marker 送 `interaction_source=map_marker`。
- popup 操作送 `interaction_source=popup`。
- 收藏加入／移除分別送 `favorite_action=add/remove`。
- 搜尋只送 `query_length`、`result_count`、`has_results`，且快速連續輸入只送最後一次。
- 定位事件沒有 GPS 座標。
- 手動 tab 切換會送事件，開卡片造成的自動切換不會送事件。
- 語言事件包含切換前後語言。
- GA4 DebugView 可看到事件及完整參數。
- GA4 自訂定義建立完成；等待處理後可在探索中使用。
- 瀏覽器封鎖分析工具時，地圖、卡片、導航與收藏仍正常運作。
