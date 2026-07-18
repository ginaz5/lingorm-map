# Phase 1 resolver spike — results

Per `docs/notion-migration-and-location-automation-plan.md` §13 Phase 1 acceptance:
"resolver returns correct coords for ≥4/5 test venues (validated against known-good rows like Dear December Cafe; use `regionCode=TH` + location bias for Thai names)."

Run date: 2026-07-18. Tool: Places API Text Search, `region=th`, cross-checked
against each venue's currently-stored (human-verified) Lat/Lng via haversine
distance, 150m threshold (same threshold as the planned dedupe stage, §7.1/§9.1).

| Venue | Stored (known-good) | Resolved | Distance | Result |
|---|---|---|---|---|
| Dear December Cafe | 13.675657, 100.644664 | 13.6756573, 100.6446636 | 0.1 m | ✅ pass |
| The Siam Hotel | 13.7811000, 100.5060000 | 13.7811383, 100.5059915 | 4.4 m | ✅ pass |
| Talat Noi | 13.7348000, 100.5140000 | 13.7346704, 100.5134411 | 62.1 m | ✅ pass |
| Ministry of Crab Bangkok | 13.7360000, 100.5666000 | 13.7359700, 100.5666154 | 3.7 m | ✅ pass |
| Khao Yai National Park | 14.4392000, 101.3724000 | 14.3109229, 101.5304415 | 22,209 m | ❌ fail |

**4/5 — meets the plan's ≥4/5 acceptance bar.**

## The one failure, explained

Khao Yai National Park is a ~2,200 km² protected area. Text Search resolved
"Khao Yai National Park Thailand" to a point on the Prachin Buri /
Prachantakham side of the park (place_id `ChIJ10MhX0kqHDER_CvyxA9QSwE`),
22 km from the stored coordinate near the main Pak Chong entrance on the
Nakhon Ratchasima side. Both points are genuinely inside the park boundary —
this isn't a wrong-place resolution, it's the expected ambiguity of
resolving a single point for a large-area POI (parks, neighbourhoods,
districts) via text search. The plan already anticipates this class of
problem generally (§7.3: "Verify... final call human"); the practical fix
for large-area venues specifically is to bias with a locality-level query
("Khao Yai National Park visitor center, Pak Chong") rather than the bare
park name, or to accept a wider distance threshold for `Category =
"Nature / Day-trip"` rows in the dedupe/validate stage.

## Key requirements confirmed during this spike

- The resolver key **must be separate from `GOOGLE_MAPS_KEY`** (the frontend
  Maps JS key). A key with "HTTP referrers (websites)" application
  restriction is rejected for *any* server-side REST call — including
  Places API — with `REQUEST_DENIED` / "API keys with referer restrictions
  cannot be used with this API", regardless of which APIs are enabled on it.
- Application restriction must be **None** or **IP addresses**.
- Restriction changes can take **longer than Google's stated "up to 5
  minutes"** to propagate across edge nodes — a same-key request from one
  location (browser) can succeed while another (server) still gets denied
  for several more minutes. If you just saved a restriction change and still
  see the referrer error, wait and retry rather than assuming the change
  didn't take.
- `scripts/resolve.mjs` targets **Places API (New)** (`places:searchText`,
  the SKU the plan's cost estimate in §8 is based on). This spike's manual
  verification calls used the legacy GET-based Text Search endpoint instead,
  because the tool available in this session could only issue GET requests
  (Places API (New) requires POST + header-based auth). Both endpoints
  returned the same coordinates for every venue tested here, so the results
  above transfer directly — but `resolve.mjs` itself has not yet been
  executed end-to-end; run it once with `GOOGLE_PLACES_KEY` set to confirm.
