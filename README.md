# Lingorm Map

Lingorm 曼谷踩點地圖 — An interactive map of Bangkok locations spotted in Lingorm's content. Built as a vanilla JS + Vite static site, deployed on Netlify.

🌐 **Live:** https://lingorm-map.netlify.app

---

## Features

- Interactive map with emoji category markers (colored by status: verified / needs review / not found)
- Card list with search, category, and status filters
- Popup with Navigate + Open in Google Maps buttons (responsive: icon-only on mobile)
- zh / en bilingual UI with one-click toggle
- Light / dark / auto theme
- Community contributions via Netlify Forms (suggest edit, add location, report issue)
- Mobile-responsive with map / list tab switching and scroll
- Google Maps primary; HERE Maps fallback if Google Maps is unavailable
- Analytics via Google Tag Manager (GTM-NVNXGP44) + GA4 (G-31MF79LHFM)

---

## Architecture

The app is a static site with two Netlify Functions acting as a thin backend proxy. All state lives in the browser.

### Boot sequence

On page load, `main.js` kicks off two parallel flows:

1. **Data flow** — `tryLoadSheet()` calls `/api/locations`, which proxies the published Google Sheets CSV. The response is tokenised by `csv-parser.js`, normalised into a flat array, and stored in `state.js`. Once loaded, `rebuild()` triggers `render.js` (card list + filters) and `map.js` (place markers).

2. **Map flow** — `loadMapScript()` calls `/api/config` to retrieve the Google Maps API key and Map ID (never exposed client-side directly). It injects the Google Maps JS script; if that fails or the key is absent, it falls back to the HERE Maps JS API. Either way, `initMap()` runs and markers are placed via `buildMarkers()`.

```mermaid
flowchart TD
    subgraph Browser
        MAIN[main.js\nboot + event wiring]
        STATE[state.js\nshared state]
        CSV[csv-parser.js]
        RENDER[render.js\ncard list + filters]
        MAP[map.js\nmarkers + map init]
        UI[ui.js\ntheme · tabs · snackbar]
        FORMS[forms.js\nedit · add · issue modals]
    end

    subgraph Netlify Functions
        CFG[/api/config\nreturns Maps key + Map ID]
        LOC[/api/locations\nproxies Sheets CSV]
    end

    GS[(Google Sheets\npublished CSV)]
    GMAPS[Google Maps JS API]
    HERE[HERE Maps JS API]
    NFORMS[Netlify Forms\nsubmission storage]
    GTM[GTM → GA4\nanalytics]

    MAIN -->|boot| UI
    MAIN -->|tryLoadSheet| LOC
    LOC -->|CSV text| GS
    LOC -->|raw CSV| CSV
    CSV -->|rows| STATE
    STATE -->|data| RENDER
    STATE -->|data| MAP

    MAIN -->|loadMapScript| CFG
    CFG -->|key + mapId| GMAPS
    GMAPS -->|success| MAP
    CFG -->|fallback| HERE
    HERE -->|fallback init| MAP

    MAIN --> FORMS
    FORMS -->|POST| NFORMS

    GTM -.->|script tag in index.html| MAIN
```

### Module responsibilities

| Module | Role |
|--------|------|
| `main.js` | Entry point — boot sequence, all event listener wiring |
| `state.js` | Single mutable object shared across modules |
| `i18n.js` | `CATEGORIES`, translations, `t()` / `tobj()` helpers |
| `csv-parser.js` | CSV tokeniser + `parseCSV` + `normalizeStatus` (pure functions) |
| `render.js` | Card list HTML, popup content, filter helpers |
| `ui.js` | Theme cycle, tab switch, snackbar, locate-me, `toggleLang` |
| `map.js` | Google / HERE map init, `buildMarkers`, theme sync |
| `forms.js` | Edit / add / issue modal open–close–validate |
| `submit.js` | Netlify Forms POST, pending banner |

### Key constraints

- **No secrets in client JS.** The Google Maps key is fetched at runtime from `/api/config` (a Netlify Function that reads `process.env`), never bundled into `dist/`.
- **HERE as fallback, not primary.** If `GOOGLE_MAPS_KEY` / `GOOGLE_MAP_ID` are absent or the script load fails, the app transparently switches to HERE Maps.
- **No framework.** Vanilla JS + Vite — no React/Vue/Angular. DOM updates are string-templated HTML re-renders (card list) or direct marker manipulation (map).

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Map | Google Maps JS API (`AdvancedMarkerElement`, `colorScheme`) with HERE Maps fallback |
| Data | Google Sheets → published CSV → Netlify Function proxy (`/api/locations`) |
| Forms | Netlify Forms (`suggest-edit`, `add-location`, `issue-report`) |
| Analytics | Google Tag Manager (GTM-NVNXGP44) → GA4 (G-31MF79LHFM) |
| Build | Vite 6, ES modules in `src/` |
| Deploy | Netlify (GitHub auto-deploy) |
| Tests | Node.js built-in `node:test` — 64 tests |

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
│   ├── ui.js               # Theme, tab switch, snackbar, locate me, navigation, toggleLang
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

### Analytics

GTM snippet is embedded in `index.html` (`<head>` + noscript `<body>`). All tracking configuration (GA4 tag, triggers) is managed in the GTM dashboard — no code changes needed to add/modify events.

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
