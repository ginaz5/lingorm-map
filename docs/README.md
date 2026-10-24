# 現行文件索引

更新：2026-10-24。從這裡查現行契約與維運；有日期的驗收文件記錄當時結果，
不代表報價現在仍有效。封存文件不作為待辦或啟用指令。

## 開發與架構

- [專案 README](../README.md)：功能、啟動、部署與模組。
- [本機測試](../note/LOCAL_TESTING.md)：Google／HERE、表單、資料與匯率驗證。
- [技術決策](../note/TECH_DECISIONS.md)：現行導覽與依日期保留的決策歷史。
- [待辦](../TODO.md)：尚待確認的維運與選填項目。
- [Fan Resources 分析事件](../note/FAN_RESOURCES_ANALYTICS.md)。

## 換匯功能

- [兩品牌匯率資料與公開 API 契約](exchange-rate-contract.zh-TW.md)。
- 橘標使用 branch／cache 逐店報價與 runtime 身分端點，舊完整快照 API／fallback／本機取價 CLI 已退役；綠標完整快照繼續使用。
- [綠標維運](../note/LOCAL_TESTING.md#換匯功能上線與維運手冊)。
- [橘標 Netlify 維運](superrich1965-netlify-runbook.zh-TW.md)：現行自動排程、部署綁定、收據與回滾。
- [橘標 Actions 手動備援](superrich1965-actions-runbook.zh-TW.md)：無 cron，先停用 Netlify collector 再接手。
- [橘標 PR #18 正式部署與排程驗收（2026-10-24）](superrich1965-netlify-pr18-release-2026-10-24.zh-TW.md)及[結構化證據](evidence/superrich1965-netlify-pr18-release-2026-10-24.json)。

## 地點與查證資料

- [綠標建檔查證](superrich-branch-verification.zh-TW.md)。
- [橘標建檔查證](superrich1965-branch-verification.zh-TW.md)。
- `docs/evidence/` 保留原有 JSON 路徑。分店 mapping 證據仍供 validator 與測試讀取，不能按日期整包移除。
- 正式地點先更新 Notion，再使用 exporter／validators 更新 CSV；以 schema 與驗證腳本為準。

## 歷史

[封存索引](archive/README.md)列出舊計畫、平台調查、實驗、切換紀錄及退休實驗程式的 commit／SHA-256。
