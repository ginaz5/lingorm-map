// Phase 1 PoC golden test (docs/notion-migration-and-location-automation-plan.md §13).
//
// Proves the two riskiest links before any further migration work:
//   1. Notion round-trip fidelity for CJK / Thai / emoji / multi-line rich text
//      (tests/fixtures/notion-poc/exported-10rows.csv was captured from the
//      actual Notion API response after creating 10 pages — see the "Locations
//      (PoC)" database under the LingOrm Map workspace's Home page).
//   2. That parseCSV() — the function the live frontend already uses — parses
//      the exported snapshot identically to the original sheet source, except
//      for a small number of *intentional* cleanings applied during migration
//      (category alias normalization, ___epoh___ tag-drift cleanup — see
//      plan §4 "Data-quality debts" and §10.3 "Cleaning pass").
//
// NOTE: this compares two static CSV fixtures, not a live Notion API call —
// scripts/export-snapshot.mjs needs a real NOTION_API_KEY (a Notion internal
// integration token, not the Cowork connector used to create these rows) to
// run for real against the live database. Re-run this test with a freshly
// generated exported-10rows.csv (via `node scripts/export-snapshot.mjs`)
// once that integration token exists, to confirm the *script* — not just the
// manually-verified data — reproduces the same result.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { parseCSV } from '../src/csv-parser.js';
import {
  convertNotionCsv,
  normalizeNotionExportText,
} from '../scripts/convert-notion-csv.mjs';
import { CSV_HEADER, csvRow, pageToRow } from '../scripts/export-snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'notion-poc');

const sourceCSV = readFileSync(path.join(fixtureDir, 'source-10rows.csv'), 'utf8');
const exportedCSV = readFileSync(path.join(fixtureDir, 'exported-10rows.csv'), 'utf8');

const sourceRows = parseCSV(sourceCSV);
const exportedRows = parseCSV(exportedCSV);

// Rows whose Source Tags were intentionally cleaned during migration:
// the sheet stored a Threads handle ("___epoh___") as a tag instead of a
// platform label (plan §4 issue 3). Notion's Source Tags is a multi_select
// with a fixed option set, so create-pages rejected the raw handle — the
// import mapped it to "Threads" instead, which is the correct fix, not a bug.
const INTENTIONAL_TAG_CLEANUPS = new Set(['yoru-omakase', 'somtam-nua', 'g-i-y-ang-r-b-iap-grilled-chicken-and-som-tum']);

test('Phase 1 PoC: row counts match', () => {
  assert.equal(sourceRows.length, 10);
  assert.equal(exportedRows.length, 10);
});

test('Phase 1 PoC: every source row has a matching exported row by id (slug)', () => {
  const sourceIds = sourceRows.map(r => r.id).sort();
  const exportedIds = exportedRows.map(r => r.id).sort();
  assert.deepEqual(exportedIds, sourceIds);
});

test('Phase 1 PoC: golden parse-equality (source vs. Notion round-trip)', () => {
  const bySlug = Object.fromEntries(exportedRows.map(r => [r.id, r]));

  for (const src of sourceRows) {
    const exp = bySlug[src.id];
    assert.ok(exp, `missing exported row for ${src.id}`);

    // Fields that must round-trip byte-for-byte through Notion, including
    // CJK, Thai script, emoji, and embedded literal newlines (R Bar).
    for (const field of ['nameEn', 'nameZh', 'alt', 'catEn', 'catZh', 'notesEn', 'notesZh', 'icon', 'status', 'approx']) {
      assert.equal(exp[field], src[field], `${src.id}.${field} mismatch`);
    }

    // Lat/lng: sheet stored 7-decimal strings ("13.7811000"); Notion's Number
    // type drops trailing zeros on storage. Compare numerically, not
    // string-for-string, per plan §13 Phase 1 acceptance criteria.
    assert.equal(parseFloat(exp.lat), parseFloat(src.lat), `${src.id}.lat mismatch`);
    assert.equal(parseFloat(exp.lng), parseFloat(src.lng), `${src.id}.lng mismatch`);

    if (INTENTIONAL_TAG_CLEANUPS.has(src.id)) {
      // Document the cleanup rather than silently passing: source still has
      // the raw drift, export has the corrected tag.
      assert.equal(src.src, '___epoh___', `${src.id}: expected raw source to still show tag drift`);
      assert.equal(exp.src, 'Threads', `${src.id}: expected cleaned tag in export`);
    } else {
      assert.equal(exp.src, src.src, `${src.id}.src mismatch`);
    }
  }
});

test('Phase 1 PoC: Could Not Find status survives round-trip (Yoru Omakase)', () => {
  const row = exportedRows.find(r => r.id === 'yoru-omakase');
  assert.equal(row.status, 'Could Not Find');
});

test('Phase 1 PoC: category alias normalization applied identically on both sides (R Bar: "Bar" -> "Bar / Rooftop Club")', () => {
  const src = sourceRows.find(r => r.id === 'r-bar');
  const exp = exportedRows.find(r => r.id === 'r-bar');
  assert.equal(src.catEn, 'Bar / Rooftop Club');
  assert.equal(exp.catEn, 'Bar / Rooftop Club');
});

test('snapshot exporter maps native page icon and frozen Slug without credentials', () => {
  const richText = (plainText) => ({ rich_text: [{ plain_text: plainText }] });
  const page = {
    icon: { type: 'emoji', emoji: '🏨' },
    properties: {
      Name: { title: [{ plain_text: 'The Siam Hotel' }] },
      'Name ZH': richText('暹羅精品酒店'),
      'Thai / Alt Name': richText(''),
      'Google Maps URL': { url: 'https://maps.example/the-siam' },
      Category: { select: { name: 'Hotel' } },
      'Notes EN': richText('Luxury hotel'),
      'Notes ZH': richText('河畔精品酒店'),
      'Source URLs': richText('https://example.com'),
      'Source Tags': { multi_select: [{ name: 'KKday' }] },
      Status: { select: { name: 'Verified' } },
      Lat: { number: 13.7608 },
      Lng: { number: 100.5089 },
      'Coordinates Approx': { checkbox: false },
      Slug: richText('the-siam-hotel'),
    },
  };

  const row = pageToRow(page);
  assert.equal(row.length, CSV_HEADER.length);
  assert.equal(CSV_HEADER.includes('Duplicate Group'), false);
  assert.equal(row[12], '🏨');
  assert.equal(row[14], 'the-siam-hotel');
});

test('snapshot exporter escapes quotes and commas in CSV output', () => {
  assert.equal(csvRow(['a,b', 'say "hello"']), '"a,b","say ""hello"""');
});

test('manual Notion CSV export bridge emits the stable snapshot contract', () => {
  const notionCsv = [
    'Name,Name ZH,Thai / Alt Name,Google Maps URL,Category,Notes EN,Notes ZH,Source URLs,Source Tags,Status,Lat,Lng,Coordinates Approx,Slug',
    'The Siam Hotel,暹羅精品酒店,,https://maps.example/the-siam,Hotel,Luxury hotel,河畔精品酒店,https://example.com,KKday,Verified,13.7608,100.5089,No,the-siam-hotel',
  ].join('\n');
  const iconCsv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH',
    'The Siam Hotel,,https://maps.example/the-siam,Hotel,Luxury hotel,https://example.com,KKday,Verified,13.7608,100.5089,🏨,FALSE,暹羅精品酒店,河畔精品酒店',
  ].join('\n');

  const [row] = parseCSV(convertNotionCsv(notionCsv, iconCsv));
  assert.deepEqual(row, parseCSV(iconCsv)[0]);
  assert.equal(row.id, 'the-siam-hotel');
});

test('manual Notion CSV export bridge rejects duplicate slugs', () => {
  const notionCsv = [
    'Name,Name ZH,Thai / Alt Name,Google Maps URL,Category,Notes EN,Notes ZH,Source URLs,Source Tags,Status,Lat,Lng,Coordinates Approx,Slug',
    'The Siam Hotel,暹羅精品酒店,,https://maps.example/the-siam,Hotel,Luxury hotel,河畔精品酒店,https://example.com,KKday,Verified,13.7608,100.5089,No,the-siam-hotel',
    'Renamed Hotel,暹羅精品酒店,,https://maps.example/the-siam,Hotel,Luxury hotel,河畔精品酒店,https://example.com,KKday,Verified,13.7608,100.5089,No,the-siam-hotel',
  ].join('\n');

  assert.throws(
    () => convertNotionCsv(notionCsv, sourceCSV),
    /Duplicate Slug in Notion CSV: the-siam-hotel/
  );
});

test('manual Notion CSV export bridge rejects missing expected slugs', () => {
  const notionCsv = [
    'Name,Name ZH,Thai / Alt Name,Google Maps URL,Category,Notes EN,Notes ZH,Source URLs,Source Tags,Status,Lat,Lng,Coordinates Approx,Slug',
    'Alpha Cafe,Alpha Cafe,,,Cafe,,,,,Verified,13.75,100.5,No,alpha-cafe',
  ].join('\n');
  const iconCsv = [
    'Location Name,Thai / Alt Name,Category,Notes,Source URL,Verification Status,Icon',
    'Alpha Cafe,,Cafe,,,Verified,☕',
    'Beta Cafe,,Cafe,,,Verified,☕',
  ].join('\n');

  assert.throws(
    () => convertNotionCsv(notionCsv, iconCsv),
    /Notion CSV is missing 1 expected Slug\(s\): beta-cafe/
  );
});

test('manual Notion CSV export bridge removes deterministic rich-text link artifacts', () => {
  assert.equal(
    normalizeNotionExportText(
      'Trip.com note\nRef:https://http://www.threads.com/@example/post/123'
    ),
    'Trip.com note\nRef:https://www.threads.com/@example/post/123'
  );
});

test('manual Notion CSV export bridge is importable without a script argv entry', () => {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '..', 'scripts', 'convert-notion-csv.mjs')
  ).href;
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `await import(${JSON.stringify(moduleUrl)})`,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
});
