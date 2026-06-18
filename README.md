# Lingorm Map

鄺玲玲曼谷踩點地圖 — An interactive map of Bangkok locations spotted in Lingorm's content. Built as a vanilla JS + Vite static site, deployed on Netlify.

🌐 **Live:** https://lingorm-map.netlify.app

---

## Features

- Interactive Google Maps with custom markers (verified / needs review / not found)
- Card list with search, category, and status filters
- zh / en bilingual UI with one-click toggle
- Light / dark / auto theme
- Community contributions via Netlify Forms (suggest edit, add location)
- Admin panel (password-protected) for reloading sheet data
- Mobile-responsive with map / list tab switching

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Map | Google Maps JS API — `AdvancedMarkerElement`, `colorScheme` |
| Data | Google Sheets → published CSV → Netlify Function proxy |
| Forms | Netlify Forms (suggest-edit, add-location) |
| Build | Vite 6, ES modules in `src/` |
| Deploy | Netlify (GitHub auto-deploy) |
| Tests | Node.js built-in `node:test` |

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
│   ├── forms.js            # Edit / add / admin / sheet modals
│   └── map.js              # Google Maps init, markers, loadGoogleMapsScript
├── netlify/
│   └── functions/
│       ├── config.mjs      # /api/config — returns Maps key + map ID
│       └── locations.mjs   # /api/locations — proxies Google Sheets CSV
├── tests/                  # node:test test suite (49 tests)
├── vite.config.js          # Vite config — defines __ADMIN_HASH__ at build time
├── build.sh                # Netlify pre-build: validates env vars
├── netlify.toml            # build command + publish dir
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

Create `.env` in the project root (not committed):

```
GOOGLE_MAPS_KEY=your_google_maps_key
GOOGLE_MAP_ID=your_google_map_id
GOOGLE_SHEET_CSV_URL=your_published_csv_url
ADMIN_PASSWORD=your_admin_password   # optional
```

### Run locally

```bash
netlify dev        # http://localhost:8888
```

This runs Vite + Netlify Functions together. Do **not** open `index.html` directly in the browser — the Netlify Functions (`/api/config`, `/api/locations`) won't be available.

### Unit tests

```bash
node --test tests/*.test.mjs
```

Expected: 49 pass, 0 fail.

### Production build (verify before deploy)

```bash
npm run build      # outputs to dist/
```

Vite reads `ADMIN_PASSWORD` from the environment and bakes its SHA-256 hash into the bundle as `__ADMIN_HASH__`.

---

## Deploy

Push to `main` — Netlify runs `bash build.sh && npm run build` and publishes `dist/`.

Required Netlify environment variables (Dashboard → Site Settings → Environment Variables):

| Variable | Required | Purpose |
|----------|----------|---------|
| `GOOGLE_MAPS_KEY` | ✅ | Google Maps JS API key |
| `GOOGLE_MAP_ID` | ✅ | Map ID for dark mode + AdvancedMarkerElement |
| `GOOGLE_SHEET_CSV_URL` | ✅ | Published CSV URL for `/api/locations` |
| `ADMIN_PASSWORD` | optional | Enables admin panel; omit to disable |

### Google Maps key protection

The Maps key is delivered to the browser via `/api/config` (Netlify Function), which means it still appears in network requests. Protect it with:

1. **HTTP Referrer restriction** in Cloud Console → Credentials (allow `https://lingorm-map.netlify.app/*`)
2. **Daily quota cap** — Maps JS API → Quotas → Map loads/day = 900
3. **Billing alert** at $5

---

## Data Schema

The Google Sheet must be published as CSV with one of these header sets:

**Internal format (recommended):**

```
Name_EN, Name_ZH, Alt_Name, Category_EN, Category_ZH,
Notes_EN, Notes_ZH, Icon, Lat, Lng, Maps_Query,
Status, Duplicate_Group, Source, Coords_Approx
```

**Published/legacy format** (auto-detected):

```
Location Name, Thai / Alt Name, Category, Notes,
Source URL, Verification Status, Duplicate Group, ...
```

`Status` values: `Verified` | `Needs Review` | `Could Not Find`

---

## Admin Panel

Visit `/#admin` to open the password prompt. On success, the Sheet modal lets you reload location data from the CSV without redeploying.

Admin password is never stored in plaintext — `build.sh` + Vite hash `ADMIN_PASSWORD` with SHA-256 at build time; the browser compares using `SubtleCrypto`.

---

## Contributing Locations

Use the **新增地點 / Add Location** button or the **建議修改 / Suggest edit** button on any card. Submissions go to Netlify Forms and are reviewed by the admin before appearing on the map.

---

## Running Tests

Tests use Node.js built-in `node:test` — no test framework to install.

```bash
node --test tests/*.test.mjs
```

Test files:

| File | What it covers |
|------|---------------|
| `parsecsv.test.mjs` | CSV tokenizer, parser, status normalizer, source helpers |
| `source-tags.test.mjs` | `renderSources` — Threads handle extraction, platform URL mapping |
| `i18n-ui.test.mjs` | `updateLangUI`, `buildCatFilter`, `rebuildSelect` |
| `ui-events.test.mjs` | Static markup has no inline `onclick`; `switchTab` state alignment |
| `add-location-form.test.mjs` | Netlify form field parity, URL validator, submit mock |
| `google-maps-loader.test.mjs` | No hardcoded API key placeholders; runtime config fetch |
| `no-maplink-ui.test.mjs` | No legacy "Open in Maps" links in HTML |
| `styles-extraction.test.mjs` | External CSS linked; no inline presentational styles |
| `config-function.test.mjs` | `/api/config` Netlify Function |
| `locations-function.test.mjs` | `/api/locations` Netlify Function |
