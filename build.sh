#!/bin/bash
# Lingorm Map — Netlify build script
# Validates deploy environment. Runtime config is read by Netlify Functions.
#
# Required env vars (set in Netlify Dashboard → Environment Variables):
#   HERE_API_KEY — HERE Maps JS API key (fallback provider, required)
#
# Optional env vars:
#   GOOGLE_MAPS_KEY       — Google Maps JS API key (primary provider)
#   GOOGLE_MAP_ID         — Google Maps Map ID (required if GOOGLE_MAPS_KEY is set)
#   DATA_SOURCE           — notion (default; only supported value)
#
# DATA_SOURCE=sheet is retired as of the 2026-07-21 three-status cutover:
# normalizeStatus() no longer maps legacy verified/needs-review to Published,
# so the sheet path would render zero public locations. Do not set it.

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

# ── Location data source ─────────────────────────────────────
DATA_SOURCE="${DATA_SOURCE:-notion}"
case "$DATA_SOURCE" in
  sheet)
    echo "❌  DATA_SOURCE=sheet is retired — legacy verified/needs-review statuses"
    echo "    now normalize to Paused (non-public), so the sheet path would"
    echo "    render zero public locations. Set DATA_SOURCE=notion (or unset it)."
    exit 1
    ;;
  notion)
    if [ ! -f "data/locations.csv" ]; then
      echo "❌  data/locations.csv not found — required when DATA_SOURCE=notion."
      exit 1
    fi
    node scripts/validate-location-snapshot.mjs data/locations.csv
    node scripts/validate-favorite-compatibility.mjs \
      data/locations.csv data/legacy-favorite-ids.json
    echo "✅ Committed Notion snapshot validated for /api/locations."
    ;;
  *)
    echo "❌  DATA_SOURCE must be \"notion\" (sheet rollback path is retired)."
    exit 1
    ;;
esac

echo "Build complete."
