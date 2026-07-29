# AGENTS.md

Instructions for AI agents working in this repository. These rules apply repository-wide. A nested `AGENTS.md` may override them for its subtree.

## Project

- Lingorm Bangkok Map: Vanilla JavaScript, ES modules, and Vite.
- Hosted on Netlify. `netlify/functions/` serves `/api/config` and `/api/locations`.
- TypeScript is a strict, no-emit `checkJs`/JSDoc checker only. Keep runtime code in `.js`.
- Notion is the location system of record. Production reads the validated `data/locations.csv` snapshot.
- Google Maps is primary; HERE Maps is the fallback.

Read relevant documentation before editing:

- `README.md`: architecture, development, and deployment
- `note/TECH_DECISIONS.md`: technical decisions
- `note/LOCAL_TESTING.md`: local verification
- `docs/notion-deploy-workflow.md`: Notion snapshot and deployment workflow

`docs/archive/` contains historical context only. Do not read it by default or
treat it as current requirements; consult it only when explicitly requested or
when historical investigation is necessary.

## Key Files

- `src/main.js`: startup and event wiring
- `src/app/app-coordinator.js`: filter/map synchronization and language orchestration
- `src/core/state.js`: shared state
- `src/core/i18n.js`: zh/en translations and `t()`
- `src/data/csv-parser.js`, `src/data/destinations.js`: location parsing and destination taxonomy
- `src/ui/render.js`, `src/ui/ui.js`: rendering, theme, tabs, snackbar, and navigation
- `src/map/map.js`: Google/HERE maps, markers, popups, and map theme
- `src/features/`: destination filtering, favorites, forms, and What's New
- `src/services/submit.js`: shared form submission transport
- `netlify/functions/`: runtime config and location snapshot APIs
- `data/locations.csv`: production location snapshot
- `scripts/`: snapshot export, validation, and location verification
- `tests/`: Node.js built-in test suite

## Editing Rules

1. Preserve the Vanilla JS + ES module architecture. Do not add a frontend framework or migrate to TypeScript unless explicitly requested.
2. Never place API keys, tokens, Notion credentials, or other secrets in client code, HTML, fixtures, or documentation.
3. Keep user-facing text bilingual. Update both languages in `src/core/i18n.js` and relevant tests.
4. When changing shared data contracts, inspect consumers in state, CSV parsing, rendering, maps, forms, and Netlify Functions.
5. Preserve both Google Maps and HERE fallback behavior. Keep provider-specific logic explicit.
6. Handle missing DOM elements safely and keep strict `checkJs` passing.
7. Prefer small, testable changes. Do not refactor unrelated code.
8. Preserve existing uncommitted work. Do not revert, overwrite, or reformat unrelated files.
9. Add or update tests for behavior changes. For bug fixes, add a regression test when practical.
10. Do not edit `dist/` or commit build artifacts.

## Location Data

- `DATA_SOURCE=notion` is the only supported source. Do not restore `DATA_SOURCE=sheet`.
- Update formal data in Notion, then use the existing exporter to regenerate `data/locations.csv`. Do not treat manual CSV edits as the normal sync workflow.
- Snapshot changes must pass schema, snapshot, and favorite compatibility validation.
- Do not casually change existing `Slug` values; they are persisted as favorite IDs in user `localStorage`.
- Treat the formal schema and validation scripts as authoritative over stale examples in documentation.

Useful commands:

```bash
npm run locations:export:notion
node scripts/validate-location-snapshot.mjs data/locations.csv
node scripts/validate-favorite-compatibility.mjs
npm run location:verify
```

Confirm required local environment variables before exporting. Never print or commit `.env`.

## Development

```bash
npm install
npm run dev
```

Use `netlify dev` when testing Netlify Functions with the frontend. Do not open `index.html` directly because `/api/config` and `/api/locations` will be unavailable.

- Codex is authorized to start a project-scoped local development server and open, navigate, inspect, or test `localhost` and `127.0.0.1` URLs without asking for confirmation. This authorization applies only to local testing for this repository and does not extend to external URLs or bypass platform-required permission prompts.

## Verification

Run focused tests while developing, then complete:

```bash
npm run typecheck
npm test
npm run build
```

Documentation-only changes may skip runtime tests; verify paths, links, and commands instead. Snapshot changes also require the data validation scripts. Report commands run, results, and reasons for anything skipped.

## Git and Deployment

- Do not commit, push, open a PR, or deploy unless requested.
- Never use work-losing commands such as `git reset --hard` or forced checkout.
- Before pushing, review `git diff` and ensure tests, type checking, and build pass.
- Use a feature branch and Netlify Deploy Preview before merging to `main`.
- Prefer local verification over repeatedly triggering Netlify deploys.

## Completion Report

Briefly state:

- What changed and why
- Main files affected
- Verification performed and results
- Remaining risks or manual checks
