# SuperRich 1965（橘標）正式分店建檔查證

日期：2026-09-10；複核更新：2026-09-11。依使用者「正式資料建檔」指示執行 Phase B；寫入狀態維持 Paused。

## 收錄範圍與證據

- [實作計畫](superrich1965-exchange-map-plan.zh-TW.md)｜[進度紀錄](superrich1965-exchange-map-progress.zh-TW.md)｜[機器可驗證證據](evidence/superrich1965-branches-2026-09-10.json)
- [官方分店資料](https://www.superrich1965.com/spr/front/branches?page=1&limit=1000) 53 筆：41 Our Branch、12 Partner；[報價頁](https://www.superrich1965.com/en/exchange-rate) 使用的 branch-list 有 39 筆。
- 收錄 38 筆 A04／main-branch。Terminal 21 Pattaya（id 106、E52-01）明確屬 partner，排除。
- Vibhavadi 22（87）、Airport Rail Link Suvarnabhumi（94）、Airport Rail Link Phaya Thai（95）雖列 Our Branch，當前報價清單沒有對照；本批不猜 branchNo、不建入收錄對照。
- 完整讀取正式 Notion 181 筆（含 Inactive），未見橘標來源、Slug 或 Maps URL 重複；綠標同商場分店屬不同公司，保留。

## 識別碼核對

自動配對出現 3 組碰撞，逐筆比對官方英文／泰文名、地址與分店地圖標籤後修正：Baan Silom 55→84（非 56）、Big C Ratchadapisek 50→60（非 59）、MRT Phra Ram 9 17→90（非 89）。Silom Plaza 00→56、Ratchadamri 1 36→58／2 35→57、Emsphere 2 樓 51→112／G 樓 64→110、Station One China Town 09→82 均分開確認。其餘名稱差異為商場品牌字或縮寫，完整逐店對照見證據 JSON。

## 寫入欄位（20 屬性與頁面 icon）

沿用綠標已定案的空白 Type、💱 icon、空白 Source Tags；不新增 Notion 選項。泛用技能驗證器尚未支援 Currency Exchange，使用暫存副本配合正式 schema 與計畫驗證，未修改已安裝技能。

| 屬性 | 寫入值 |
| --- | --- |
| Name | 依逐店資料表／完整欄位 JSON |
| Name ZH | 依逐店資料表／完整欄位 JSON |
| Thai / Alt Name | 依逐店資料表／完整欄位 JSON |
| Type | 留空 |
| Category | Currency Exchange |
| Country Code | TH |
| Destination Key | bangkok |
| Google Maps URL | 依逐店資料表／完整欄位 JSON |
| Google Place ID | 38 筆皆已用 Places Details URL 的 CID 與官方 iframe CID 逐店核對後寫入 |
| Last Verified | 留空 |
| Lat | 依逐店資料表／完整欄位 JSON |
| Lng | 依逐店資料表／完整欄位 JSON |
| Notes EN | 依逐店資料表／完整欄位 JSON |
| Notes ZH | 依逐店資料表／完整欄位 JSON |
| Review Needed | true |
| Slug | 依逐店資料表／完整欄位 JSON |
| Source Tags | 留空 |
| Source URLs | https://www.superrich1965.com/en/exchange-rate, https://www.superrich1965.com/spr/front/branches?limit=1000&page=1 |
| Status | Paused |
| Verification Note | 依逐店資料表／完整欄位 JSON |
| Icon | 💱 |

Google Maps 連結保留官方分店 iframe 的 CID；Google Place ID 另由 Places Details 取得，只有在回傳 Maps URL 的 CID 與官方 CID 完全一致時才寫入。38 筆全部通過，未保存 Google 回傳座標。營業時間與報價不寫入正式地點欄位。逐筆 patch 與回讀結果見 [2026-09-11 複核證據](evidence/superrich1965-review-2026-09-11.json)。

## 座標與待審項目

下表初建 Lat/Lng 為官方分店 API 同一筆的成對原值；2026-09-11 僅 The Old Siam Plaza 改採 OSM 中明確標名為該分店的 node 11871723783 成對座標。沒有從 Google Maps／Places 回傳座標補值，也沒有使用附近商場或道路中心代替櫃位。**有效數值不代表已完成地理位置複核**；所有店維持 Paused、Review Needed=true、Last Verified 空白。Central Ladprao、Baan Silom 樓層與 Sanam Chai 行政區疑點已處理；仍有 13 筆座標待修正，詳見複核證據。

| id | branchNo | 官方分店名 | Lat | Lng | Google Maps | 公開前檢查 | Notion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 56 | 00 | Silom | 13.7259677 | 100.52739608 | [地圖](https://www.google.com/maps?cid=15775963621935397154) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281978384cf4504796bcc?pvs=204) |
| 57 | 35 | Ratchadamri Soi 2 | 13.7481743 | 100.5413347 | [地圖](https://www.google.com/maps?cid=12643537585874962060) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea28117bac5d2043484f8ec?pvs=204) |
| 58 | 36 | Ratchadamri Soi 1 | 13.74839715 | 100.5415544 | [地圖](https://www.google.com/maps?cid=8335198795530635667) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281ee800df00c3bfc55c2?pvs=204) |
| 59 | 40 | Big C Ratchadamri | 13.7478896 | 100.5408364 | [地圖](https://www.google.com/maps?cid=10640620214672543437) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea28195a59af740af4fc3fe?pvs=204) |
| 60 | 50 | Big C Place Ratchadapisek | 13.7690041 | 100.5719551 | [地圖](https://www.google.com/maps?cid=15788413709990784438) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea28154a564d0f8e1a72406?pvs=204) |
| 61 | 34 | CentralWorld | 13.7467959 | 100.5398741 | [地圖](https://www.google.com/maps?cid=17641291034871758820) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea28132abcaf4e5c2922818?pvs=204) |
| 62 | 23 | Central Eastville | 13.8037762 | 100.6146195 | [地圖](https://www.google.com/maps?cid=13227693680754996999) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea2815fa0a7e9ac47890330?pvs=204) |
| 63 | 03 | Central Ladprao | 13.81747588 | 100.56141011 | [地圖](https://www.google.com/maps?cid=9790860745869596558) | 樓層已核為 1 樓；保留官方成對座標。 | [開啟](https://app.notion.com/p/3d7c23158ea28100838ad8e924b05165?pvs=204) |
| 64 | 19 | Central Embassy | 13.7442403 | 100.5458836 | [地圖](https://www.google.com/maps?cid=11354210779480537482) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea28170b0d1f222dc34b5bf?pvs=204) |
| 65 | 05 | Central Bangna | 13.6691492 | 100.6349238 | [地圖](https://www.google.com/maps?cid=9236261590056237412) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea2813ea8a2cacc2a336572?pvs=204) |
| 66 | 45 | Central Pinklao | 13.7779136 | 100.4761395 | [地圖](https://www.google.com/maps?cid=18431963231161380620) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea28186ab35c185ca7752d7?pvs=204) |
| 67 | 62 | Dusit Central Park | 13.7281735 | 100.5346918 | [地圖](https://www.google.com/maps?cid=10802328743530097709) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281a09db7fd566e465064?pvs=204) |
| 68 | 11 | The Mall Lifestore Bangkapi | 13.7650323 | 100.6424786 | [地圖](https://www.google.com/maps?cid=4792365811619136602) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea2819d91edd28378156fa5?pvs=204) |
| 69 | 44 | The Mall Lifestore Ngamwongwan | 13.8558247 | 100.5419609 | [地圖](https://www.google.com/maps?cid=15518294520322797509) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea2815d9618e0dc8acde2fd?pvs=204) |
| 70 | 26 | The Mall Lifestore Bangkae | 13.7126688 | 100.4080061 | [地圖](https://www.google.com/maps?cid=4089825850985452372) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281cd83f3f55c55c47a86?pvs=204) |
| 71 | 20 | Seacon Square Srinakarin | 13.693006 | 100.64785 | [地圖](https://www.google.com/maps?cid=13829695911430800631) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281d5a7e1d458cbcd8a61?pvs=204) |
| 72 | 46 | Seacon Bangkae | 13.7126134 | 100.4342343 | [地圖](https://www.google.com/maps?cid=8412309548577448649) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea28190b1a0f2c540faebd1?pvs=204) |
| 73 | 21 | MBK Center | 13.7443914 | 100.5301254 | [地圖](https://www.google.com/maps?cid=13143101977433073461) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea2812196ffe0bc37d7095f?pvs=204) |
| 74 | 63 | MBK Skywalk | 13.74541 | 100.5257773 | [地圖](https://www.google.com/maps?cid=8784033568452572932) | 官方座標位置與 MBK Skywalk 的地址範圍疑似不符；此為來源原值，公開前必須獨立複核。 | [開啟](https://app.notion.com/p/3d7c23158ea2813a8b28f9dbc2d703f4?pvs=204) |
| 76 | 47 | ICS Lifestyle Complex | 13.7212507 | 100.5156707 | [地圖](https://www.google.com/maps?cid=9121040231589198816) | 官方座標與「ICONSIAM 對面」位置描述疑似不符；此為來源原值，公開前必須獨立複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281de901ecfd2478788ae?pvs=204) |
| 77 | 48 | ICONSIAM | 13.727876 | 100.511274 | [地圖](https://www.google.com/maps?cid=1849985724577714029) | 官方座標是否落在 ICONSIAM 分店範圍尚待複核；未以商場或鄰店座標替換。 | [開啟](https://app.notion.com/p/3d7c23158ea2817f97d7df85c31f6f3b?pvs=204) |
| 78 | 27 | Bangkok Hospital | 13.7484646 | 100.5825484 | [地圖](https://www.google.com/maps?cid=8539769213875250240) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281f58ce1f0189ae3983c?pvs=204) |
| 79 | 52 | Samitivej Sukhumvit Hospital | 13.7343855 | 100.5766619 | [地圖](https://www.google.com/maps?cid=7254985248330491106) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281f1a6d2d1af48d58972?pvs=204) |
| 80 | 04 | Platinum POP | 13.7394144 | 100.5344928 | [地圖](https://www.google.com/maps?cid=3389145693496596136) | Platinum POP 現名與 The Market Bangkok 舊地址並存；官方座標與 Ratchadamri 地址疑似不符，公開前必須複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281068f65dc845848eee4?pvs=204) |
| 81 | 53 | The Old Siam Plaza | 13.745495 | 100.4998539 | [地圖](https://www.google.com/maps?cid=1461159666499170416) | 已採 OSM 明確標名的分店 node 11871723783；仍維持 Paused，待整批發布審核。 | [開啟](https://app.notion.com/p/3d7c23158ea2819cb5f3ebe72890ca6b?pvs=204) |
| 82 | 09 | Station One Yaowarat | 13.7435131 | 100.5090594 | [地圖](https://www.google.com/maps?cid=17574828652567266885) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea28115bfaef599f42e518a?pvs=204) |
| 83 | 57 | One Bangkok | 13.7232373 | 100.5088169 | [地圖](https://www.google.com/maps?cid=11374048944423394364) | 官方座標與 One Bangkok／Rama IV Road 地址疑似不符；此為來源原值，公開前必須獨立複核。 | [開啟](https://app.notion.com/p/3d7c23158ea2817bad65d198d55a15b2?pvs=204) |
| 84 | 55 | Baan Silom Lifestyle Arcade (Soi Silom 19) | 13.723175 | 100.5206648 | [地圖](https://www.google.com/maps?cid=6646615212025593604) | 泰文 address 與 landmark 已核為 1 樓 A25。 | [開啟](https://app.notion.com/p/3d7c23158ea281bca1a0f313560145e5?pvs=204) |
| 85 | 49 | Riverside Plaza | 13.7051951 | 100.4911603 | [地圖](https://www.google.com/maps?cid=8260329021590249248) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281aebcdfc726c6ac3fc9?pvs=204) |
| 86 | 56 | ArounD Lifestyle Station (PTT Station, Soi Phetchaburi 29) | 13.7232384 | 100.5191168 | [地圖](https://www.google.com/maps?cid=4718677697836239868) | 官方座標與 Phetchaburi Soi 29 地址疑似不符；此為來源原值，公開前必須獨立複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281aa9f51f9f26f313d4a?pvs=204) |
| 88 | 58 | Imperial World Samrong | 13.6511347 | 100.5947851 | [地圖](https://www.google.com/maps?cid=15754269650531579008) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281e18ae4fbabb8fad6ab?pvs=204) |
| 89 | 16 | MRT Sukhumvit | 13.7374442 | 100.5612744 | [地圖](https://www.google.com/maps?cid=8116079645074407185) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281c78a4bf33d3f7ca492?pvs=204) |
| 90 | 17 | MRT Rama 9 | 13.7566348 | 100.5653757 | [地圖](https://www.google.com/maps?cid=14339393731360932280) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea28160a1f0ca7c7ca6a265?pvs=204) |
| 91 | 41 | MRT Chatuchak | 13.8026319 | 100.5532855 | [地圖](https://www.google.com/maps?cid=14772327350171681829) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea2816a96c2ea5df868b276?pvs=204) |
| 92 | 60 | MRT Kamphaeng Phet | 13.7980726 | 100.546291 | [地圖](https://www.google.com/maps?cid=4210302377356866184) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea2819bb127c16e1fbb0555?pvs=204) |
| 93 | 59 | MRT Sanam Chai | 13.7445235 | 100.4918577 | [地圖](https://www.google.com/maps?cid=15187430913671619864) | BEM 已核為 Phra Nakhon 區；座標仍在 13 筆待修正清單。 | [開啟](https://app.notion.com/p/3d7c23158ea281fcb29dfb5651050b0b?pvs=204) |
| 110 | 64 | Emsphere G Floor | 13.73247233 | 100.56591219 | [地圖](https://www.google.com/maps?cid=3233164840185572030) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea281c89444fb0973bf5269?pvs=204) |
| 112 | 51 | Emsphere 2 FL. | 13.7338681 | 100.56675262 | [地圖](https://www.google.com/maps?cid=7901134588435402760) | 官方座標與櫃位位置仍需公開前複核。 | [開啟](https://app.notion.com/p/3d7c23158ea2811b9748e6f775531bf6?pvs=204) |

## 逐店完整欄位

[38 筆完整欄位與 Notion 連結](evidence/superrich1965-notion-records-2026-09-10.json)保存全部正規化資料、頁面 ID 與回讀驗證結果。

## 寫入與驗證結果

- 正式 Notion 建立 38 筆，回讀 760 個屬性檢查、38 個 icon、38 個 parent 全通過。Notion 自動移除 Seacon Square Srinakarin 泰文名稱的一個零寬空白，記錄已同步可見文字。
- 既有 exporter 匯出 219 筆；原有 181 筆 CSV 欄位逐筆完全不變，新增加的 38 筆全部為 Paused。公開筆數仍為 161。
- 三狀態快照、98 個 legacy 收藏 ID、橘標對照與已收錄來源的一對一檢查均通過。
- 測試與建置最終結果見[進度紀錄](superrich1965-exchange-map-progress.zh-TW.md)。
- 2026-09-11 已完成 38 筆 Place ID、樓層與行政區疑點複核；13 筆櫃位座標仍需公開前修正，未發布或部署。
