#!/bin/bash
# Lingorm Map — Netlify build script
# Validates deploy environment. Runtime config is read by Netlify Functions.
#
# Required env vars (set in Netlify Dashboard → Environment Variables):
#   HERE_API_KEY         — HERE Maps JS API key (fallback provider, required)
#   GOOGLE_SHEET_CSV_URL — Google Sheets published CSV URL for /api/locations (required)
#
# Optional env vars:
#   GOOGLE_MAPS_KEY  — Google Maps JS API key (primary provider)
#   GOOGLE_MAP_ID    — Google Maps Map ID (required if GOOGLE_MAPS_KEY is set)

set -e

# ── HERE Maps Key (required fallback provider) ───────────────
if [ -z "$HERE_API_KEY" ]; then
  echo "❌  HERE_API_KEY not set — fallback map provider will not work."
  exit 1
else
  echo "✅ HERE Maps key configured for /api/config."
fi

# ── Google Maps Keys (optional primary provider) ─────────────
if [ -z "$GOOGLE_MAPS_KEY" ] || [ -z "$GOOGLE_MAP_ID" ]; then
  echo "⚠️  GOOGLE_MAPS_KEY or GOOGLE_MAP_ID not set — will use HERE Maps only."
else
  echo "✅ Google Maps keys configured — Google Maps will be used as primary provider."
fi

# ── Google Sheets CSV URL (required) ─────────────────────────
if [ -z "$GOOGLE_SHEET_CSV_URL" ]; then
  echo "❌  GOOGLE_SHEET_CSV_URL not set — /api/locations will not load sheet data."
  exit 1
else
  echo "✅ Google Sheet CSV URL configured for /api/locations."
fi

echo "Build complete."
