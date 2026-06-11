#!/bin/bash
# Lingorm Bangkok Map — Netlify build script
# Injects browser-required values into index.html at deploy time.
# Server-only values are validated here but read by Netlify Functions at runtime.
#
# Required env vars (set in Netlify Dashboard → Environment Variables):
#   GOOGLE_MAPS_KEY   — Google Maps JS API key
#   GOOGLE_MAP_ID     — Google Maps Map ID (for dark mode + AdvancedMarkerElement)
#   GOOGLE_SHEET_CSV_URL — Google Sheets published CSV URL for /api/locations
#   ADMIN_PASSWORD    — (optional) admin panel password

set -e

# ── Google Maps Key ──────────────────────────────────────────
if [ -z "$GOOGLE_MAPS_KEY" ]; then
  echo "❌  GOOGLE_MAPS_KEY not set — map will not load."
  exit 1
else
  perl -0pi -e 's/__GOOGLE_MAPS_KEY__/$ENV{GOOGLE_MAPS_KEY}/g' index.html
  echo "✅ Google Maps key injected."
fi

# ── Google Map ID ────────────────────────────────────────────
if [ -z "$GOOGLE_MAP_ID" ]; then
  echo "❌  GOOGLE_MAP_ID not set — dark mode and markers will not work."
  exit 1
else
  perl -0pi -e 's/__GOOGLE_MAP_ID__/$ENV{GOOGLE_MAP_ID}/g' index.html
  echo "✅ Google Map ID injected."
fi

# ── Admin Password (optional) ────────────────────────────────
if [ -z "$ADMIN_PASSWORD" ]; then
  echo "⚠️  ADMIN_PASSWORD not set — admin login will be disabled."
  perl -0pi -e 's/__ADMIN_HASH__//g' index.html
else
  HASH=$(printf '%s' "$ADMIN_PASSWORD" | sha256sum | awk '{print $1}')
  ADMIN_HASH="$HASH" perl -0pi -e 's/__ADMIN_HASH__/$ENV{ADMIN_HASH}/g' index.html
  echo "✅ Admin hash injected (first 8 chars: ${HASH:0:8}...)."
fi

# ── Google Sheets CSV URL (Function runtime only) ────────────
if [ -z "$GOOGLE_SHEET_CSV_URL" ]; then
  echo "❌  GOOGLE_SHEET_CSV_URL not set — /api/locations will not load sheet data."
  exit 1
else
  echo "✅ Google Sheet CSV URL configured for /api/locations."
fi

echo "Build complete."
