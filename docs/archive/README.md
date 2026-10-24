# 歷史文件索引

整理日期：2026-10-24。這裡保留當時的設計、決策、驗收與未完成事項，
不作為現行需求、待辦或維運指令。請先閱讀[現行文件索引](../README.md)。
本次搬移完整保留原內容，只新增歷史標示並重寫相對連結；既有 JSON evidence 路徑維持不變。

## 換匯歷史

### 設計與進度

- [rates-branch-split-plan.zh-TW.md](exchange-rates/plans/rates-branch-split-plan.zh-TW.md)
- [superrich-exchange-map-plan-revisions.zh-TW.md](exchange-rates/plans/superrich-exchange-map-plan-revisions.zh-TW.md)
- [superrich-exchange-map-progress.zh-TW.md](exchange-rates/plans/superrich-exchange-map-progress.zh-TW.md)
- [superrich-exchange-map-plan.zh-TW.md](exchange-rates/plans/superrich-exchange-map-plan.zh-TW.md)
- [superrich1965-exchange-map-plan-revisions.zh-TW.md](exchange-rates/plans/superrich1965-exchange-map-plan-revisions.zh-TW.md)
- [superrich1965-exchange-map-progress.zh-TW.md](exchange-rates/plans/superrich1965-exchange-map-progress.zh-TW.md)
- [superrich1965-exchange-map-plan.zh-TW.md](exchange-rates/plans/superrich1965-exchange-map-plan.zh-TW.md)
- [superrich1965-github-actions-plan.zh-TW.md](exchange-rates/plans/superrich1965-github-actions-plan.zh-TW.md)
- [superrich1965-local-fetch-plan.zh-TW.md](exchange-rates/plans/superrich1965-local-fetch-plan.zh-TW.md)
- [superrich1965-on-demand-plan.zh-TW.md](exchange-rates/plans/superrich1965-on-demand-plan.zh-TW.md)

### 平台研究與 bootstrap

- [superrich1965-actions-bootstrap.zh-TW.md](exchange-rates/research/superrich1965-actions-bootstrap.zh-TW.md)
- [superrich1965-actions-research-2026-10-20.zh-TW.md](exchange-rates/research/superrich1965-actions-research-2026-10-20.zh-TW.md)
- [superrich1965-anonymous-api-investigation.zh-TW.md](exchange-rates/research/superrich1965-anonymous-api-investigation.zh-TW.md)

### 已完成實驗與 Preview 驗收

- [superrich1965-python-single-publish.zh-TW.md](exchange-rates/acceptance/superrich1965-python-single-publish.zh-TW.md)
- [superrich1965-python-batches.zh-TW.md](exchange-rates/acceptance/superrich1965-python-batches.zh-TW.md)
- [superrich1965-single-branch-test-2026-10-17.zh-TW.md](exchange-rates/acceptance/superrich1965-single-branch-test-2026-10-17.zh-TW.md)
- [superrich1965-netlify-python-probe-2026-10-23.zh-TW.md](exchange-rates/acceptance/superrich1965-netlify-python-probe-2026-10-23.zh-TW.md)
- [superrich1965-netlify-python-background-2026-10-23.zh-TW.md](exchange-rates/acceptance/superrich1965-netlify-python-background-2026-10-23.zh-TW.md)
- [superrich1965-netlify-python-parallel-2026-10-23.zh-TW.md](exchange-rates/acceptance/superrich1965-netlify-python-parallel-2026-10-23.zh-TW.md)

### 舊正式切換與故障紀錄

- [superrich1965-production-release.zh-TW.md](exchange-rates/releases/superrich1965-production-release.zh-TW.md)
- [superrich1965-netlify-cutover-2026-10-23.zh-TW.md](exchange-rates/releases/superrich1965-netlify-cutover-2026-10-23.zh-TW.md)

## 其他已完成設計

- [早期單檔 refactoring](implementation/REFACTORING.md)。
- [JavaScript checkJs 設計](superpowers/specs/2026-06-21-javascript-type-checking-design.md)與[實作計畫](superpowers/plans/2026-06-21-javascript-type-checking.md)。
- [檢視優先 UI 簡化計畫](superpowers/plans/2026-07-19-view-first-ui-simplification.md)：保留當時狀態矩陣，不回寫成目前 schema。

## 已退休的實驗程式

Netlify 串行 background 與 38 路 parallel 實驗已完成，正式流程使用 scheduler／worker。
8 個實驗程式與專用測試自工作樹移除；歷史文件中的執行指令僅供還原實驗時查閱，
不代表目前仍有這些入口。最新 PR #18 release 中記載的 Python parallel 測試通過，
也是退休前的實際驗證結果。

完整來源可由 Git commit `0a2b122517e686e62c239cc176a31f9038eb1f4a` 取回，
例如 `git show <commit>:<path>`。原始路徑與每檔 SHA-256 見
[退休清單](exchange-rates/retired-experiments-2026-10-24.json)。不部署或重新觸發這些實驗。

## 較早的封存

- [Lingorm_Threads_Locations.md](Lingorm_Threads_Locations.md)
- [analytics-tracking.md](analytics-tracking.md)
- [coord_verification_report.md](coord_verification_report.md)
- [lingorm_location_updated.md](lingorm_location_updated.md)
- [location-verification-tool-design.zh-TW.md](location-verification-tool-design.zh-TW.md)
- [location-verification-tool-progress.zh-TW.md](location-verification-tool-progress.zh-TW.md)
- [notion-deploy-workflow.md](notion-deploy-workflow.md)
- [notion-migration-and-location-automation-plan.md](notion-migration-and-location-automation-plan.md)
- [notion-migration-and-location-automation-plan.zh-TW.md](notion-migration-and-location-automation-plan.zh-TW.md)
- [search-notes-enhancement-plan.zh-TW.md](search-notes-enhancement-plan.zh-TW.md)
