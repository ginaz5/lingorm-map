# Lingorm Bangkok Map — 部署 TODO

> 追蹤從開發到上線的剩餘步驟。完成一項打一個 ✅。

---

## ✅ 已完成

- [x] 地圖從 Leaflet + CartoDB 遷移至 Google Maps JS API
- [x] AdvancedMarkerElement + InfoWindow + colorScheme 深色主題
- [x] build.sh 延伸：注入 `GOOGLE_MAPS_KEY` / `GOOGLE_MAP_ID` / `ADMIN_PASSWORD`
- [x] `.env.example` + `.gitignore`
- [x] TECH_DECISIONS.md 更新
- [x] git init + 初始 commit + push 至 GitHub (`ginaz5/lingorm-map`)

---

## ✅ Netlify 部署

- [x] **連接 GitHub repo** (`ginaz5/lingorm-map`, branch: `main`)
- [x] **設定 Netlify 環境變數**（`GOOGLE_MAPS_KEY` / `GOOGLE_MAP_ID` / `ADMIN_PASSWORD`）
- [x] **部署成功** — build log 確認 `✅ Google Maps key injected.` / `✅ Google Map ID injected.`
- [x] **Netlify domain**：https://lingorm-map.netlify.app

---

## ✅ Google Cloud Console 安全設定

- [x] **HTTP Referrer 白名單** — `https://lingorm-map.netlify.app/*`
- [x] **API Quota 硬停** — `Map loads per day` = 900（27,000/月，在免費額度內）
- [x] **Budget Alert** — $5 預算警報

---

## 🔲 部署後測試

- [ ] 地圖正常載入（不出現「This page can't load Google Maps correctly」）
- [ ] Light / Dark / Auto 三段主題切換，地圖顏色同步
- [ ] 點擊 marker 開啟 InfoWindow，內容正確
- [ ] 點擊卡片，地圖 pan 到對應地點並開啟 InfoWindow
- [ ] 語言切換（中文 ↔ 英文），InfoWindow 內容同步
- [ ] 手機版 tab 切換（地圖 ↔ 清單）正常
- [ ] 「建議修改」表單送出 → Netlify Forms 收到
- [ ] 「新增地點」表單送出 → Netlify Forms 收到
- [ ] Netlify Forms 通知 email 已設定

---

## 🔲 上線後（選填）

- [ ] 自訂網域（Netlify → Domain Management）
- [ ] Google Sheets CSV URL 填入 ⚙️ 設定頁面並測試載入
- [ ] 把 Netlify domain 加入 Google Sheets CORS 白名單（通常不需要，Sheets CSV 已開放 CORS）
