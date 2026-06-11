#!/bin/bash
# Lingorm Bangkok Map — Netlify build script
# Injects secrets from environment variables into index.html at deploy time.
# Plaintext secrets never touch the HTML or git history.
#
# Required env vars (set in Netlify Dashboard → Environment Variables):
#   GOOGLE_MAPS_KEY   — Google Maps JS API key
#   GOOGLE_MAP_ID     — Google Maps Map ID (for dark mode + AdvancedMarkerElement)
#   ADMIN_PASSWORD    — (optional) admin panel password

set -e

# ── Google Maps Key ──────────────────────────────────────────
if [ -z "$GOOGLE_MAPS_KEY" ]; then
  echo "❌  GOOGLE_MAPS_KEY not set — map will not load."
  exit 1
else
  sed -i "s|__GOOGLE_MAPS_KEY__|${GOOGLE_MAPS_KEY}|g" index.html
  echo "✅ Google Maps key injected."
fi

# ── Google Map ID ────────────────────────────────────────────
if [ -z "$GOOGLE_MAP_ID" ]; then
  echo "❌  GOOGLE_MAP_ID not set — dark mode and markers will not work."
  exit 1
else
  sed -i "s|__GOOGLE_MAP_ID__|${GOOGLE_MAP_ID}|g" index.html
  echo "✅ Google Map ID injected."
fi

# ── Admin Password (optional) ────────────────────────────────
if [ -z "$ADMIN_PASSWORD" ]; then
  echo "⚠️  ADMIN_PASSWORD not set — admin login will be disabled."
  sed -i "s|__ADMIN_HASH__||g" index.html
else
  HASH=$(printf '%s' "$ADMIN_PASSWORD" | sha256sum | awk '{print $1}')
  sed -i "s|__ADMIN_HASH__|${HASH}|g" index.html
  echo "✅ Admin hash injected (first 8 chars: ${HASH:0:8}...)."
fi

echo "Build complete."
