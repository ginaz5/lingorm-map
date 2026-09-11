# Local Testing Before Netlify Deploy

本專案使用 Netlify 免費方案時，建議先在本機完整測試，確認沒問題後才 push 到 GitHub 觸發 Netlify deploy，以節省 deploy credits。

Location 資料以已驗證的 CSV 快照隨程式版本部署：由 Notion 匯出 → 驗證 → 更新
`data/locations.csv` → 提交部署；回滾即 `git revert` 該筆 `data/locations.csv` 變更。
指令見 `CLAUDE.md` 的 Location data workflow。

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

這個 endpoint 是由 Netlify Function 執行，但回應會提供給前端地圖 SDK，因此在瀏覽器 Network 面板看見 `googleMapsKey`／`hereApiKey` 是預期行為。Browser SDK key 必須設定網站與 API restriction；`NOTION_API_KEY`、`GOOGLE_PLACE_KEY` 等 server-only credential 則絕對不應出現在此回應。

預期：

```json
{"hereApiKey":"...","googleMapsKey":"...","googleMapId":"..."}
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
- 篩選順序為「類別／主題／目的地」；英文篩選標籤為 Collection，中文主題顯示 LingOrm、JKR 推薦、JKR 應援、留友看，英文維持正式 Type 值
- 主題旁的資訊按鈕可透過桌機 hover／focus 或點擊開啟分類說明，並能以點擊外部、再次點擊或 Escape 關閉；手機點擊可正常操作
- 主題可與搜尋、類別、目的地及收藏條件正確交集篩選
- Google Maps 與 HERE Maps popup 都同時顯示類別與 Type badge
- 手機版以 `Bar / Rooftop Club`、`JKR Fan Projects`、`酒吧/天台俱樂部` 等最長篩選文字檢查，320px 與一般手機寬度都不裁切或水平溢出
- 手機版定位按鈕固定顯示於 header，且不再出現在「更多操作」選單
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

## 換匯功能上線與維運手冊

換匯（SuperRich）功能的資料模型與階段設計以
[實作計畫](../docs/superrich-exchange-map-plan.zh-TW.md) 為準、進度與已
完成的驗證見 [進度紀錄](../docs/superrich-exchange-map-progress.zh-TW.md)；
本節只記錄「正式環境要怎麼操作」，避免每次上線或排查問題都要重讀整份計畫。

### 上線前的驗證清單

除了本文件前面「每次修改後的本機測試流程」之外，換匯功能多這幾項：

```bash
node --test tests/exchange-rates-*.test.mjs tests/i18n-ui.test.mjs tests/styles-extraction.test.mjs tests/view-first-ui.test.mjs
node scripts/validate-superrich-mapping.mjs data/superrich-branches.json data/locations.csv
node scripts/validate-superrich1965-mapping.mjs data/superrich1965-branches.json data/locations.csv
npm run fx:control -- status
```

`fx:control -- status` 在本機／未設定 Netlify 憑證時會失敗是正常的——這
支指令設計上只連正式或已 `netlify link` 的站台儲存；本機驗證的重點是
`node --test` 全過與 mapping 腳本無誤。

到期行為另以有有效報價的頁面驗證：切成離線、讓 API 請求跨過到期時間，
以及切到背景後等到過期再切回。三種情況都應撤下數字與「最佳」標示、
回一般排序；恢復連線且取得新快照後可以再次顯示報價。
`tests/exchange-rates-ui.test.mjs` 以模擬時鐘涵蓋這些情境。

橘標須同時驗證獨立 API、控制層與品牌分派前端：

```bash
node --test tests/exchange-rates-1965-source.test.mjs tests/exchange-rates-1965-backend.test.mjs tests/exchange-rates-1965-ui.test.mjs tests/superrich1965-mapping.test.mjs tests/view-first-ui.test.mjs
npm run fx:1965:control -- status
```

Deploy Preview 上保持 `EXCHANGE_RATES_1965_ENABLED=false` 或未設定時，
`/api/exchange-rates-1965` 應回 `enabled:false`、`snapshot:null`，且排程人工
觸發不應呼叫上游。需要驗收第一輪時，使用 `npm run fx:1965:control --
enable`，再執行 `netlify functions:invoke exchange-rates-1965-fetch`；核對
38 店快照後可用 `npm run fx:1965:control -- disable --reason source_review`
關閉。這組 control、snapshot、breaker 與綠標完全分開。

橘標分店發布後，前台人工驗收還要確認：卡片只有 `USD 100＋50` 與
`TWD 1,000–100` 兩列、顯示公司全名並連到 `superrich1965.com`；全橘
cluster 為橘色，全綠為綠色，混合 cluster 為中性。依序停用其中一個品牌，
另一品牌的報價、排序選項與 marker 應維持可用。

### 排程首次啟用（正式環境）

Deploy Preview 與 branch deploy **不會自動排程**，只能手動觸發；即使
`main` 已 merge，正式環境的 Netlify Scheduled Function 要等下一個排定
時間才會第一次自動執行。因此第一次上線要依序做：

1. 確認正式環境目前是 **disabled**：

   ```bash
   npm run fx:control -- status
   ```

   `control.enabled` 應為 `false` 或整個 `control` 為 `null`（代表尚未建立過控制物件，會回退到 `EXCHANGE_RATES_ENABLED`，預設也是 `false`）。

2. 建立／更新正式的控制旗標：

   ```bash
   npm run fx:control -- enable
   ```

3. **人工觸發第一輪抓取**（不要空等排程），用 Netlify UI 的「Run now」或：

   ```bash
   netlify functions:invoke exchange-rates-fetch
   ```

4. 確認 API 與前台數字：

   ```text
   https://lingorm-map.netlify.app/api/exchange-rates
   ```

   預期 `enabled: true`、`snapshot` 非 `null`；前台開啟換匯開關後 26 個
   分店都能看到三列報價（或明確的「暫無報價」，不是空白或錯誤畫面）。

5. **再驗證接下來兩個排定批次**（每 30 分鐘一次；即等 30～60 分鐘後重
   查一次 API 的 `checkedAt`／`snapshot.completedAt` 有沒有前進），確認
   排程本身、不只是手動觸發那一次，是正常運作的。

只改 `EXCHANGE_RATES_ENABLED` 這個環境變數**不會**讓上面任何一步提前生
效——見下一節。

### 執行期停用 vs. 環境變數：差異與怎麼操作

這是兩層不同的開關，日常操作幾乎都只會用到第一種：

| | 執行期控制旗標 | `EXCHANGE_RATES_ENABLED` 環境變數 |
| --- | --- | --- |
| 怎麼改 | `npm run fx:control -- enable` / `disable --reason <code>` | Netlify 網站設定裡改環境變數 |
| 何時生效 | **立即**（下一次 API 讀取／排程檢查就看到） | **只在下一次部署之後**才生效 |
| 用途 | 日常開關、來源出事故時緊急停用 | 這個站台從一開始要不要有這個功能（沒有控制旗標時的預設回退值） |
| 停用後前台行為 | `enabled:false`；卡片、綠色標記、開關本身都還在，只是三列報價變成「暫無報價」，篩選與收藏不受影響 | 同左 |

**常見誤區：** 改了 Netlify 環境變數的 `EXCHANGE_RATES_ENABLED` 之後，
以為存檔就生效——實際上要另外觸發一次部署（哪怕程式碼沒改）才會被讀
到新值。日常「先關掉」請一律用 `npm run fx:control -- disable --reason
<code>`，不要改環境變數。

### Circuit breaker 復原

來源回應 403／429 會被視為「來源在限流／封鎖」，立即封鎖並依
6h → 24h → 自動停用逐步升級；連續 3 輪全失敗（非 403／429）則退避 1
小時。**`npm run fx:control -- enable` 只會清除連續失敗計數，不會清除
尚未到期的封鎖期限**（含 `Retry-After`）——這是刻意的：如果來源還在限
流，手動重新啟用又立刻重抓只會再觸發一次封鎖。

排查步驟：

1. `npm run fx:control -- status`，看 `breaker.blockedUntil` 是否還沒
   到。
2. 沒過期：等到期，或找到來源限流的根本原因後再等；不要反覆
   enable/disable 試探。
3. 已過期：下一輪排程（每 30 分鐘）會自動恢復抓取，也可以用
   `netlify functions:invoke exchange-rates-fetch` 人工觸發一次確認。
4. 恢復後應該看到 `breaker` 的失敗計數歸零、`snapshot` 更新到最新
   `completedAt`。

### 資料來源故障時，預期會發生什麼（降級檢查清單）

來源故障（逾時、格式錯誤、HTTP 錯誤、封鎖中）時，前台**不應該**看到
任何額外的錯誤畫面、彈窗或空白區塊；逐項確認：

- 換匯開關、26 個分店卡片、地圖上的綠色標記／綠色群聚：都還在。
- 三列報價：顯示「暫無報價」（`fx_unavailable`），不是 0、空白或
  crash。
- 免責文字、官網連結、Google Maps 營業時間連結：正常顯示，不受影響。
- 篩選（換匯點略過類別／主題）、搜尋、目的地、收藏：正常運作。
- 最佳匯率排序：三個排序選項變成 disabled，並自動退回一般排序（不是
  停在故障前選的排序基準上）。
- 訪客端每 60 秒仍會照常向 `/api/exchange-rates` 確認一次；沒有因為故
  障就停止確認或需要重新整理頁面才能恢復。

若上面任何一項不成立，先查 `npm run fx:control -- status` 的
`control`／`breaker`／`snapshot` 三個物件，再對照
[實作計畫](../docs/superrich-exchange-map-plan.zh-TW.md) §4－§5 的契約
定義；這是故障排查的第一步，不是重新部署。

---

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
