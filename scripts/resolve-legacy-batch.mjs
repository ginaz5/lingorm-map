#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// resolve-legacy-batch.mjs
//
// Populates Google Place ID for all rows in the frozen migration CSV
// (docs/notion-migration-and-location-automation-plan.md §17, task
// "Run resolve.mjs at full scale to populate Google Place ID").
//
// Why this exists alongside resolve.mjs: resolve.mjs targets the Places
// API (New) POST endpoint (places:searchText) — the right choice for the
// real Phase 3 pipeline (§8, §13 Phase 3), which will run in GitHub Actions
// or locally where outbound POST to places.googleapis.com is unrestricted.
// From the agent sandbox used during this migration, though, POST calls to
// places.googleapis.com don't reach Google at all (no route to host), and
// GET calls via the sandbox's fetch proxy get REQUEST_DENIED /
// "API keys with referer restrictions cannot be used with this API" even
// after the key's Application restriction was confirmed set to "None" in
// GCP Console and independently verified working via the user's own curl
// and browser — i.e. the sandbox's outbound path itself trips the referrer
// check, not the key configuration. This script uses the legacy GET-based
// Places Text Search endpoint (maps.googleapis.com/maps/api/place/textsearch)
// specifically so it can be run from an unrestricted terminal (yours) —
// see docs/notion-migration-and-location-automation-plan.md §18 for the
// full context.
//
// This script NEVER overwrites Lat/Lng or Status. It only proposes a
// Google Place ID per row, plus a distance-from-stored-coords check, so a
// human (or a follow-up Notion-write step) can decide what to do with
// disagreements — same "never auto-publish a factual correction" posture
// as the rest of the pipeline (plan §7.3, §12).
//
// Usage:
//   GOOGLE_PLACE_KEY=AIza... node scripts/resolve-legacy-batch.mjs data/migration/source-20260718.csv
//
// Output:
//   migration-output/place-id-resolution.json  — full per-row result
//   migration-output/place-id-report.md        — human-readable summary
// ═══════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tokenizeCSV, slugify } from "../src/csv-parser.js";
import { haversineMeters } from "./resolve.mjs";

const KEY = process.env.GOOGLE_PLACE_KEY || process.env.GOOGLE_PLACES_KEY;
if (!KEY) {
  console.error("Missing GOOGLE_PLACE_KEY (or GOOGLE_PLACES_KEY) env var.");
  process.exit(1);
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/resolve-legacy-batch.mjs <source.csv>");
  process.exit(1);
}

const BIAS_RADIUS_METERS = 5000; // location bias, not a hard filter
const REQUEST_DELAY_MS = 200; // polite pacing — legacy API has generous but non-infinite QPS
const FLAG_DISTANCE_METERS = 150; // same threshold as the dedupe stage (plan §7.1/§9.1)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function legacyTextSearch(query, lat, lng) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("region", "th");
  if (!isNaN(lat) && !isNaN(lng)) {
    url.searchParams.set("location", `${lat},${lng}`);
    url.searchParams.set("radius", String(BIAS_RADIUS_METERS));
  }
  url.searchParams.set("key", KEY);

  const res = await fetch(url);
  const body = await res.json();
  if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
    throw new Error(`Places API error: ${body.status} — ${body.error_message || "no message"}`);
  }
  const top = body.results?.[0];
  if (!top) return null;
  return {
    placeId: top.place_id,
    name: top.name || "",
    address: top.formatted_address || "",
    lat: top.geometry?.location?.lat ?? null,
    lng: top.geometry?.location?.lng ?? null,
    businessStatus: top.business_status || "",
    types: top.types || [],
  };
}

async function main() {
  const text = readFileSync(inputPath, "utf8");
  const rows = tokenizeCSV(text);
  const headers = rows[0].map((h) => h.replace(/^﻿/, "").trim());
  const idx = {};
  headers.forEach((h, i) => (idx[h] = i));
  const cell = (r, k) => (idx[k] !== undefined ? (r[idx[k]] || "").trim() : "");
  const dataRows = rows.slice(1).filter((r) => r.join("").trim());

  const results = [];
  let ok = 0, flagged = 0, noResult = 0, errors = 0;

  for (const [i, r] of dataRows.entries()) {
    const name = cell(r, "Location Name");
    if (!name) continue;
    const slug = slugify(name);
    const lat = parseFloat(cell(r, "Lat"));
    const lng = parseFloat(cell(r, "Lng"));

    process.stderr.write(`[${i + 1}/${dataRows.length}] ${name} ... `);

    try {
      const resolved = await legacyTextSearch(name, lat, lng);
      if (!resolved) {
        noResult++;
        results.push({ slug, name, placeId: null, flagForReview: true, reason: "no_result" });
        process.stderr.write("no result\n");
      } else {
        const distanceMeters =
          !isNaN(lat) && !isNaN(lng) && resolved.lat !== null
            ? haversineMeters(lat, lng, resolved.lat, resolved.lng)
            : null;
        const flagForReview = distanceMeters === null || distanceMeters > FLAG_DISTANCE_METERS;
        if (flagForReview) flagged++; else ok++;
        results.push({
          slug,
          name,
          placeId: resolved.placeId,
          resolvedName: resolved.name,
          resolvedAddress: resolved.address,
          businessStatus: resolved.businessStatus,
          distanceMeters: distanceMeters === null ? null : Math.round(distanceMeters),
          flagForReview,
          reason: flagForReview ? (distanceMeters === null ? "no_stored_coords" : "moved_over_150m") : null,
        });
        process.stderr.write(`${resolved.placeId} (${distanceMeters === null ? "n/a" : Math.round(distanceMeters) + "m"})\n`);
      }
    } catch (err) {
      errors++;
      results.push({ slug, name, placeId: null, flagForReview: true, reason: "error", error: String(err.message || err) });
      process.stderr.write(`ERROR: ${err.message}\n`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  mkdirSync("migration-output", { recursive: true });
  writeFileSync("migration-output/place-id-resolution.json", JSON.stringify(results, null, 2));

  const flaggedRows = results.filter((r) => r.flagForReview);
  writeFileSync("migration-output/place-id-report.md", [
    `# Google Place ID resolution report — ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `Source: ${inputPath}`,
    `Total: ${results.length} | Clean match: ${ok} | Flagged for review: ${flagged + noResult + errors} (moved >${FLAG_DISTANCE_METERS}m / no result / error)`,
    ``,
    `## Flagged rows`,
    ``,
    ...flaggedRows.map((r) => `- **${r.name}** (${r.slug}): ${r.reason}${r.placeId ? ` — candidate ${r.placeId}, ${r.distanceMeters}m away` : ""}`),
  ].join("\n"));

  console.log(`\nDone. ${ok} clean, ${flagged} moved >${FLAG_DISTANCE_METERS}m, ${noResult} no result, ${errors} errors.`);
  console.log(`Wrote migration-output/place-id-resolution.json, migration-output/place-id-report.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
