# lingorm_bangkok_map — Notion Migration Progress

**Date:** 2026-07-19
**Primary source of truth:** `docs/notion-migration-and-location-automation-plan.md` (the full plan; §17 and §18 log everything done so far — read those two sections first, they're more detailed than this file on *why* each decision was made)
**Deployment runbook:** [Notion Data Source Deployment Workflow](notion-deploy-workflow.md)

This file is a compact progress snapshot. If anything here conflicts with the plan doc, the plan doc wins — this is a summary, not a replacement.

---

## 1. What this project is

`lingorm_bangkok_map` is a static Vite site (map + card list of Bangkok/Thailand venues) that used to read all its data from one Google Sheet via a read-only Netlify Function. It's being migrated to Notion as the system of record, with a snapshot exporter keeping the live site on a validated CSV (never reading Notion at request time). Full rationale, architecture, and phased plan: `docs/notion-migration-and-location-automation-plan.md`.

## 2. Current migration status

- **Phase 0 (decisions) and Phase 1 (10-row PoC) are done** — see plan §13, §17.
- **Phase 2 (full data migration) is functionally done**: all **98/98 rows** are in the Notion "Locations (PoC)" data source (`collection://eefc0f40-698c-4870-97b7-e8860091f668`). Cleaning pass applied and logged, branch-duplicate groups linked, reconciliation checks passed (row count, status distribution, no slug collisions). Details: plan §18 "Done".
- **Google Place ID populated for 97/98 rows** (this session). One row intentionally left blank — see §4 below.
- **ID fix shipped**: `src/csv-parser.js` now resolves a row's `id` from an exported `Slug` column when present, falling back to `slugify(name)` otherwise — a Notion rename no longer breaks `localStorage` favorites or shared `?favs=` URLs. 4 new tests added.
- **Migration safety fixes shipped**: `migrate-sheet-to-notion.mjs` requires an explicit existing-slug snapshot, rejects slug collisions before output, `resolve.mjs` flags missing coordinates, and `export-snapshot.mjs` can be imported without credentials.
- **Snapshot serving is implemented**: `/api/locations` supports `DATA_SOURCE=sheet|notion`; Notion mode serves the bundled, validated `data/locations.csv`, while sheet mode remains the rollback path.
- **Full reconciliation is done**: `tests/notion-export-full.test.mjs` compares all 98 rows with the frozen source when available, and the deploy build independently enforces the stable header, 98 rows, and unique nonempty slugs.
- **Favorites compatibility protection is implemented**: the build compares all 98 spreadsheet-derived legacy favorite IDs with the Notion snapshot and rejects missing, renamed, empty, or duplicate slugs.
- **Notion preview verified**: PR #1 deployed successfully with `DATA_SOURCE=notion`; `/api/locations` matched the committed 98-row snapshot byte-for-byte, all 98 production IDs matched the preview IDs, and browser testing confirmed favorites filtering and persistence.
- **Test suite: 111/111 passing, `npm run typecheck` and the production build clean.**
- Relevant baseline commits are `81c12dc` (Phase 2 migration) and `3b03a2a` (migration safety).

### What is NOT done yet (in priority order)

| # | Task | Why it matters |
|---|---|---|
| 1 | **Perform the `DATA_SOURCE=sheet` rollback drill** | The Notion preview is verified; confirming the redeploy-based rollback path is the remaining Phase 2 operational acceptance check before production cutover. |
| 2 | **Decide what to do with 41 rows flagged >150m** from their stored Lat/Lng during Place ID resolution | Full list: `migration-output/place-id-report.md` (local only, gitignored — see §5). Some distances are large (18–95 km) and likely mean the *old* hand-entered coordinates were wrong, not that the Place ID match is wrong (the plan's own coordinate-quality debt, §4 issue 2, predicted this). Nothing has been auto-corrected — this needs a human/agent decision per row or per batch. |
| 3 | **Resolve the "by" row's missing Google Place ID** | Row slug `by` (`ข้ามันบ้านนอก by บ้านนอกคอกนาเขาใหญ่`) resolved to the *same* Place ID as an unrelated venue (`cafe-ban-nok-by-ple-venus`) — a resolver false-match, not a real duplicate. Left blank rather than write a wrong ID. Needs a manually refined query (e.g. add a landmark/district hint) or manual Google Maps lookup, then a single `notion-update-page` call. |

These three items are independent; only item 1 blocks production cutover.

---

## 3. Notion structure (for reference)

- Database/data source: **"Locations (PoC)"**, data source id `collection://eefc0f40-698c-4870-97b7-e8860091f668`. Created *by the integration itself* (not by a human in the Notion UI) — this matters because integration-created databases are fully schema-editable via the API; human-created ones are not (learned the hard way in Phase 1, see plan for the `object_not_found` incident).
- Properties: `Name` (title), `Slug`, `Name ZH`, `Thai / Alt Name`, `Category` (select), `Notes EN`/`Notes ZH`, `Google Maps URL`, `Google Place ID`, `Lat`/`Lng` (number), `Coordinates Approx` (checkbox), `Status` (select: Verified / Needs Review / Could Not Find), `Source URLs`, `Source Tags` (multi-select), `Duplicate Of` (relation, unused/empty by design), `Branch Group` (text, used for 4 known duplicate-venue pairs), `Origin` (select: manual / pipeline / community-form).
- **Dropped** `Last Verified` and the rich-text `Icon` property (replaced by Notion's native page icon) — see plan §17 for why.
- All Notion reads/writes for this migration were done interactively via the Cowork Notion MCP connector tools (`notion-query-data-sources`, `notion-update-page`, `notion-create-pages`, etc.), **not** via a raw `NOTION_API_KEY` — none exists yet in this environment. Future updates can use the same connector (when available) or a real integration token (plan §12.1).

---

## 4. Google Places resolution — operational notes

- **`scripts/resolve.mjs`** targets the **New** Places API (`places:searchText`, POST). This is the "correct" production script per the plan (§8), meant to run somewhere with unrestricted outbound network (GitHub Actions, or a normal dev machine).
- **From this agent's sandbox, POST calls to `places.googleapis.com` don't reach Google at all** (no route to host). Even the **legacy GET** Text Search endpoint returned `REQUEST_DENIED` / "API keys with referer restrictions cannot be used with this API" **specifically from this sandbox** — independently confirmed this was NOT a key-config problem, because the exact same URL + key succeeded via the user's own `curl` and browser at the same moment. Root cause undiagnosed (likely the sandbox's outbound fetch proxy attaches something Google's referrer check rejects, or hits an edge node with a stale key-restriction cache).
- **Workaround used**: wrote **`scripts/resolve-legacy-batch.mjs`**, which the user ran locally (`GOOGLE_PLACE_KEY=... node scripts/resolve-legacy-batch.mjs data/migration/source-20260718.csv`) against the confirmed-working legacy GET endpoint. It reads the frozen migration CSV, adds location-bias from each row's stored Lat/Lng, paces requests 200ms apart, and writes `migration-output/place-id-resolution.json` + `place-id-report.md`. The agent then read that JSON back and wrote `Google Place ID` into Notion via `notion-update-page`, one row at a time (97 calls; no bulk-update tool exists in the Notion connector).
- **If this needs to run again** (e.g. re-resolving the "by" row, or a future incremental batch): reuse `scripts/resolve-legacy-batch.mjs`, run it locally/wherever has real network access, not from an agent sandbox with the same restriction, unless that's been fixed.
- **Env var name mismatch to watch for**: the user's `.env` has `GOOGLE_PLACE_KEY` (no S); `resolve.mjs` originally expected `GOOGLE_PLACES_KEY` (with S) — both scripts now accept either name (`GOOGLE_PLACES_KEY || GOOGLE_PLACE_KEY`), but don't reintroduce the mismatch.

---

## 5. Files that exist locally but are NOT in git (gitignored on purpose)

Per explicit user instruction, these are one-time/regenerable migration artifacts and should stay out of version control:

- `data/migration/source-20260718.csv` — the frozen 98-row source snapshot.
- `migration-output/` — all transform outputs: `pages-to-create.json`, `pages-to-update.json`, `cleaning-log.md`, `batch-1/2/3.json`, `place-id-resolution.json`, `place-id-report.md`.

**Important**: `migration-output/place-id-report.md` (the flagged-rows list referenced in §2 item 2) only exists on the user's local machine / this session's connected folder — it is not committed anywhere. Reading it requires access to that folder; otherwise, regenerate it by re-running `scripts/resolve-legacy-batch.mjs`.

The Phase 2 migration and safety baselines are committed; snapshot serving and full reconciliation are the current follow-up change set.

---

## 6. Environment and access notes

- No real `NOTION_API_KEY` exists in this environment — all Notion operations went through the Cowork Notion MCP connector. If the next environment doesn't have that connector, either request equivalent access or set up a real internal integration token (plan §12.1) and use `scripts/export-snapshot.mjs` directly (`NOTION_API_KEY=... NOTION_DATA_SOURCE_ID=... node scripts/export-snapshot.mjs`).
- `GOOGLE_PLACE_KEY` is a **separate, server-side-only** key from the frontend's `GOOGLE_MAPS_KEY` — do not conflate them (plan §2.6). It must have Application restriction "None" or "IP addresses", never "HTTP referrers", or every server-side Places call gets `REQUEST_DENIED` regardless of which APIs are enabled on the key.
- Full existing test suite: `npm test` (111 tests). Typecheck: `npm run typecheck`. Both must stay green through any further change — this has been true throughout the project and is part of the plan's acceptance criteria (§11, §14).

---

## 7. Suggested next steps, in order

1. Run the rollback drill with `DATA_SOURCE=sheet`, including the required redeploy.
2. Resolve the "by" row (§2 item 3).
3. Review the 41 flagged rows (§2 item 2) and decide whether to retain or correct each stored coordinate.
4. After the rollback check, proceed to Phase 3 (location automation pipeline) or Phase 4 (production cutover) per the plan (§13).
