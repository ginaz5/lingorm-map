#!/bin/bash
# Lingorm Bangkok Map — Netlify build script
# Validates deploy environment and injects admin-only HTML values.
# Runtime config is read by Netlify Functions.
#
# Required env vars (set in Netlify Dashboard → Environment Variables):
#   GOOGLE_MAPS_KEY   — Google Maps JS API key
#   GOOGLE_MAP_ID     — Google Maps Map ID (for dark mode + AdvancedMarkerElement)
#   GOOGLE_SHEET_CSV_URL — Google Sheets published CSV URL for /api/locations
#   ADMIN_PASSWORD    — (optional) admin panel password

set -e

# ── Google Maps Key (Function runtime) ───────────────────────
if [ -z "$GOOGLE_MAPS_KEY" ]; then
  echo "❌  GOOGLE_MAPS_KEY not set — map will not load."
  exit 1
else
  echo "✅ Google Maps key configured for /api/config."
fi

# ── Google Map ID (Function runtime) ─────────────────────────
if [ -z "$GOOGLE_MAP_ID" ]; then
  echo "❌  GOOGLE_MAP_ID not set — dark mode and markers will not work."
  exit 1
else
  echo "✅ Google Map ID configured for /api/config."
fi

# ── Admin Password (optional) ────────────────────────────────
# Hash is now injected at Vite build time via vite.config.js define(__ADMIN_HASH__).
# build.sh only validates that the env var is present; no perl sed needed.
if [ -z "$ADMIN_PASSWORD" ]; then
  echo "⚠️  ADMIN_PASSWORD not set — admin login will be disabled."
else
  echo "✅ Admin password found — Vite will hash it into the bundle."
fi

# ── Google Sheets CSV URL (Function runtime only) ────────────
if [ -z "$GOOGLE_SHEET_CSV_URL" ]; then
  echo "❌  GOOGLE_SHEET_CSV_URL not set — /api/locations will not load sheet data."
  exit 1
else
  echo "✅ Google Sheet CSV URL configured for /api/locations."
fi

echo "Build complete."
