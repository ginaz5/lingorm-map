#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// resolve.mjs
//
// Phase 1 PoC resolver spike (docs/notion-migration-and-location-automation-plan.md
// §7.1 "resolve place", §13 Phase 1). Deterministic place resolution — never
// LLM-derived (plan §7.3: 14/34 hand/LLM coords were wrong historically,
// worst 18.8 km off).
//
// Uses Google Places API (New) Text Search (places:searchText), matching
// the plan's §8 recommendation and the "Text Search Pro" SKU it prices.
// Cross-checks against the venue's currently-stored Lat/Lng (haversine
// distance) so a run can flag "moved more than 150m" for human review
// (same 150m threshold as the dedupe check in plan §7.1 step 4).
//
// Usage:
//   GOOGLE_PLACES_KEY=AIza... node scripts/resolve.mjs "Dear December Cafe" 13.675657 100.644664
//   GOOGLE_PLACES_KEY=AIza... node scripts/resolve.mjs --batch venues.json
//
// Key requirements (learned the hard way during the Phase 1 spike):
//   - Must be a *separate* server-side key, not the frontend GOOGLE_MAPS_KEY.
//   - Application restriction must be "None" or "IP addresses" — "HTTP
//     referrers" (websites) always fails server-side calls with
//     REQUEST_DENIED / "API keys with referer restrictions cannot be used
//     with this API", regardless of whether Places API is enabled.
//   - Restriction changes can take longer than Google's stated "up to 5
//     minutes" to propagate — if you get that error right after saving,
//     wait and retry before assuming the config is wrong.
// ═══════════════════════════════════════════════════

// Read lazily (not at module load) so this file can be `import`ed for its
// pure helpers (haversineMeters) from other scripts — e.g.
// resolve-legacy-batch.mjs — without requiring the env var or triggering
// a process.exit() as a side effect of importing.
const getKey = () => process.env.GOOGLE_PLACES_KEY || process.env.GOOGLE_PLACE_KEY;

const TH_REGION_CODE = "TH";

// Haversine distance in meters — same formula the dedupe stage (plan §7.1,
// §9.1 dedupe.mjs) should use for "same place" clustering.
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.businessStatus",
  "places.types",
].join(",");

export async function resolvePlace(query) {
  const key = getKey();
  if (!key) {
    throw new Error("Missing GOOGLE_PLACES_KEY (or GOOGLE_PLACE_KEY) env var.");
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      regionCode: TH_REGION_CODE,
      // languageCode omitted — let Google pick based on the query script
    }),
  });
  if (!res.ok) {
    throw new Error(`Places API error ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  const top = body.places?.[0];
  if (!top) return null;
  return {
    placeId: top.id,
    name: top.displayName?.text || "",
    address: top.formattedAddress || "",
    lat: top.location?.latitude ?? null,
    lng: top.location?.longitude ?? null,
    businessStatus: top.businessStatus || "",
    types: top.types || [],
  };
}

export function assessResolvedPlace(name, knownLat, knownLng, resolved) {
  if (!resolved) {
    return { name, resolved: null, distanceMeters: null, flagForReview: true, reason: "no_result" };
  }

  const isCoordinate = (value) =>
    value !== null && value !== "" && Number.isFinite(Number(value));

  const resolvedLat = Number(resolved.lat);
  const resolvedLng = Number(resolved.lng);
  if (!isCoordinate(resolved.lat) || !isCoordinate(resolved.lng)) {
    return { name, resolved, distanceMeters: null, flagForReview: true, reason: "no_resolved_coords" };
  }

  const storedLat = Number(knownLat);
  const storedLng = Number(knownLng);
  if (!isCoordinate(knownLat) || !isCoordinate(knownLng)) {
    return { name, resolved, distanceMeters: null, flagForReview: true, reason: "no_stored_coords" };
  }

  const distanceMeters = haversineMeters(storedLat, storedLng, resolvedLat, resolvedLng);
  return {
    name,
    resolved,
    distanceMeters,
    flagForReview: distanceMeters > 150,
    reason: distanceMeters > 150 ? "moved_over_150m" : null,
  };
}

// Resolve + cross-check against a known (name, lat, lng) triple. Returns
// { resolved, distanceMeters, flagForReview } — flagForReview mirrors the
// plan's 150m dedupe threshold (§7.1, §9.1).
export async function resolveAndCheck(name, knownLat, knownLng, queryHint = "") {
  const resolved = await resolvePlace(queryHint || `${name} Bangkok`);
  return assessResolvedPlace(name, knownLat, knownLng, resolved);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--batch") {
    const { readFileSync } = await import("node:fs");
    const venues = JSON.parse(readFileSync(args[1], "utf8"));
    for (const v of venues) {
      const result = await resolveAndCheck(v.name, v.lat, v.lng, v.query);
      console.log(JSON.stringify(result));
    }
    return;
  }
  const [name, lat, lng] = args;
  const result = await resolveAndCheck(name, parseFloat(lat), parseFloat(lng));
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
