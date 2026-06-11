# Lingorm Bangkok Map — 技術選型紀錄

> 記錄本專案的架構決策與選型理由，方便日後維護或交接。

---

## 地圖：Google Maps JavaScript API

**選用：** [Google Maps JS API](https://developers.google.com/maps/documentation/javascript) + `AdvancedMarkerElement` + `colorScheme`

**原始選擇為 Leaflet + CartoDB，已確認遷移原因：**

| 考量 | Google Maps JS API | Leaflet + CartoDB |
|------|-------------------|-------------------|
| 視覺品質 | Google 原生，與使用者習慣一致 | 開源 tiles，視覺差異明顯 |
| 深色主題 | `colorScheme: DARK/LIGHT` 原生支援 | CartoDB `dark_all` tiles |
| API Key | 必須，需綁信用卡 | 不需要 |
| 費用 | $200/月免費額度（~28,500 次/月） | 完全免費 |

**Key 安全策略（靜態網站業界標準）：**

Google Maps JS API 的 key 存在於 script URL，無法在純靜態網站完全隱藏。採用三層保護：

1. **HTTP Referrer 白名單**（Cloud Console → Credentials）：限制 key 僅接受 `https://lingorm-map.netlify.app/*` 請求 ✅
2. **API Quota 硬停**（APIs & Services → Maps JS API → Quotas）：`Map loads per day` = 900，超額回 `OVER_QUERY_LIMIT`，不產生費用 ✅
3. **Budget Alert**（Billing → Budgets & alerts）：$5 觸發 email 通知 ✅

費用估算：$200/月額度 ≈ 28,500 次載入，日 quota 900 × 30 = 27,000 次，預期帳單 $0。

**Deep mode 實作：** 需 Map ID（Cloud Console → Map management）才能使用 `colorScheme` 與 `AdvancedMarkerElement`。主題切換時呼叫 `map.setOptions({ colorScheme: ... })`。

**初始化架構：** Google Maps 以 `async + callback=initMapCallback` 載入。卡片清單在地圖載入前即可渲染；`buildMarkers()` 以 `if(!map) return` 防護，確保 map 就緒前不執行。

---

## 部署：Netlify（GitHub + Build Pipeline）

**選用：** [Netlify](https://netlify.com) 免費方案，連接 GitHub repo 自動部署

**放棄：** 拖曳部署（已升級）、GitHub Pages、Vercel、自架伺服器

**理由：**
- 免費方案支援自訂域名（`xxx.netlify.app` 或自帶網域）
- 內建 **Netlify Forms**（每月 100 筆免費），直接接收共編建議，無需另建 API
- GitHub 連接後每次 `git push` 自動 redeploy
- HTTPS 自動配置
- **Build pipeline（`netlify.toml` + `build.sh`）可在 deploy 時注入環境變數**，比拖曳部署更安全

**Build step 費用影響：**
- Netlify 免費額度：500 build minutes / 月
- 本專案 `build.sh` 約 5–10 秒 / 次，push 20 次也只用 ~3 分鐘，遠低於限制

**上線狀態：** https://lingorm-map.netlify.app ✅

**部署流程：**
```
git push → Netlify webhook → bash build.sh → inject secrets → publish
```

---

## 資料來源：Google Sheets CSV

**架構：** Google Sheets → 發佈至網路（CSV）→ 前端 `fetch` 讀取

**資料流：**
```
Google Sheets（人工編輯）
    ↓  File → Share → Publish to web → CSV
Public CSV URL（CORS open）
    ↓  fetch() on page load
index.html（自訂 CSV parser 解析）
    ↓
Leaflet markers + card list
```

**選用理由：**
- Google Sheets CSV export 天然支援 CORS，前端可直接 fetch，不需 proxy
- 非技術用戶友善：管理員在熟悉的試算表界面更新資料即可
- 免費，無 API key

**限制：**
- 單向同步（Sheets → 網頁），網頁不寫回 Sheets
- 更新需手動重新整理網頁（非 WebSocket 即時推送）
- CSV 大小建議 < 1MB（本專案 26 筆遠低於上限）

---

## 管理員認證：Build-time Hash Injection

**架構：** 密碼雜湊在 build 階段注入 HTML，瀏覽器端 SHA-256 比對

**流程：**
```
Netlify env var: ADMIN_PASSWORD=your_password
    ↓  build.sh
SHA-256 hash → 替換 index.html 中的 __ADMIN_HASH__ 佔位符
    ↓  runtime
使用者在瀏覽器輸入密碼 → SubtleCrypto.digest('SHA-256') → 比對 hash
```

**管理員入口：** 訪問 `yoursite.netlify.app/#admin` 觸發密碼視窗

**選用理由：**
- 明文密碼不出現在 HTML 或 git history，只有 hash 被嵌入
- 靜態網站無後端，這是安全性和零成本之間的最佳折衷
- `SubtleCrypto` 是瀏覽器原生 API，無需外部依賴

**限制：** 雜湊仍在 HTML 裡，理論上可暴力破解。對個人地圖管理風險可接受。若需更高安全性，可改用 Netlify Identity。

**放棄的方案：**
- `localStorage` 明文密碼：不安全
- Netlify Identity：overkill，且免費方案有用戶數限制

---

## 共編提交：Netlify Forms

**架構：** 使用者填寫表單 → `fetch POST /` → Netlify Forms 收件 → Email 通知管理員 → 人工審核後更新 Google Sheets

**兩個表單：**
- `suggest-edit` — 建議修改現有地點（狀態、座標、說明）
- `add-location` — 新增地點

**選用理由：**
- 靜態網站無後端，Netlify Forms 是零設定的最佳方案
- 強制人工審核，防止惡意資料直接寫入
- 免費額度（100 筆/月）對個人使用綽綽有餘

**替代方案（若未來需要更高量）：**
- [Formspree](https://formspree.io)（50 筆/月免費，付費更高）
- 自建 webhook（需後端）

---

## 主題系統：CSS Custom Properties

**架構：** `[data-theme="dark" | "light"]` attribute on `<html>` + CSS variables

```css
:root { --bg: #f5f5f7; /* light */ }
[data-theme="dark"] { --bg: #0f0f1a; }
```

**三段切換：** `auto`（跟隨系統 `prefers-color-scheme`）→ `light` → `dark`

**Tiles 同步：** 主題切換時同步替換 CartoDB `light_all` ↔ `dark_all`

**偏好持久化：** `localStorage.setItem('theme', ...)`

---

## 多語支援：i18n 系統

**架構：**
- 所有 UI 字串集中在 `const T = { zh: {...}, en: {...} }` 物件
- HTML 元素使用 `data-i18n="key"`、`data-i18n-ph="key"`（placeholder）、`data-i18n-html="key"`（innerHTML）屬性
- `updateLangUI()` 單次 `querySelectorAll` 掃描更新全部元素，無需逐一 `getElementById`
- 動態渲染內容（卡片、類別下拉、狀態 filter）在語系切換時重新 render

**類別資料：** 單一 `CATEGORIES` 陣列同時驅動：主面板 category filter、新增地點下拉、未來泰文擴充

```javascript
const CATEGORIES = [
  {zh:'餐廳', en:'Restaurant', icon:'🍽'},
  // ...
  // 未來加泰文：{zh:'...', en:'...', th:'ร้านอาหาร', icon:'🍽'}
]
```

**範圍：** 所有 UI 文字、modal 標籤、placeholder、hint、表單驗證訊息、管理員模組、Sheet 設定模組

**未來擴充（泰文）：** 在 `T` 新增 `th: {...}` key，CATEGORIES 新增 `th` 欄位，lang toggle 加入第三段即可

**偏好持久化：** `localStorage.setItem('lang', ...)`

---

## 檔案結構

```
lingorm_bangkok_v2/       ← GitHub repo root
├── index.html            # 整個 app（單檔，無外部依賴除 CDN）
├── netlify.toml          # Netlify build 設定
├── build.sh              # Build script：inject ADMIN_HASH → index.html
├── TECH_DECISIONS.md     # 本文件
└── Lingorm_Bangkok_v2.xlsx  # 資料來源（匯入 Google Sheets 後棄用）
```

**刻意選擇單檔：**
- Netlify drag-and-drop 最適合單一 HTML
- 無 build step，無 node_modules，維護成本最低
- 所有邏輯、樣式、資料 inline，離線可讀

---

## CDN 依賴

| Library | 版本 | 用途 |
|---------|------|------|
| Google Maps JS API | weekly | 地圖渲染、AdvancedMarkerElement、InfoWindow |

無其他外部依賴。Google Maps API key 與 Map ID 需在 HTML 的 script src 中替換。

---

## 未來擴充考量

| 需求 | 建議方案 |
|------|----------|
| 每月 >100 筆建議 | 換 Formspree 或加 Supabase 後端 |
| 管理員直接在網頁審核 | 加 `/admin` 路由 + password 保護（Netlify Identity） |
| 即時更新（無需重新整理） | Server-Sent Events 或 Supabase Realtime |
| 流量超過 quota（>900次/日） | 調高 Cloud Console quota 上限，或升級 Next.js + Vercel（key 存環境變數，真正安全） |
| 更多地點（>200 筆） | 考慮分頁或虛擬捲動（virtual scroll） |
