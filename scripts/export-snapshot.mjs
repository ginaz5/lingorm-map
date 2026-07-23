#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// export-snapshot.mjs
//
// Phase 1/2 (docs/archive/notion-migration-and-location-automation-plan.md
// §6.3, §9.1, §13): reads the Notion "Locations" data source and
// emits the public location fields that parsePublishedFormat()
// in src/data/csv-parser.js understands. Verification-only properties and retired
// formal properties are deliberately excluded.
// The frontend parser is header-based and ignores unknown columns.
//
// Usage:
//   node --env-file-if-exists=.env scripts/export-snapshot.mjs \
//     --output data/locations.next.csv
//
// Requires an internal Notion integration (create one at
// notion.so/my-integrations) with read access to the Locations data
// source — share it from the database's "..." menu → Connections.
// This is separate from any Cowork/Claude Notion connector.
// ═══════════════════════════════════════════════════

import { writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { FORMAL_DATA_SOURCE_ID } from "./location-verification-core.mjs";
import {
  CURRENT_FORMAL_LOCATION_PROPERTIES,
  inspectCurrentFormalLocationProperties,
} from "./formal-location-current-schema.mjs";

const NOTION_VERSION = "2025-09-03"; // plan §5.1 — pin the version; databases/data sources split here

export const CSV_HEADER = [
  "Location Name", "Location Name ZH", "Thai / Alt Name", "Google Maps URL",
  "Category", "Notes", "Notes ZH", "Source URL", "Source Tags",
  "Verification Status", "Lat", "Lng", "Icon",
  "Country Code", "Destination Key",
  "Slug", // Slug is the stable public ID; parseCSV() prefers it over slugify(name).
];

function notionHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "content-type": "application/json",
  };
}

export async function fetchDataSource(dataSourceId, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(
    `https://api.notion.com/v1/data_sources/${dataSourceId}`,
    { headers: notionHeaders(apiKey) }
  );
  if (!res.ok) {
    throw new Error(`Notion data source fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function queryAllPages(
  dataSourceId,
  apiKey,
  fetchImpl = fetch
) {
  const pages = [];
  let cursor;
  do {
    const res = await fetchImpl(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: notionHeaders(apiKey),
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
    select(p["Country Code"]),
    select(p["Destination Key"]),
    text(p["Slug"]),
  ];
}

// RFC 4180-ish CSV writer matching tokenizeCSV()'s escaping in src/data/csv-parser.js
export function csvField(v) {
  // Notion rich text can contain invisible spaces immediately before a
  // newline. They have no display meaning but make the committed snapshot
  // fail git's trailing-whitespace check.
  const s = String(v ?? "").replace(/[ \t]+(?=\r?\n)/g, "");
  return `"${s.replace(/"/g, '""')}"`;
}
export function csvRow(fields) {
  return fields.map(csvField).join(",");
}

export function assertCurrentFormalSchema(dataSource) {
  const schema = inspectCurrentFormalLocationProperties(dataSource?.properties);
  if (!schema.ok) {
    const parts = [];
    if (schema.missing.length > 0) {
      parts.push(`missing: ${schema.missing.join(", ")}`);
    }
    if (schema.unexpected.length > 0) {
      parts.push(`unexpected: ${schema.unexpected.join(", ")}`);
    }
    if (schema.wrongTypes.length > 0) {
      parts.push(
        `wrong types: ${schema.wrongTypes
          .map(({ field, expected, actual }) => `${field} (${actual}; expected ${expected})`)
          .join(", ")}`
      );
    }
    if (schema.statusOptions.checked && !schema.statusOptions.ok) {
      const statusProblems = [
        schema.statusOptions.missing.length > 0
          ? `missing ${schema.statusOptions.missing.join(", ")}`
          : "",
        schema.statusOptions.unexpected.length > 0
          ? `unexpected ${schema.statusOptions.unexpected.join(", ")}`
          : "",
        schema.statusOptions.wrongColors.length > 0
          ? `wrong colors ${schema.statusOptions.wrongColors
              .map(({ name, actual, expected }) =>
                `${name} (${actual}; expected ${expected})`
              )
              .join(", ")}`
          : "",
      ].filter(Boolean);
      parts.push(`Status options: ${statusProblems.join("; ")}`);
    }
    throw new Error(`Notion Locations schema is incompatible (${parts.join("; ")}).`);
  }
  return {
    propertyCount: Object.keys(dataSource.properties || {}).length,
    requiredPropertyCount: CURRENT_FORMAL_LOCATION_PROPERTIES.length,
  };
}

export async function exportSnapshot({
  apiKey,
  dataSourceId = FORMAL_DATA_SOURCE_ID,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    throw new Error("Missing NOTION_API_KEY.");
  }
  if (dataSourceId !== FORMAL_DATA_SOURCE_ID) {
    throw new Error(
      `Refusing snapshot export from non-formal data source ${dataSourceId}.`
    );
  }

  const dataSource = await fetchDataSource(dataSourceId, apiKey, fetchImpl);
  const schema = assertCurrentFormalSchema(dataSource);
  const pages = await queryAllPages(dataSourceId, apiKey, fetchImpl);
  const rows = pages.map(pageToRow);
  const nameIndex = CSV_HEADER.indexOf("Location Name");
  const slugIndex = CSV_HEADER.indexOf("Slug");
  const seenSlugs = new Set();
  for (const row of rows) {
    const name = String(row[nameIndex] || "").trim() || "(untitled)";
    const slug = String(row[slugIndex] || "").trim();
    if (!slug) {
      throw new Error(`Notion location "${name}" has no Slug.`);
    }
    if (seenSlugs.has(slug)) {
      throw new Error(`Notion Locations contains duplicate Slug: ${slug}.`);
    }
    seenSlugs.add(slug);
  }
  rows.sort((left, right) =>
    String(left[slugIndex]).localeCompare(
      String(right[slugIndex]),
      "en"
    )
  );
  return {
    csv: `${[csvRow(CSV_HEADER), ...rows.map(csvRow)].join("\n")}\n`,
    pageCount: pages.length,
    schema,
  };
}

function parseCliArgs(argv) {
  let outputPath = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      outputPath = argv[index + 1] || "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown export argument: ${arg}`);
  }
  return { outputPath };
}

async function writeAtomic(outputPath, csv) {
  const destination = resolve(outputPath);
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, csv, "utf8");
  await rename(temporary, destination);
}

async function main() {
  const { outputPath } = parseCliArgs(process.argv.slice(2));
  const apiKey = process.env.NOTION_API_KEY;
  const dataSourceId =
    process.env.NOTION_FORMAL_DATA_SOURCE_ID || FORMAL_DATA_SOURCE_ID;
  const result = await exportSnapshot({ apiKey, dataSourceId });
  if (outputPath) {
    await writeAtomic(outputPath, result.csv);
  } else {
    process.stdout.write(result.csv);
  }
  console.error(
    `Exported ${result.pageCount} rows from formal data source ${dataSourceId}; ` +
    `schema ${result.schema.requiredPropertyCount}/${result.schema.propertyCount}.`
  );
}

// Only run when executed directly (not when imported by tests)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
