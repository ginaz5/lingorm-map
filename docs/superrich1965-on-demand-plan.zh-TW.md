# SuperRich 1965：卡片手動單店匯率查詢

日期：2026-10-17。使用者已確認：保留 main 介面，改由卡片按鈕觸發後端
查詢單店。後續依使用者指示只將 Silom Plaza 改為 Published 並由 Notion 匯出，
其餘 37 家仍為 Paused；不改正式環境控制旗標或部署。

## 目標與目前狀態

程式與 mock 測試完成；本機 Netlify dev 的真實單店查詢已取得 HTTP 200。
正式 Netlify 雲端出口能否穩定取得橘標 JSON 仍待部署驗收。
此方案減少整批抓取，不承諾能消除 Cloudflare challenge。請求仍從後端發出，
使用者瀏覽器只呼叫本站 API，無需橘標官網允許跨站讀取。

| 工作 | 實作結果 |
| --- | --- |
| 卡片／popup 手動按鈕、載入／失敗／冷卻文案 | 完成，中英文共用同分店狀態；capture delegation 避免點擊觸發父卡片 |
| 固定分店、單次來源請求 | 完成，只收 mapping 的 Slug；5 秒 timeout，不重試、不抓 inventory |
| 跨訪客快取 | 完成，每店獨立 Blobs key，從 attemptedAt 起最多 5 分鐘；僅完整 USD／TWD 入快取 |
| 重複請求與跨店節流 | 完成，15 秒 ETag lease；已有查詢回 busy，不另發來源請求；完成後至少間隔 1.5 秒 |
| 冷卻及停用 | 完成，普通失敗等待 60 秒；403／429／challenge 共用原 breaker；控制版本競態不回舊報價 |
| 到期與排序 | 完成，到期只撤報價、不自動查詢；只比較有有效報價的分店 |
| 發布分店 | 已依使用者指示發布 Silom Plaza，其餘維持 Paused |
| 正式部署／雲端來源穩定性 | 未執行 |

## 請求與回應契約

`POST /api/exchange-rates-1965-branch`

```json
{"slug":"superrich1965-56"}
```

只接受 `application/json`、一個 Slug 欄位；拒絕未知分店、額外 URL／branchNo、
超大或無效 body，以及帶跨站 Origin 的請求。後端由 mapping 取得 A04／branchNo。

固定回應欄位：`schemaVersion`、`checkedAt`、`slug`、`enabled`、
`controlVersion`、`quote`、`reason`、`retryAfterSeconds`。`quote` 包含身份、
`attemptedAt`／`completedAt`／`expiresAt` 與 USD_1965／TWD_1965。
只回正規化報價，不回來源 HTML、header 診斷、token 或完整原始 JSON。

- 200：有效單店報價，來源可為共用快取或單次抓取。
- 202：已有冷查詢或寫入競爭；不發第二次來源請求，稍後手動重試。
- 429：共用節流或 breaker 冷卻。
- 503：服務 disabled、來源失敗、控制版本變動或 storage 不可用。
- 400／405：輸入或方法不符。

全部 `no-store`；202／429 與可預期的暫停附 `Retry-After`。
這是應用層快取，不透過 CDN 快取 POST。

## 快取、鎖與控制

- Store 沿用橘標 `exchange-rates-1965`，production 用 site store，其他 context
  用 deploy store；共用原本 control／breaker，不另開可繞過停用的開關。
- 單店快取：`exchange-rates-1965/branches/{slug}`。有新鮮的整批 snapshot 時
  也可取該店，但有效時間同樣不超過 attemptedAt 後 5 分鐘。
- 全域 gate：`exchange-rates-1965/on-demand-gate`。以 `onlyIfNew`／
  `onlyIfMatch` 爭取 lease；持有者完成時只用自己的 ETag 釋放。程序中斷後
  lease 可於 15 秒後重新取得，不刪除其他執行者的鎖。
- 快取命中先後核對 controlVersion；來源前再核對 control／breaker，來源後
  和快取寫入後再核對 control。舊控制版本的快取即使保留在 Blobs，也不可服務。
- 單店成功不重設原整批 breaker 的 blockLevel；失敗用 ETag 更新 shared breaker，
  第三次 challenge 的自動停用也沿用控制版本保護。
- Netlify Dev 若缺少既有 ETag，僅在 `NETLIFY_DEV=true` 使用 worker 內序列化
  與資料重讀比較；這不是跨程序的分散式 CAS。部署環境缺少 ETag 仍不可覆寫。
- 前端每店去重、校驗完整身份、限制 TTL，並以伺服器 checkedAt 的時間差推算
  本機到期。網路傳輸只會縮短有效時間，不能延長。更新任一卡片的控制版本時
  清除其他卡片舊版本報價，較舊的延遲回應不能復活新停用前的資料。
- 既有瀏覽器報價最多保留到原 TTL（5 分鐘）；不宣稱管理者停用後所有離線
  瀏覽器立即同步。下一次手動請求核對到 disabled 時，立即撤下其他手動報價。

## 舊整批管線與切換

前端 main 不再初始化橘標整批輪詢，綠標輪詢不變。舊完整 snapshot API、
CLI 與資料契約保留，不把單店資料偽裝成完整 38 店快照。

未來部署本方案時設 `EXCHANGE_RATES_1965_FETCH_MODE=on-demand`，讓橘標
Scheduled Function 在開啟 store 前正常略過。`local` 仍適用外部 CLI，
`netlify` 仍為未設定時的相容預設。`FETCH_MODE` 不取代公開 control，
本次不寫正式 control、不修改環境變數、不安裝排程。

先確認功能／來源可用，再由使用者另外決定分店發布和服務啟用。
保持 Paused 時，正式地圖不會出現橘標卡片，即使程式已支援查詢。

## 驗證方式

Node 測試使用 fake fetch／clock／store，不打真實來源、不寫正式 Blobs。
覆蓋單店身份／面額、跨訪客快取、過期、並行 lease、跨店冷卻、challenge、
失敗不重試、控制版本競態、資料隔離與雙 provider popup 更新。

本機 UI mock：`/tests/fixtures/orange-branch-query.html`，可加 `?lang=en`、
`?fail=1`、`?delay=1500`。只在記憶體模擬一筆 Published，不改快照。

真實驗收待辦：Deploy Preview 中核對預設 disabled、on-demand 排程零來源
請求，人工啟用測試控制後查一家，確認 API／卡片／第二位訪客快取，再檢查
5 分鐘到期。遇 challenge 依冷卻停止，不反覆點擊或宣稱來源已修復。


本輪結果：`npm run typecheck`、`npm test`（621 pass／0 fail）、
`npm run build`、`netlify functions:build --src netlify/functions` 通過。
Snapshot 236 筆、98 個收藏 ID、1 Published／37 Paused 橘標 mapping 驗證通過。
實際 Netlify dev 真實查詢、獨立請求快取、5 分鐘自然到期、手機 popup 再次
手動查詢均通過，並修正 Netlify Dev 缺少 ETag 的本機寫入相容性。
全庫 Notion 檢核另有 38 個既有 Review Needed/status 問題，未更動無關資料。
詳見[完整本機實測報告](superrich1965-single-branch-test-2026-10-17.zh-TW.md)。
未啟用正式控制、未 commit／push／部署；雲端來源與 Google SDK 人工驗收仍待辦。
