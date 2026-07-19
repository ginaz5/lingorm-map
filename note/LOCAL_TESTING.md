# Local Testing Before Netlify Deploy

本專案使用 Netlify 免費方案時，建議先在本機完整測試，確認沒問題後才 push 到 GitHub 觸發 Netlify deploy，以節省 deploy credits。

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
GOOGLE_SHEET_CSV_URL=your_google_sheet_csv_url
```

注意：

- `.env` 已在 `.gitignore` 中，不要 commit。
- `DATA_SOURCE=notion` 會讀取已提交並驗證的 `data/locations.csv`；`DATA_SOURCE=sheet` 則使用 Google Sheets 回滾來源。未設定時預設為 `sheet`。
- `GOOGLE_SHEET_CSV_URL` 僅在 `DATA_SOURCE=sheet` 時需要；它是 server-side secret，只給 Netlify Function 使用，不會暴露到前端。
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
"Location Name","Location Name ZH","Thai / Alt Name","Google Maps URL","Category","Notes","Notes ZH","Source URL","Source Tags","Verification Status","Duplicate Group","Lat","Lng","Icon","Coordinates Approx","Slug"
```

如果 `DATA_SOURCE=sheet` 時看到 Google Sheets HTML、登入頁、或錯誤 JSON，代表 `GOOGLE_SHEET_CSV_URL` 設定或 Sheet 發佈方式需要修正。如果 `DATA_SOURCE=notion` 時回傳錯誤 JSON，先執行 `node scripts/validate-location-snapshot.mjs data/locations.csv`。

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
- 卡片名稱、類別、狀態、說明正常顯示
- 沒有空白卡片
- marker popup 不再顯示「在 Google Maps 開啟 / Open in Google Maps」
- 語言切換正常
- 手機版 map/list tab 正常
- 新增地點、建議修改表單 UI 正常

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

### `DATA_SOURCE=sheet` 時 API 回傳 HTML，不是 CSV

代表 `GOOGLE_SHEET_CSV_URL` 可能填成一般 Google Sheets `/edit` 頁面，或 Sheet 尚未正確發佈 CSV。

建議使用：

```text
https://docs.google.com/spreadsheets/d/<sheet-id>/export?format=csv&gid=<gid>
```

或在 Google Sheets：

```text
File → Share → Publish to web → 選工作表 → Comma-separated values (.csv)
```

### API 沒有回傳預期的 location 資料

可能原因：

- `/api/locations` 無法取得 CSV
- CSV headers 不符合 app schema
- `DATA_SOURCE` 沒有被 `netlify dev` 載入
- 使用 `DATA_SOURCE=sheet` 時，`GOOGLE_SHEET_CSV_URL` 沒有被載入
- 使用 `DATA_SOURCE=notion` 時，`data/locations.csv` 遺失或驗證失敗

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
