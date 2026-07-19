#!/usr/bin/env node
// Converts Notion's UI "Markdown & CSV" database export into the stable
// snapshot contract emitted by export-snapshot.mjs.
//
// This is a manual-export bridge for environments where the Notion connector
// can read the database but cannot issue bulk queries and no NOTION_API_KEY is
// available. Production/automated exports should keep using
// scripts/export-snapshot.mjs.
//
// Notion's UI export omits native page icons. During the migration window,
// supply the frozen source CSV so icons can be joined by the immutable Slug:
//
//   node scripts/convert-notion-csv.mjs notion-export.csv \
//     --icons-from data/migration/source-20260718.csv > data/locations.csv

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { parseCSV, tokenizeCSV } from '../src/csv-parser.js';
import { CSV_HEADER, csvRow } from './export-snapshot.mjs';

const REQUIRED_NOTION_HEADERS = [
  'Name', 'Name ZH', 'Thai / Alt Name', 'Google Maps URL', 'Category',
  'Notes EN', 'Notes ZH', 'Source URLs', 'Source Tags', 'Status',
  'Lat', 'Lng', 'Coordinates Approx', 'Slug',
];

export function convertNotionCsv(notionCsv, iconsCsv) {
  const notionRows = tokenizeCSV(notionCsv);
  if (notionRows.length < 2) {
    throw new Error('Notion CSV must contain a header and at least one row.');
  }

  const headers = notionRows[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const missingHeaders = REQUIRED_NOTION_HEADERS.filter((header) => index[header] === undefined);
  if (missingHeaders.length) {
    throw new Error(`Notion CSV is missing required columns: ${missingHeaders.join(', ')}`);
  }

  const iconRows = parseCSV(iconsCsv);
  if (!iconRows) {
    throw new Error('Icon source must use the published location CSV format.');
  }
  const iconsBySlug = new Map(iconRows.map((row) => [row.id, row.icon]));

  const seenSlugs = new Set();
  const output = [csvRow(CSV_HEADER)];
  for (const row of notionRows.slice(1)) {
    if (!row.join('').trim()) continue;
    const read = (header) => (row[index[header]] || '').trim();
    const slug = read('Slug');
    if (!slug) throw new Error(`Notion row "${read('Name')}" has no Slug.`);
    if (seenSlugs.has(slug)) throw new Error(`Duplicate Slug in Notion CSV: ${slug}`);
    seenSlugs.add(slug);

    const icon = iconsBySlug.get(slug);
    if (!icon) throw new Error(`No preserved icon found for Slug: ${slug}`);

    output.push(csvRow([
      read('Name'),
      read('Name ZH'),
      read('Thai / Alt Name'),
      read('Google Maps URL'),
      read('Category'),
      normalizeNotionExportText(read('Notes EN')),
      normalizeNotionExportText(read('Notes ZH')),
      read('Source URLs'),
      read('Source Tags'),
      read('Status'),
      read('Lat'),
      read('Lng'),
      icon,
      normalizeCheckbox(read('Coordinates Approx')),
      slug,
    ]));
  }

  const missingSlugs = [...iconsBySlug.keys()].filter((slug) => !seenSlugs.has(slug));
  if (missingSlugs.length) {
    throw new Error(
      `Notion CSV is missing ${missingSlugs.length} expected Slug(s): ${missingSlugs.join(', ')}`
    );
  }

  return `${output.join('\r\n')}\r\n`;
}

function normalizeCheckbox(value) {
  return /^(?:yes|true|1|checked)$/i.test(value) ? 'TRUE' : 'FALSE';
}

// Notion's Markdown & CSV exporter serializes auto-linked rich text using the
// link target instead of the visible plain text. The database values remain
// correct (and the API exporter returns them correctly), so undo only the two
// deterministic artifacts observed in Notes fields.
export function normalizeNotionExportText(value) {
  return value
    .replaceAll('https://http://', 'https://')
    .replaceAll('http://Trip.com', 'Trip.com');
}

function main() {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  const iconsFlag = args.indexOf('--icons-from');
  const iconsPath = iconsFlag >= 0 ? args[iconsFlag + 1] : '';
  if (!inputPath || !iconsPath) {
    throw new Error('Usage: node scripts/convert-notion-csv.mjs <notion.csv> --icons-from <published.csv>');
  }

  process.stdout.write(convertNotionCsv(
    readFileSync(inputPath, 'utf8'),
    readFileSync(iconsPath, 'utf8'),
  ));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
