# Lingorm Map

Lingorm 曼谷踩點地圖 — An interactive map of Bangkok locations spotted in Lingorm's content. Built as a vanilla JS + Vite static site, deployed on Netlify.

🌐 **Live:** https://lingorm-map.netlify.app

---

## Features

- Interactive map with emoji category markers (colored by status: verified / needs review / not found)
- Card list with search, category, and status filters
- zh / en bilingual UI with one-click toggle
- Light / dark / auto theme
- Community contributions via Netlify Forms (suggest edit, add location, report issue)
- Mobile-responsive with map / list tab switching and scroll
- Google Maps primary; HERE Maps fallback if Google Maps is unavailable

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Map | Google Maps JS API (`AdvancedMarkerElement`, `colorScheme`) with HERE Maps fallback |
| Data | Google Sheets → published CSV → Netlify Function proxy (`/api/locations`) |
| Forms | Netlify Forms (`suggest-edit`, `add-location`, `issue-report`) |
| Build | Vite 6, ES modules in `src/` |
| Deploy | Netlify (GitHub auto-deploy) |
| Tests | Node.js built-in `node:test` — 58 tests |

---

## Project Structure

```
lingorm_bangkok_map/
├── index.html              # HTML markup; loads src/main.js as ES module
├── styles.css              # CSS custom properties (light/dark theme)
├── src/
│   ├── main.js             # Entry point — wires event listeners, boot sequence
│   ├── state.js            # Shared mutable state object
│   ├── i18n.js             # CATEGORIES, translations (zh/en), t(), tobj()
│   ├── csv-parser.js       # CSV tokenizer + parseCSV (pure functions)
│   ├── render.js           # Card list, popup content, filter helpers
│   ├── ui.js               # Theme, tab switch, snackbar, locate me, toggleLang
│   ├── submit.js           # Netlify Forms submit, pending banner
│   ├── forms.js            # Edit / add / issue modals
│   └── map.js              # Map init (Google + HERE), markers, loadMapScript
├── netlify/
│   └── functions/
│       ├── config.mjs      # /api/config — returns Maps key + map ID
│       └── locations.mjs   # /api/locations — proxies Google Sheets CSV
├── tests/                  # node:test test suite (58 tests)
├── vite.config.js          # Vite build config
├── build.sh                # Netlify pre-build: validates env vars
├── netlify.toml            # build command, publish dir, functions dir, /api/* redirect
└── TECH_DECISIONS.md       # Architecture decision records
```

---

## Local Development

### Prerequisites

```bash
node --version   # 18+
npm install
netlify --version  # install if missing: npm i -g netlify-cli
netlify login && netlify link
```

### Environment variables

Create `.env` in the project root (not committed — copy from `.env.example`):

```
HERE_API_KEY=your_here_api_key          # required — fallback map provider
GOOGLE_MAPS_KEY=your_google_maps_key    # optional — primary map provider
GOOGLE_MAP_ID=your_google_map_id        # optional — required if using Google Maps
GOOGLE_SHEET_CSV_URL=your_csv_url       # required — location data
```

Get a HERE API key at [developer.here.com](https://developer.here.com) → Projects → REST → Create API key (free tier: 250k map transactions/month).

### Run locally

```bash
netlify dev        # http://localhost:8888
```

This runs Vite + Netlify Functions together. Do **not** open `index.html` directly — the Netlify Functions (`/api/config`, `/api/locations`) won't be available.

### Unit tests

```bash
node --test tests/*.test.mjs
```

Expected: 58 pass, 0 fail.

### Production build (verify before deploy)

```bash
npm run build      # outputs to dist/
```

---

## Deploy

Push to `main` — Netlify runs `bash build.sh && npm run build` and publishes `dist/`.

Required Netlify environment variables (Dashboard → Site Settings → Environment Variables):

| Variable | Required | Purpose |
|----------|----------|---------|
| `HERE_API_KEY` | ✅ | HERE Maps JS API key (fallback provider) |
| `GOOGLE_MAPS_KEY` | optional | Google Maps JS API key (primary provider) |
| `GOOGLE_MAP_ID` | optional | Map ID for dark mode + AdvancedMarkerElement |
| `GOOGLE_SHEET_CSV_URL` | ✅ | Published CSV URL for `/api/locations` |

If `GOOGLE_MAPS_KEY` / `GOOGLE_MAP_ID` are omitted, the map loads HERE Maps directly. If both Google and HERE keys are present, Google Maps is used as primary with HERE as fallback.

### Netlify Forms

Enable form detection in Netlify Dashboard → **Forms → Enable form detection**, then redeploy. Forms: `suggest-edit`, `add-location`, `issue-report`.

### Google Maps key protection

The Maps key is delivered via `/api/config` (Netlify Function). Protect it with:

1. **HTTP Referrer restriction** in Cloud Console → Credentials (allow `https://lingorm-map.netlify.app/*`)
2. **Daily quota cap** — Maps JS API → Quotas → Map loads/day = 900
3. **Billing alert** at $5

---

## Data Schema

The Google Sheet must be published as CSV. Two formats are auto-detected:

**Internal format (recommended):**

```
Name_EN, Name_ZH, Alt_Name, Category_EN, Category_ZH,
Notes_EN, Notes_ZH, Icon, Lat, Lng, Maps_Query,
Status, Duplicate_Group, Source, Coords_Approx
```

**Published/legacy format:**

```
Location Name, Thai / Alt Name, Category, Notes,
Source URL, Verification Status, Duplicate Group, ...
```

`Status` values: `Verified` | `Needs Review` | `Could Not Find`

---

## Map Markers

Markers are 28px emoji circles colored by status:

| Status | Color |
|--------|-------|
| Verified | Green `#2f7d4f` |
| Needs Review | Orange `#c2772a` |
| Could Not Find | Red `#b1452f` (hidden from public list) |

The emoji comes from `row.icon` (set per category: 🍽 🏨 ☕ etc.). Falls back to 📍 if missing.

---

## Contributing Locations

Use **新增地點 / Add Location** or **建議修改 / Suggest edit** on any card. Submissions go to Netlify Forms and are reviewed before appearing on the map.

---

## Running Tests

```bash
node --test tests/*.test.mjs
```

| File | What it covers |
|------|---------------|
| `parsecsv.test.mjs` | CSV tokenizer, parser, status normalizer, source helpers |
| `source-tags.test.mjs` | `renderSources` — Threads handle extraction, platform URL mapping |
| `i18n-ui.test.mjs` | `updateLangUI`, `buildCatFilter`, `rebuildSelect` |
| `ui-events.test.mjs` | No inline `onclick`; `switchTab` state alignment |
| `add-location-form.test.mjs` | Netlify form field parity, URL validator, submit mock |
| `edit-submit.test.mjs` | `submitEdit` payload correctness |
| `issue-report.test.mjs` | Issue report form field parity, UI copy |
| `google-maps-loader.test.mjs` | No hardcoded API key placeholders; runtime config fetch |
| `here-map-layer.test.mjs` | HERE Maps base layer selection (dark/light fallback) |
| `no-maplink-ui.test.mjs` | No legacy "Open in Maps" links in HTML |
| `public-notfound.test.mjs` | "Could Not Find" locations hidden from public list + markers |
| `styles-extraction.test.mjs` | External CSS linked; no inline presentational styles |
| `theme-mode.test.mjs` | Theme toggle supports only light/dark |
| `config-function.test.mjs` | `/api/config` Netlify Function |
| `locations-function.test.mjs` | `/api/locations` Netlify Function |
