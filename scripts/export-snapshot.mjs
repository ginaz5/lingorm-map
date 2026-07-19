#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// export-snapshot.mjs
//
// Phase 1/2 (docs/notion-migration-and-location-automation-plan.md
// §6.3, §9.1, §13): reads the Notion "Locations" data source and
// emits the 14 published location fields that parsePublishedFormat()
// in src/csv-parser.js understands, plus the stable "Slug" column.
// The frontend parser is header-based and ignores unknown columns.
//
// Usage:
//   NOTION_API_KEY=secret_xxx NOTION_DATA_SOURCE_ID=collection-uuid \
//     node scripts/export-snapshot.mjs > data/locations.csv
//
// Requires an internal Notion integration (create one at
// notion.so/my-integrations) with read access to the Locations data
// source — share it from the database's "..." menu → Connections.
// This is separate from any Cowork/Claude Notion connector.
// ═══════════════════════════════════════════════════

const NOTION_VERSION = "2025-09-03"; // plan §5.1 — pin the version; databases/data sources split here

export const CSV_HEADER = [
  "Location Name", "Location Name ZH", "Thai / Alt Name", "Google Maps URL",
  "Category", "Notes", "Notes ZH", "Source URL", "Source Tags",
  "Verification Status", "Lat", "Lng", "Icon",
  "Coordinates Approx", "Slug", // Slug is additive (Phase 2, §6.3); parseCSV() prefers it over slugify(name) as of the ID fix (2026-07-18)
];

async function queryAllPages(dataSourceId, apiKey) {
  const pages = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": NOTION_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({ start_cursor: cursor, page_size: 100 }),
    });
    if (!res.ok) {
      throw new Error(`Notion query failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    pages.push(...body.results);
    cursor = body.has_more ? body.next_cursor : undefined;
  } while (cursor);
  return pages;
}

// ── Notion property readers ──────────────────────────
const text = (prop) => (prop?.rich_text || []).map((t) => t.plain_text).join("") || "";
const title = (prop) => (prop?.title || []).map((t) => t.plain_text).join("") || "";
const select = (prop) => prop?.select?.name || "";
const multiSelect = (prop) => (prop?.multi_select || []).map((o) => o.name).join(", ");
const number = (prop) => (typeof prop?.number === "number" ? prop.number : null);
const checkbox = (prop) => (prop?.checkbox ? "TRUE" : "FALSE");
const url = (prop) => prop?.url || "";

// Icon is a native Notion page icon (page.icon.emoji), not a property —
// dropped as a rich_text property during the Phase 1 schema trim (2026-07-18)
// since it wasn't visible anywhere in the Notion UI as a property, only on
// the page itself. Page icon shows in every database view for free.
const pageIcon = (page) => (page.icon?.type === "emoji" ? page.icon.emoji : "");

// Sheet stored 7-decimal coordinate strings (e.g. "13.7811000"). Notion's
// Number type round-trips 13.7811000 → 13.7811 (trailing zeros dropped),
// so re-pad on export to keep the CSV visually familiar. The golden test
// (tests/notion-export-poc.test.mjs) compares parsed lat/lng numerically,
// not string-for-string, so this formatting choice isn't load-bearing.
export const fmtCoord = (n) => (n === null ? "" : n.toFixed(7));

export function pageToRow(page) {
  const p = page.properties;
  return [
    title(p["Name"]),
    text(p["Name ZH"]),
    text(p["Thai / Alt Name"]),
    url(p["Google Maps URL"]),
    select(p["Category"]),
    text(p["Notes EN"]),
    text(p["Notes ZH"]),
    text(p["Source URLs"]),
    multiSelect(p["Source Tags"]),
    select(p["Status"]),
    fmtCoord(number(p["Lat"])),
    fmtCoord(number(p["Lng"])),
    pageIcon(page),
    checkbox(p["Coordinates Approx"]),
    text(p["Slug"]),
  ];
}

// RFC 4180-ish CSV writer matching tokenizeCSV()'s escaping in src/csv-parser.js
export function csvField(v) {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}
export function csvRow(fields) {
  return fields.map(csvField).join(",");
}

async function main() {
  const apiKey = process.env.NOTION_API_KEY;
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;
  if (!apiKey || !dataSourceId) {
    throw new Error("Missing NOTION_API_KEY or NOTION_DATA_SOURCE_ID env var.");
  }

  const pages = await queryAllPages(dataSourceId, apiKey);
  const lines = [csvRow(CSV_HEADER)];
  for (const page of pages) {
    lines.push(csvRow(pageToRow(page)));
  }
  process.stdout.write(lines.join("\r\n") + "\r\n");
  console.error(`Exported ${pages.length} rows from data source ${dataSourceId}.`);
}

// Only run when executed directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
