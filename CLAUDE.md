# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent rules live in AGENTS.md

`AGENTS.md` is the authoritative repository-wide agent instruction file (editing rules, location-data rules, git/deploy policy, completion report format). **Read it before editing.** This file covers commands and architecture; it does not restate those rules.

Other required reading, by task:

- `README.md` — full architecture diagrams, data schema, deploy config
- `note/TECH_DECISIONS.md` — ADRs
- `note/LOCAL_TESTING.md` — local verification procedure
- `docs/notion-deploy-workflow.md` — Notion snapshot → production workflow

`docs/archive/` is historical only — do not treat it as current requirements.

## Commands

```bash
npm install
netlify dev                    # http://localhost:8888 — Vite + Netlify Functions
npm run dev                    # Vite only; /api/* will 404
npm run typecheck              # tsc --noEmit -p jsconfig.json
npm test                       # node --test (35 test files)
npm run build                  # → dist/
```

Run a single test file:

```bash
node --test tests/parsecsv.test.mjs
```

Location data workflow (requires `NOTION_API_KEY` in `.env`):

```bash
npm run locations:export:notion -- --output data/locations.next.csv
node scripts/validate-location-snapshot.mjs data/locations.next.csv
node scripts/validate-favorite-compatibility.mjs data/locations.csv data/legacy-favorite-ids.json
npm run location:verify -- validate --all       # read-only Notion↔snapshot reconciliation
npm run location:verify:ui                      # localhost review UI
npm run test:location-verification              # the 6 verification test files
```

Pre-push gate (also what CI runs, Node 22): `npm run typecheck && npm test`. Netlify additionally runs `bash build.sh && npm run build`.

## Architecture

Vanilla JS + ES modules + Vite static site on Netlify. No framework, no runtime TypeScript. All state is client-side; two Netlify Functions are the only backend.

**Two independent boot flows in `src/main.js`:**

1. **Data** — `/api/locations` (`netlify/functions/locations.mjs`) serves the committed `data/locations.csv` snapshot → `src/data/csv-parser.js` → `src/core/state.js` → `rebuild()` fans out to `src/ui/render.js` and `src/map/map.js`.
2. **Map** — `/api/config` (`netlify/functions/config.mjs`) reads the browser SDK keys and Map ID through `globalThis.Netlify.env.get()`. They are not committed or bundled into `dist/`, but the keys remain visible in browser network traffic by design and must be protected with provider-side website/API restrictions and quotas. Google Maps loads as primary; on missing configuration or script failure `src/map/map.js` falls back to HERE Maps. Each provider initializes its map before `buildMarkers()` runs.

`src/app/app-coordinator.js` sits between the two: filter/map synchronization and language-change orchestration. `src/core/state.js` is a single mutable object imported by nearly everything — changing its shape means auditing state, CSV parsing, render, map, forms, and both Netlify Functions.

Module responsibilities table: see `README.md` § Module responsibilities.

## Non-obvious constraints

- **`DATA_SOURCE=notion` is the only valid value.** `build.sh` hard-fails on `sheet`. Post-2026-07-21 three-status cutover, `normalizeStatus()` maps legacy `verified`/`needs review` → `Paused`, so the sheet path would render zero public locations.
- **Only `Published` rows are public.** `Paused`, `Inactive`, blank, and unknown statuses are hidden everywhere (list and markers share one allowlist).
- **`Slug` values are favorite IDs in user `localStorage`.** Renaming a slug silently breaks saved favorites — `validate-favorite-compatibility.mjs` is the guard.
- **Every `Published` row needs a valid `Country Code` + `Destination Key` pair**, or snapshot validation fails and blocks the deploy.
- **Typecheck scope is an explicit allowlist** in `jsconfig.json` `include`, not the whole `src/`. It expands incrementally; `tests/typecheck-config.test.mjs` asserts the configuration. Adding a file to `include` also pulls in its import graph.
- **Bilingual is a test-enforced contract.** New user-facing strings go in both zh and en in `src/core/i18n.js`.
- **`__DATA_UPDATED__`** is injected by `vite.config.js` from `git log -1 --format=%cI -- data/locations.csv`, so data freshness depends on the snapshot's commit time.
- `dist/` is build output — never edit or commit it.
