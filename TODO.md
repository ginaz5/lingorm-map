# Lingorm Bangkok Map — 部署 TODO

> 追蹤從開發到上線的剩餘步驟。完成一項打一個 ✅。

---

## ✅ 已完成

- [x] 地圖從 Leaflet + CartoDB 遷移至 Google Maps JS API
- [x] AdvancedMarkerElement + InfoWindow + colorScheme 深色主題
- [x] build.sh 延伸：驗證 `GOOGLE_MAPS_KEY` / `GOOGLE_MAP_ID` / `GOOGLE_SHEET_CSV_URL`，並注入 `ADMIN_PASSWORD`
- [x] `.env.example` + `.gitignore`
- [x] TECH_DECISIONS.md 更新
- [x] git init + 初始 commit + push 至 GitHub (`ginaz5/lingorm-map`)
- [x] 2026-06-13：將 `lingorm_pending_updates.md` 的 5 筆新增地點與 3 筆現有地點修正同步至 Google Sheet `Lingorm_Bangkok_Locations`

---

## ✅ Netlify 部署

- [x] **連接 GitHub repo** (`ginaz5/lingorm-map`, branch: `main`)
- [x] **設定 Netlify 環境變數**（`GOOGLE_MAPS_KEY` / `GOOGLE_MAP_ID` / `GOOGLE_SHEET_CSV_URL` / `ADMIN_PASSWORD`）
- [x] **部署成功** — build log 確認 Google Maps config 與 Sheet CSV URL 已設定
- [x] **Netlify domain**：https://lingorm-map.netlify.app

---

## ✅ Google Cloud Console 安全設定

- [x] **HTTP Referrer 白名單** — `https://lingorm-map.netlify.app/*`
- [x] **API Quota 硬停** — `Map loads per day` = 900（27,000/月，在免費額度內）
- [x] **Budget Alert** — $5 預算警報

---

## 🔲 部署後測試

- [x] 地圖正常載入
- [x] Light / Dark / Auto 三段主題切換，地圖顏色同步
- [x] 點擊 marker 開啟 InfoWindow，內容正確
- [x] 點擊卡片，地圖 pan 到對應地點並開啟 InfoWindow
- [ ] 語言切換（中文 ↔ 英文），InfoWindow 內容同步
- [ ] 手機版 tab 切換（地圖 ↔ 清單）正常
- [ ] 「建議修改」表單送出 → Netlify Forms 收到
- [ ] 「新增地點」表單送出 → Netlify Forms 收到
- [ ] Netlify Forms 通知 email 已設定
- [ ] Netlify 環境變數 `GOOGLE_SHEET_CSV_URL` 已設定
- [ ] `/api/locations` 可成功回傳 CSV

---

## ✅ UI 修改（2026-06-11）

- [x] 移除 card 的「在 Google Maps 開啟」連結
- [x] 移除 header subtitle「鄺玲玲曼谷踩點地圖」
- [x] colorScheme 改用 string literal（`'DARK'/'LIGHT'`），修正 light mode 切換
- [x] 新增地點表單：單一地點名稱欄、單一說明欄、移除 Emoji/經緯度、地圖欄改為 Google Maps 連結

---

## ✅ Google Sheets API Proxy（2026-06-11）

- [x] 新增 Netlify Function：`/api/locations`
- [x] Google Sheets CSV URL 改放 Netlify 環境變數 `GOOGLE_SHEET_CSV_URL`
- [x] 前端改為呼叫站內 API，不再保存或暴露 `sheet_url`
- [x] 管理員 Sheet 設定頁改為 API 狀態 / 重新載入
- [x] `.env.example` / `TECH_DECISIONS.md` 同步更新

---

## 🔲 Spreadsheet Canonical Schema

- [x] 以 Google Spreadsheet header 作為 app canonical schema，而不是以 embedded data / positional array 為主
- [x] 重新整理 spreadsheet：保留一列一地點，移除或分離 `Source note` 這類非地點資料
- [x] 補齊必要欄位：`Lat`、`Lng`、`Google Maps URL`、`Icon`、`Coordinates Approx`
- [x] 確認現有欄位命名：`Location Name`、`Thai / Alt Name`、`Category`、`Notes`、`Source URL`、`Verification Status`、`Duplicate Group`
- [ ] 前端 parser 改以 spreadsheet header 直接產生 location object（例如 `location.lat`），降低欄位順序耦合
- [ ] Spreadsheet 座標補齊後，移除 `hydrateSheetRows()` 對 embedded data 的座標 fallback
- [ ] 全部地點都能從 spreadsheet render card + marker 後，將 `EMBEDDED` 改為空 fallback 或移除內建地點資料

---

## 🔲 上線後（選填）

- [ ] 自訂網域（Netlify → Domain Management）
- [ ] Google Sheets CSV URL 填入 Netlify `GOOGLE_SHEET_CSV_URL` 並重新部署
- [ ] 在 ⚙️ 設定頁面測試重新載入
