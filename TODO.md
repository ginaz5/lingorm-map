# Lingorm Map — TODO

---

## ✅ 已完成

- [x] 地圖從 Leaflet + CartoDB 遷移至 Google Maps JS API
- [x] AdvancedMarkerElement + InfoWindow + colorScheme 深色主題
- [x] HERE Maps 備援（Google Maps 載入失敗時自動切換）
- [x] Emoji 圓形 markers（統一品牌色，不公開 status）
- [x] Netlify Functions：`/api/config`、`/api/locations`
- [x] `netlify.toml` 加入 `[functions]` + `[[redirects]]`，修正 /api/* 404
- [x] Netlify Forms：保留 `issue-report` 作為唯一公開回報管道
- [x] build.sh 驗證 HERE fallback key、Notion snapshot 與橘標 Python runtime；Google key／Map ID 未設定時使用 HERE
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
- [x] 檢視優先介面：移除新增地點、建議修改、審核狀態 UI
- [x] Notion snapshot schema 移除 `Duplicate Group`
- [x] 自動測試、型別檢查與 production build 全過
- [x] 橘標移除舊完整 snapshot API／前端輪詢、單店 snapshot fallback 與本機 `fx:1965:fetch`；綠標 snapshot 流程保留

---

## 🔲 待確認的維運事項

- [ ] 「問題回報」表單送出 → Netlify Forms 收到
- [ ] Netlify Forms 通知 email 已設定

日常部署驗證使用 [LOCAL_TESTING](note/LOCAL_TESTING.md)，包含 `/api/locations`、
Google／HERE、語言與 popup 檢查。上述 Forms 項目保留待確認，未以本機測試代替遠端驗收。
橘標 PR #18 的正式排程已驗收，證據見[最新上線紀錄](docs/superrich1965-netlify-pr18-release-2026-10-24.zh-TW.md)。

---

## ✅ Snapshot Schema

- [x] 前端 parser 依 snapshot header 直接產生 location object
- [x] 移除內建 embedded fallback，正式資料使用已驗證的 Notion CSV snapshot

---

## 🔲 上線後（選填）

- [ ] 自訂網域（Netlify → Domain Management）
- [ ] 流量超過 quota 時調高 Cloud Console 上限
