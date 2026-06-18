# Lingorm Map — TODO

---

## ✅ 已完成

- [x] 地圖從 Leaflet + CartoDB 遷移至 Google Maps JS API
- [x] AdvancedMarkerElement + InfoWindow + colorScheme 深色主題
- [x] HERE Maps 備援（Google Maps 載入失敗時自動切換）
- [x] Emoji 圓形 badge markers（依 category emoji + status 底色）
- [x] Netlify Functions：`/api/config`、`/api/locations`
- [x] `netlify.toml` 加入 `[functions]` + `[[redirects]]`，修正 /api/* 404
- [x] Netlify Forms：`suggest-edit`、`add-location`、`issue-report`
- [x] build.sh 驗證 `GOOGLE_MAPS_KEY` / `GOOGLE_MAP_ID` / `GOOGLE_SHEET_CSV_URL`
- [x] `.env.example` + `.gitignore`
- [x] git init + push 至 GitHub (`ginaz5/lingorm-map`)
- [x] Netlify 部署成功：https://lingorm-map.netlify.app
- [x] HTTP Referrer 白名單、API Quota 硬停、Budget Alert
- [x] 多來源 tags 顯示（`Source Tags` 欄位，Threads handle 區分）
- [x] 手機版清單可滾動（`flex:1; min-height:0` 修正）
- [x] 手機版 tab 導航：點清單卡片 → 切地圖；點 marker → 留在地圖
- [x] 移除 admin 認證（密碼登入功能）
- [x] 公開清單隱藏 `Could Not Find` 地點
- [x] Issue report 功能
- [x] 58 個 tests 全過

---

## 🔲 部署後測試（待確認）

- [ ] Netlify env var `HERE_API_KEY` 已設定
- [ ] HERE Maps fallback 可正常載入（暫時移除 Google keys 測試）
- [ ] 語言切換（中文 ↔ 英文），InfoWindow 內容同步
- [ ] 「建議修改」表單送出 → Netlify Forms 收到
- [ ] 「新增地點」表單送出 → Netlify Forms 收到
- [ ] Netlify Forms 通知 email 已設定
- [ ] `/api/locations` 可成功回傳 CSV

---

## 🔲 Spreadsheet Schema

- [ ] 前端 parser 改以 spreadsheet header 直接產生 location object（降低欄位順序耦合）
- [ ] 全部地點座標補齊後，移除內建 embedded fallback 資料

---

## 🔲 上線後（選填）

- [ ] 自訂網域（Netlify → Domain Management）
- [ ] 流量超過 quota 時調高 Cloud Console 上限
