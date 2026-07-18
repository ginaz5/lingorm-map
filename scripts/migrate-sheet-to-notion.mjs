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
//   node scripts/migrate-sheet-to-notion.mjs data/migration/source-20260718.csv \
//     --existing-slugs data/migration/notion-export.csv
// ═══════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  tokenizeCSV, slugify, normalizeStatus, normalizeSourceTags,
  CATEGORY_ALIASES,
} from "../src/csv-parser.js";

function slugFromExistingItem(item) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  if (typeof item.slug === "string") return item.slug.trim();
  const slug = item.properties?.Slug;
  if (typeof slug === "string") return slug.trim();
  return (slug?.rich_text || []).map((part) => part.plain_text || "").join("").trim();
}

function parseExistingSlugs(text) {
  const trimmed = text.trim();
  if (!trimmed) return new Set();

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return new Set(parsed.map(slugFromExistingItem).filter(Boolean));
    }
  } catch {
    // Fall through to CSV or newline-delimited text.
  }

  const rows = tokenizeCSV(text);
  const headers = rows[0].map((header) => header.replace(/^﻿/, "").trim());
  const slugIndex = headers.indexOf("Slug");
  const nameIndex = headers.indexOf("Location Name");
  if (slugIndex !== -1 || nameIndex !== -1) {
    return new Set(rows.slice(1).map((row) => {
      const slug = slugIndex === -1 ? "" : (row[slugIndex] || "").trim();
      const name = nameIndex === -1 ? "" : (row[nameIndex] || "").trim();
      return slug || (name ? slugify(name) : "");
    }).filter(Boolean));
  }

  return new Set(trimmed.split(/\r?\n/).map((slug) => slug.trim()).filter(Boolean));
}

const args = process.argv.slice(2);
const inputPath = args[0];
const existingSlugsIndex = args.indexOf("--existing-slugs");
const existingSlugsPath = existingSlugsIndex === -1 ? "" : args[existingSlugsIndex + 1];
if (!inputPath || !existingSlugsPath) {
  console.error("Usage: node scripts/migrate-sheet-to-notion.mjs <source.csv> --existing-slugs <notion-export.csv|json|txt>");
  process.exit(1);
}

const existingSlugs = parseExistingSlugs(readFileSync(existingSlugsPath, "utf8"));
const text = readFileSync(inputPath, "utf8");
const rows = tokenizeCSV(text);
const headers = rows[0].map((h) => h.replace(/^﻿/, "").trim());
const idx = {};
headers.forEach((h, i) => (idx[h] = i));
const cell = (r, k) => (idx[k] !== undefined ? (r[idx[k]] || "").trim() : "");

const dataRows = rows.slice(1).filter((r) => r.join("").trim());

const log = [];
const pages = [];
const seenSlugs = new Map();
const slugCollisions = [];
const coordGroups = new Map(); // "lat,lng" -> [names] for placeholder-coord detection

for (const r of dataRows) {
  const name = cell(r, "Location Name");
  if (!name) continue;
  const slug = slugify(name);

  if (!slug) {
    slugCollisions.push(`"${name}" produces an empty slug`);
  } else if (seenSlugs.has(slug)) {
    slugCollisions.push(`"${name}" and "${seenSlugs.get(slug)}" both slugify to "${slug}"`);
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
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const coordKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (!coordGroups.has(coordKey)) coordGroups.set(coordKey, []);
    coordGroups.get(coordKey).push(name);
  }

  const status = normalizeStatus(cell(r, "Verification Status"));

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

if (slugCollisions.length) {
  console.error(`Slug collisions detected; no migration payload was written:\n- ${slugCollisions.join("\n- ")}`);
  process.exit(1);
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

// Split against a fresh snapshot of existing Notion slugs. Requiring this
// state explicitly keeps repeated runs from emitting duplicate create calls.
const toCreate = pages.filter((p) => !existingSlugs.has(p.slug));
const alreadyPresent = pages.filter((p) => existingSlugs.has(p.slug));

// A slug-only snapshot cannot prove whether an existing page's other
// properties differ. Skip existing rows rather than emitting repeated blind
// updates; the planned API-backed upsert will compare full page state.
const needsUpdate = [];

mkdirSync("migration-output", { recursive: true });
writeFileSync("migration-output/pages-to-create.json", JSON.stringify(toCreate, null, 2));
writeFileSync("migration-output/pages-to-update.json", JSON.stringify(needsUpdate, null, 2));
writeFileSync("migration-output/cleaning-log.md", [
  `# Migration cleaning log — ${new Date().toISOString().slice(0, 10)}`,
  ``,
  `Source: ${inputPath}`,
  `Total rows: ${pages.length} | Already in Notion (snapshot, skipped): ${alreadyPresent.length} | To create: ${toCreate.length} | To update (branch group / status change on already-migrated rows): ${needsUpdate.length}`,
  ``,
  ...log.map((l) => `- ${l}`),
].join("\n"));

console.log(`Total: ${pages.length}, to create: ${toCreate.length}, already present: ${alreadyPresent.length}, need update: ${needsUpdate.length}`);
console.log(`Wrote migration-output/pages-to-create.json, pages-to-update.json, cleaning-log.md`);

// TODO(Phase 3): once a real NOTION_API_KEY exists, replace the JSON-file
// hand-off above with a direct idempotent upsert against
// /v1/data_sources/:id/query (match by Slug) + /v1/pages (create) or
// /v1/pages/:id (update), same pattern as scripts/export-snapshot.mjs.
