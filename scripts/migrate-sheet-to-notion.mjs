#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// migrate-sheet-to-notion.mjs
//
// Phase 2 full migration (docs/notion-migration-and-location-automation-plan.md
// §10, §13 Phase 2). Reads the frozen source CSV (data/migration/source-*.csv),
// applies the cleaning pass described in §10.3, detects branch duplicates and
// slug collisions, and emits a JSON payload ready for notion-create-pages
// (or, once a real NOTION_API_KEY exists, for a direct REST upsert — see the
// TODO at the bottom).
//
// This is a transform script, not a Notion client: it produces
// migration-output/pages.json + migration-output/cleaning-log.md, which are
// then reviewed and fed into the actual Notion write (currently done via the
// Cowork Notion connector's create-pages tool since no raw NOTION_API_KEY
// exists yet — see scripts/export-snapshot.mjs's usage note for the same
// constraint).
//
// Usage:
//   node scripts/migrate-sheet-to-notion.mjs data/migration/source-20260718.csv
// ═══════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  tokenizeCSV, slugify, normalizeStatus, normalizeSourceTags,
  CATEGORY_ALIASES,
} from "../src/csv-parser.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/migrate-sheet-to-notion.mjs <source.csv>");
  process.exit(1);
}

// Rows already imported during the Phase 1 PoC (2026-07-18) — skip them here
// so re-running this script doesn't create duplicate Notion pages. This list
// is the idempotency mechanism until a real NOTION_API_KEY lets the script
// query existing Slugs itself (see TODO at the bottom).
const ALREADY_IN_NOTION = new Set([
  "the-siam-hotel", "dear-december-cafe", "r-bar", "yoru-omakase",
  "nai-uan-yentafo-amarin", "g-i-y-ang-r-b-iap-grilled-chicken-and-som-tum",
  "ekamai-mookata", "somtam-nua", "talat-noi-street-art",
  "mil-toast-house-emquartier",
]);

// Known branch-duplicate groups (plan §4 issue 4, §10 step 4). Matched by
// slug prefix/name pattern since there's no reliable machine signal — this
// list is a manually-curated result of reading the source data, exactly the
// kind of judgment call the plan says dedup edge cases need (§16 answer 5).
const BRANCH_GROUPS = [
  { key: "mil-toast-house", slugs: ["mil-toast-house-emquartier", "mil-toast-house-siam-branch"] },
  { key: "butterbear-cafe", slugs: ["butterbear-cafe-siam-paragon", "butterbear-cafe-emsphere"] },
  { key: "chago", slugs: ["chag", "chago-emquartier"] }, // resolved precisely below via name matching
  { key: "chin-bo-dang", slugs: ["chin-bo-dang-central-world", "chin-bo-dang"] },
];

const text = readFileSync(inputPath, "utf8");
const rows = tokenizeCSV(text);
const headers = rows[0].map((h) => h.replace(/^﻿/, "").trim());
const idx = {};
headers.forEach((h, i) => (idx[h] = i));
const read = (r, k) => (idx[k] !== undefined ? r[k !== undefined ? idx[k] : -1] || "" : "").trim();
const cell = (r, k) => (idx[k] !== undefined ? (r[idx[k]] || "").trim() : "");

const dataRows = rows.slice(1).filter((r) => r.join("").trim());

const log = [];
const pages = [];
const seenSlugs = new Map(); // slug -> [names] for collision detection
const coordGroups = new Map(); // "lat,lng" -> [names] for placeholder-coord detection

for (const r of dataRows) {
  const name = cell(r, "Location Name");
  if (!name) continue;
  const slug = slugify(name);

  if (seenSlugs.has(slug)) {
    log.push(`⚠️ SLUG COLLISION: "${name}" and "${seenSlugs.get(slug)}" both slugify to "${slug}"`);
  }
  seenSlugs.set(slug, name);

  const rawCategory = cell(r, "Category");
  const alias = CATEGORY_ALIASES[rawCategory];
  const category = alias ? alias.en : rawCategory;
  if (alias && alias.en !== rawCategory) log.push(`category alias: "${name}": "${rawCategory}" -> "${category}"`);

  const rawTags = cell(r, "Source Tags");
  let sourceTags;
  if (rawTags === "___epoh___") {
    // plan §4 issue 3: a Threads handle stored as a tag. Every row in this
    // batch's Source URL is the same Google Maps *list* link
    // (SThB6uC4zygrANNY7), not the actual fan post — the real post lives as
    // a raw URL inside Notes ZH. The handle itself ("___epoh___") is a
    // Threads username, confirming the platform even without parsing the
    // embedded URL, so the deterministic, logged fix is Threads.
    sourceTags = ["Threads"];
    log.push(`tag drift cleanup: "${name}": Source Tags "___epoh___" -> "Threads"`);
  } else {
    sourceTags = normalizeSourceTags(rawTags).split(" + ").filter(Boolean);
  }

  const lat = parseFloat(cell(r, "Lat"));
  const lng = parseFloat(cell(r, "Lng"));
  const coordKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (!coordGroups.has(coordKey)) coordGroups.set(coordKey, []);
  coordGroups.get(coordKey).push(name);

  let status = normalizeStatus(cell(r, "Verification Status"));

  pages.push({
    name,
    slug,
    properties: {
      Name: name,
      Slug: slug,
      "Name ZH": cell(r, "Location Name ZH") || name,
      "Thai / Alt Name": cell(r, "Thai / Alt Name"),
      Category: category,
      "Notes EN": cell(r, "Notes"),
      "Notes ZH": cell(r, "Notes ZH") || cell(r, "Notes"),
      "Google Maps URL": cell(r, "Google Maps URL"),
      Lat: isNaN(lat) ? null : lat,
      Lng: isNaN(lng) ? null : lng,
      "Coordinates Approx": /true/i.test(cell(r, "Coordinates Approx")) ? "__YES__" : "__NO__",
      Status: status,
      "Source URLs": cell(r, "Source URL"),
      "Source Tags": sourceTags,
      Origin: "manual",
    },
    icon: cell(r, "Icon") || null,
  });
}

// Flag placeholder/repeated coordinates shared by >=3 distinct venues
// (plan §4 issue 2, §10.3) — bump Status to "Needs Review" if not already
// Verified-worthy-but-actually-Could-Not-Find. Logged, not silent.
for (const [coordKey, names] of coordGroups) {
  const uniqueNames = [...new Set(names)];
  if (uniqueNames.length >= 3) {
    log.push(`⚠️ PLACEHOLDER COORD CLUSTER: ${coordKey} shared by ${uniqueNames.length} venues: ${uniqueNames.join(", ")}`);
    for (const p of pages) {
      if (uniqueNames.includes(p.name) && p.properties.Status === "Verified") {
        p.properties.Status = "Needs Review";
        log.push(`  -> "${p.name}": Status Verified -> Needs Review (shared placeholder coord)`);
      }
    }
  }
}

// Branch Group assignment — precise name-based matching (safer than the
// slug-prefix table above for the "Chagô" case, which has diacritics).
const branchPairs = [
  ["mil-toast-house-emquartier", "mil-toast-house-siam-branch"],
  ["butterbear-cafe-siam-paragon", "butterbear-cafe-emsphere"],
  ["chin-bo-dang-central-world", "chin-bo-dang"],
];
// Chagô: "Chagô" (original) and "CHAGÔ ชาโก้ - EmQuartier" (branch 2) —
// matched by name substring since slugify() strips the diacritic
// differently for each (§4 issue 4).
const chago = pages.filter((p) => /cha.?g.?[ôo]/i.test(p.name));
if (chago.length === 2) branchPairs.push([chago[0].slug, chago[1].slug]);

for (const [slugA, slugB] of branchPairs) {
  const a = pages.find((p) => p.slug === slugA);
  const b = pages.find((p) => p.slug === slugB);
  if (a && b) {
    const groupId = `${a.slug}+${b.slug}`;
    a.properties["Branch Group"] = groupId;
    b.properties["Branch Group"] = groupId;
    log.push(`branch group: "${a.name}" <-> "${b.name}" (${groupId})`);
  } else {
    log.push(`⚠️ branch group expected but not both found: ${slugA} / ${slugB}`);
  }
}

// Split: pages already in Notion (Phase 1 PoC) vs. new pages to create
const toCreate = pages.filter((p) => !ALREADY_IN_NOTION.has(p.slug));
const alreadyPresent = pages.filter((p) => ALREADY_IN_NOTION.has(p.slug));

// Re-check: did any already-present PoC row just get a *new* Branch Group
// assignment from the passes above? That needs a notion-update-page call,
// not create-pages, since the page already exists. (Status downgrades from
// the placeholder-coord pass are handled the same way, but none of the
// Phase 1 PoC rows happened to land in a triggered cluster this run.)
const needsUpdate = alreadyPresent.filter((p) => p.properties["Branch Group"]);

mkdirSync("migration-output", { recursive: true });
writeFileSync("migration-output/pages-to-create.json", JSON.stringify(toCreate, null, 2));
writeFileSync("migration-output/pages-to-update.json", JSON.stringify(needsUpdate, null, 2));
writeFileSync("migration-output/cleaning-log.md", [
  `# Migration cleaning log — ${new Date().toISOString().slice(0, 10)}`,
  ``,
  `Source: ${inputPath}`,
  `Total rows: ${pages.length} | Already in Notion (Phase 1 PoC, skipped): ${alreadyPresent.length} | To create: ${toCreate.length} | To update (branch group / status change on already-migrated rows): ${needsUpdate.length}`,
  ``,
  ...log.map((l) => `- ${l}`),
].join("\n"));

console.log(`Total: ${pages.length}, to create: ${toCreate.length}, already present: ${alreadyPresent.length}, need update: ${needsUpdate.length}`);
console.log(`Wrote migration-output/pages-to-create.json, pages-to-update.json, cleaning-log.md`);

// TODO(Phase 3): once a real NOTION_API_KEY exists, replace the JSON-file
// hand-off above with a direct idempotent upsert against
// /v1/data_sources/:id/query (match by Slug) + /v1/pages (create) or
// /v1/pages/:id (update), same pattern as scripts/export-snapshot.mjs.
