# 搜尋 Notes 增強計劃

## 目標

讓使用者可以明確且一致地透過地點名稱或內文關鍵字搜尋地點，並確保搜尋結果數量、地點清單與地圖標記呈現相同結果。

## 現況

- `src/render.js` 的 `applyFilters()` 已比對：
  - 英文名稱 `nameEn`
  - 中文名稱 `nameZh`
  - 別名 `alt`
  - 英文內文 `notesEn`
  - 中文內文 `notesZh`
- 因此，清單目前已具備基本的 Notes 關鍵字搜尋能力。
- 搜尋框提示僅顯示「搜尋地點…」／「Search locations…」，使用者不容易知道 Notes 也可搜尋。
- 地圖標記沒有完整套用搜尋文字與分類篩選，可能與清單顯示不同結果。
- 目前缺少專門驗證 Notes 搜尋行為的自動化測試。

## 執行範圍

### 1. 驗證並保護既有 Notes 搜尋

- 使用正式資料進行手動驗證，例如搜尋「香蕉味」應找到 `32Bar X`。
- 驗證中文與英文 Notes 都能被搜尋。
- 補上自動化測試，避免未來重構時意外移除 Notes 搜尋。

### 2. 改善搜尋功能的可發現性

調整搜尋框提示文字：

- 中文：`搜尋地點或內文關鍵字…`
- 英文：`Search names or notes…`

### 3. 統一清單與地圖篩選結果

- 將公開狀態、搜尋文字、分類與收藏條件集中為共用的地點比對邏輯。
- 清單繼續以符合全部條件的資料產生 `state.visIdx`。
- Google Maps MarkerClusterer 僅顯示 `state.visIdx` 中有有效座標的地點。
- HERE Maps clustering 僅建立 `state.visIdx` 中有有效座標的地點。
- 搜尋、分類與收藏條件應可同時使用。

## 不在本次範圍

- 模糊搜尋或拼字容錯
- 搜尋結果相關性排序
- 關鍵字高亮
- 搜尋建議或自動完成
- 外部搜尋服務或搜尋索引
- debounce 效能調整
- 改變目前 popup 或選取地點的互動方式

上述能力應等實際使用資料顯示有需求後，再另行規劃。

## 測試計劃

### 自動化測試

至少涵蓋下列案例：

1. 英文名稱命中。
2. 中文名稱命中。
3. 別名命中。
4. 英文 Notes 關鍵字命中。
5. 中文 Notes 關鍵字命中。
6. 名稱與 Notes 都未命中。
7. 在中文介面搜尋英文 Notes。
8. 在英文介面搜尋中文 Notes。
9. Notes 搜尋搭配分類篩選。
10. Notes 搜尋搭配收藏篩選。
11. Google Maps marker 與清單結果一致。
12. HERE Maps marker 與清單結果一致。
13. 非 `Published` 地點不會因 Notes 命中而公開顯示。

### 手動驗收

- 搜尋正式資料中的名稱與 Notes 關鍵字。
- 確認結果數量與清單項目相符。
- 在地圖與清單頁籤之間切換，確認地圖標記沒有出現額外地點。
- 分別使用 Google Maps 與 HERE Maps provider 驗證。
- 切換中英文介面後重複測試。
- 搭配分類與收藏篩選確認交集結果。

## 驗收條件

- 使用者能以地點名稱、別名、`Notes` 或 `Notes ZH` 的文字找到地點。
- 介面語言不會限制可搜尋的 Notes 語言。
- 搜尋框清楚說明可以搜尋名稱與內文。
- 結果數量、地點清單與地圖標記一致。
- 搜尋、分類及收藏篩選能共同運作。
- 非公開地點仍維持隱藏。
- 現有名稱搜尋、分類、收藏與地圖互動沒有退化。

## 風險與控制方式

### 誤把既有能力當成新功能重寫

Notes 比對已經存在。本次應優先補測試與修正呈現一致性，避免不必要地更換搜尋演算法。

### 清單與地圖使用不同判斷

避免在不同 provider 中重複實作搜尋條件；應共用同一份篩選結果或比對函式。

### 地圖重建成本

目前資料量不大，第一版不需要引入 debounce。若 HERE Maps 在每次輸入時重建 clustering 出現可感知延遲，再以實測結果規劃效能改善。

## 建議實作順序

1. 新增 Notes 搜尋的回歸測試。
2. 建立或整理共用篩選判斷。
3. 讓 Google Maps marker 套用完整篩選結果。
4. 讓 HERE Maps marker 套用完整篩選結果。
5. 更新中英文搜尋框提示文字。
6. 執行自動化測試、型別檢查與正式資料手動驗收。

## 實作進度

| 階段 | 狀態 | 完成內容 |
| --- | --- | --- |
| 1. Notes 搜尋回歸測試 | ✅ 完成 | 新增 `tests/search-filter.test.mjs`，覆蓋英文名稱、中文名稱、別名、雙語 Notes、跨介面語言搜尋、無結果、分類、收藏與非公開狀態。 |
| 2. 共用篩選判斷 | ✅ 完成 | 新增 `matchesLocationFilters()`，集中處理公開狀態、收藏、名稱／別名／雙語 Notes、分類及搜尋文字正規化。 |
| 3. Google Maps markers | ✅ 完成 | MarkerClusterer 的 add/remove 與無 clustering fallback 都改以 `state.visIdx` 決定可見標記。 |
| 4. HERE Maps markers | ✅ 完成 | HERE clustering 僅以 `state.visIdx` 中的公開地點建立 DataPoint。 |
| 5. 雙語搜尋提示 | ✅ 完成 | 中文改為「搜尋地點或內文關鍵字…」，英文改為「Search names or notes…」，並新增字串測試。 |
| 6. 完整驗證 | ✅ 完成 | 完整測試、型別檢查、production build、正式 CSV 查詢與本機瀏覽器驗收全部通過；review 修正後為 233 項測試。 |

### 進度紀錄

#### 2026-07-23：階段 1 完成

- 新增 Notes 搜尋回歸測試。
- 確認既有搜尋會比對名稱、別名、`notesEn` 與 `notesZh`。
- 確認搜尋 Notes 不受目前介面語言限制。
- 確認 Notes 搜尋可與分類及收藏共同使用，且不會公開非 `Published` 地點。
- 驗證指令：`node --test tests/search-filter.test.mjs`
- 驗證結果：2 項測試全部通過。

#### 2026-07-23：階段 2 完成

- 在 `src/render.js` 新增共用的 `matchesLocationFilters()`。
- 搜尋欄位統一涵蓋英文名稱、中文名稱、別名、英文 Notes 與中文 Notes。
- 搜尋文字使用 NFKC Unicode 正規化、大小寫正規化及前後空白移除。
- 公開狀態、收藏與分類條件集中在同一個判斷函式。
- `applyFilters()` 改為只依共用判斷產生 `state.visIdx`。
- 驗證指令：`node --test tests/search-filter.test.mjs tests/favorites.test.mjs tests/public-notfound.test.mjs`
- 驗證結果：10 項測試全部通過；`npm run typecheck` 通過。

#### 2026-07-23：階段 3 完成

- Google Maps MarkerClusterer 改以 `state.visIdx` 的完整篩選結果執行 marker add/remove。
- 無 MarkerClusterer 的 Google Maps fallback 同樣改以 `state.visIdx` 設定 marker map。
- 新增 Google clustering 與 fallback 的 Notes 搜尋一致性測試。
- 驗證指令：`node --test tests/search-filter.test.mjs tests/favorites.test.mjs`
- 驗證結果：9 項測試全部通過；`npm run typecheck` 通過。

#### 2026-07-23：階段 4 完成

- HERE Maps clustering 改為只替 `state.visIdx` 中的地點建立 DataPoint。
- 保留公開狀態與有效座標檢查，避免非公開或無座標資料進入地圖。
- 更新既有公開狀態地圖測試，明確設定 HERE provider 與可見索引。
- 新增 HERE clustering 與 Notes 搜尋結果一致性測試。
- 驗證指令：`node --test tests/search-filter.test.mjs tests/public-notfound.test.mjs`
- 驗證結果：8 項測試全部通過；`npm run typecheck` 通過。

#### 2026-07-23：階段 5 完成

- 更新中文搜尋提示為「搜尋地點或內文關鍵字…」。
- 更新英文搜尋提示為「Search names or notes…」。
- 新增雙語搜尋提示字串測試。
- 驗證指令：`node --test tests/i18n-ui.test.mjs tests/search-filter.test.mjs`
- 驗證結果：9 項測試全部通過；`npm run typecheck` 通過。

#### 2026-07-23：階段 6 完成

- `npm test`：232 項測試全部通過。
- `npm run typecheck`：通過。
- `npm run build`：production build 成功。
- 正式 `data/locations.csv` 搜尋「香蕉味」：命中 `32Bar X`。
- 本機瀏覽器中文介面搜尋「香蕉味」：
  - 結果顯示 `1 / 103`。
  - 清單僅顯示 `32Bar X`。
  - HERE Maps 僅顯示 1 個 marker。
- 切換英文介面後保留中文搜尋字：
  - 搜尋提示更新為 `Search names or notes…`。
  - 中文 Notes 關鍵字仍命中 `32Bar X`。
- 搜尋「香蕉味」搭配 `Cafe`：
  - 清單與地圖均維持 1 筆結果。
- 搜尋「香蕉味」搭配 `Restaurant`：
  - 結果顯示 `0 / 103`。
  - 清單與地圖均無結果。
- 計劃中的自動化驗收與可在本機環境完成的手動驗收均已通過。

#### 2026-07-23：Code review 修正完成

- Google Maps `buildMarkers()` 仍建立所有公開 marker，方便之後解除篩選，但 MarkerClusterer 初始化時只加入目前 `state.visIdx` 中的 marker。
- Google Maps 延遲初始化或主題切換重建後，不會再讓地圖恢復顯示全部地點。
- 新增 Google marker 初始化與重建測試，確認 cluster 會跟隨最新篩選索引。
- 搜尋大小寫正規化改用不受瀏覽器預設語系影響的 `toLowerCase()`，避免土耳其語等語系造成 ASCII 關鍵字比對差異。
- `npm test`：233 項測試全部通過。
- `npm run typecheck`：通過。
- `npm run build`：production build 成功。
