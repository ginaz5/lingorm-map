# Local Testing Before Netlify Deploy

本專案使用 Netlify 免費方案時，建議先在本機完整測試，確認沒問題後才 push 到 GitHub 觸發 Netlify deploy，以節省 deploy credits。

Notion snapshot 的完整 export → preview → production → rollback 流程請參考
[`docs/notion-deploy-workflow.md`](../docs/notion-deploy-workflow.md)。

## 目標

- 本機驗證 HTML、Netlify Function、目前選定的 location data source 都正常
- 確認後才 push feature branch、建立 PR，並驗證 Netlify Deploy Preview
- 避免每次小修改都觸發 Netlify deploy

## 前置設定

確認已安裝 Netlify CLI：

```bash
netlify --version
```

如果尚未安裝：

```bash
npm install -g netlify-cli
```

第一次使用需登入並連結站台：

```bash
netlify login
netlify status
```

如果尚未 link：

```bash
netlify link
```

## 本機環境變數

在專案根目錄建立 `.env`，內容可參考 `.env.example`：

```bash
GOOGLE_MAPS_KEY=your_google_maps_key
GOOGLE_MAP_ID=your_google_map_id
HERE_API_KEY=your_here_api_key
DATA_SOURCE=notion
```

注意：

- `.env` 已在 `.gitignore` 中，不要 commit。
- `DATA_SOURCE=notion` 會讀取已提交並驗證的 `data/locations.csv`，是唯一支援的值，也是未設定時的預設值。舊版 `DATA_SOURCE=sheet` 回滾路徑已於 2026-07-21 三狀態 cutover 後停用（`build.sh` 會直接拒絕），不要使用。
- 不要直接用瀏覽器打開 `index.html` 測試，因為那樣測不到 `/api/locations` Netlify Function。

## 每次修改後的本機測試流程

1. 跑靜態型別檢查：

```bash
npm run typecheck
```

預期 TypeScript 以 strict、no-emit `checkJs` 模式完成且沒有錯誤。專案 runtime 仍是 JavaScript，這一步不會產生編譯檔。

2. 跑自動測試：

```bash
node --test tests/*.test.mjs
```

預期結果：

```text
pass 106
fail 0
```

實際測試數量可能會隨新增測試而增加，重點是 `fail 0`。

3. 啟動 Netlify 本機環境：

```bash
netlify dev
```

通常會開在：

```text
http://localhost:8888
```

4. 測試 API：

先確認 Google Maps runtime config：

```text
http://localhost:8888/api/config
```

預期：

```json
{"googleMapsKey":"...","googleMapId":"..."}
```

再確認 location CSV endpoint：

```text
http://localhost:8888/api/locations
```

預期：

- 看到 CSV 內容
- 第一行是所選來源的 app schema。`DATA_SOURCE=notion` 時應為：

```text
"Location Name","Location Name ZH","Thai / Alt Name","Google Maps URL","Category","Notes","Notes ZH","Source URL","Source Tags","Verification Status","Lat","Lng","Icon","Country Code","Destination Key","Type","Slug"
```

如果回傳錯誤 JSON，先執行 `node scripts/validate-location-snapshot.mjs data/locations.csv`。

如果地圖顯示「這個網頁並未正確載入 Google 地圖」，請到 Google Cloud Console 的 Maps API key restriction 加入本機 referrer：

```text
http://localhost:8888/*
```

若你使用不同 port，也要加入對應 port，例如：

```text
http://localhost:8889/*
```

5. 測試網站首頁：

```text
http://localhost:8888
```

檢查：

- 地圖正常載入
- 卡片名稱、類別、說明正常顯示，且不顯示審核狀態
- 沒有空白卡片
- marker popup 不再顯示「在 Google Maps 開啟 / Open in Google Maps」
- 語言切換正常
- 篩選順序為「類別／主題／目的地」；英文篩選標籤為 Type，中文主題顯示 LingOrm、JKR 推薦、JKR 應援、留友看，英文維持正式 Type 值
- 主題可與搜尋、類別、目的地及收藏條件正確交集篩選
- Google Maps 與 HERE Maps popup 都同時顯示類別與 Type badge
- 目的地可跨國複選，國家 checkbox 能全選／取消子目的地，部分選取時顯示 indeterminate
- 目的地變更立即套用，重新整理後保留，且地圖自動縮放至全部篩選結果
- 手機版 map/list tab 正常
- 問題回報可開啟、驗證必填欄位並完成本機 mock 送出
- 列表與地圖只顯示 `Published`

## 確認後才部署

確認本機測試都通過後，再 commit：

```bash
npm run typecheck
node --test tests/*.test.mjs
npm run build
git status --short
git add <changed-files>
git commit -m "your commit message"
```

最後才 push feature branch：

```bash
git push -u origin <feature-branch>
```

接著建立 PR：

1. 等待 Netlify Deploy Preview 完成。
2. 在 preview URL 重跑 API、地圖、篩選與 favorites 檢查。
3. 確認 preview 正常後才 merge PR；merge 到 `main` 才會觸發 production deploy。

## 省 Netlify credits 的原則

- 可以多次 local edit、local test、local commit。
- 不要直接 push 到 `main`；使用 feature branch + PR Deploy Preview。
- 等本機確認後再 push feature branch。
- PR preview 驗證完成後才 merge；production branch 的更新會觸發 production deploy。

## 常見問題

### API 沒有回傳預期的 location 資料

可能原因：

- `/api/locations` 無法取得 CSV
- CSV headers 不符合 app schema
- `DATA_SOURCE` 沒有被 `netlify dev` 載入，或誤設為已停用的 `sheet`
- `data/locations.csv` 遺失或驗證失敗

先打開：

```text
http://localhost:8888/api/locations
```

確認 API 回傳內容。

### 地圖顯示 Google Maps 載入錯誤

可能原因：

- `/api/config` 沒有回傳 `googleMapsKey` / `googleMapId`
- `.env` 沒有設定 `GOOGLE_MAPS_KEY` 或 `GOOGLE_MAP_ID`
- Google Cloud Console 的 API key HTTP referrer restriction 沒有允許 `http://localhost:8888/*`

先打開：

```text
http://localhost:8888/api/config
```

如果 config 正常，再檢查 Google Cloud Console 的 key restriction。

### 直接開 index.html 看起來正常，可以算通過嗎？

不算。直接開檔案只能測靜態 HTML 和內建資料，不能測 Netlify Function、環境變數、`/api/locations`。
