// Current formal-Notion snapshot acceptance tests. The frozen Google Sheet
// remains an immutable historical artifact; approved slug additions and
// replacements must be enumerated instead of weakening the reconciliation.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCSV, tokenizeCSV } from '../src/csv-parser.js';
import { CSV_HEADER } from '../scripts/export-snapshot.mjs';

const snapshotPath = fileURLToPath(new URL('../data/locations.csv', import.meta.url));
const frozenSourcePath = fileURLToPath(
  new URL('../data/migration/source-20260718.csv', import.meta.url)
);
const snapshotCsv = readFileSync(snapshotPath, 'utf8');
const snapshotRows = parseCSV(snapshotCsv);

const APPROVED_ADDED_SLUGS = [
  'cafe-madeleine-four-seasons-bangkok',
  'churn-buttery-lat-krabang',
  'kate-teaw-boat-noodles-siam-square-soi-3',
  'khlong-bang-luang-floating-market',
  'mok-ubon-ratchathani',
  'pata-plantation-original-tiwanon',
  'plantiful-sukhumvit-61',
];
const APPROVED_REMOVED_SLUGS = [
  'by',
];

test('formal snapshot uses the stable CSV contract and contains 104 unique rows', () => {
  assert.deepEqual(tokenizeCSV(snapshotCsv)[0], CSV_HEADER);
  assert.equal(snapshotRows.length, 104);
  assert.equal(new Set(snapshotRows.map((row) => row.id)).size, 104);
});

test('formal snapshot preserves the current publication status distribution', () => {
  const statusCounts = Object.fromEntries(
    ['Published', 'Inactive'].map((status) => [
      status,
      snapshotRows.filter((row) => row.status === status).length,
    ])
  );

  assert.deepEqual(statusCounts, {
    Published: 103,
    Inactive: 1,
  });
  assert.equal(snapshotRows.every((row) => row.approx === ''), true);
});

test('formal snapshot contains the two explicitly requested slug results', () => {
  const snapshotBySlug = new Map(snapshotRows.map((row) => [row.id, row]));

  assert.equal(
    snapshotBySlug.get('kate-teaw-boat-noodles-siam-square-soi-3')?.nameEn,
    'Kate Teaw Boat Noodles Siam Square Soi 3'
  );
  assert.equal(
    snapshotBySlug.get('plantiful-sukhumvit-61')?.nameEn,
    'PLANTIFUL on Sukhumvit 61'
  );
});

test(
  'formal snapshot has only the approved slug delta from the frozen source',
  { skip: !existsSync(frozenSourcePath) && 'frozen migration source is intentionally gitignored' },
  () => {
    const sourceRows = parseCSV(readFileSync(frozenSourcePath, 'utf8'));
    const sourceSlugs = new Set(sourceRows.map((row) => row.id));
    const snapshotSlugs = new Set(snapshotRows.map((row) => row.id));
    const added = [...snapshotSlugs]
      .filter((slug) => !sourceSlugs.has(slug))
      .sort();
    const removed = [...sourceSlugs]
      .filter((slug) => !snapshotSlugs.has(slug))
      .sort();

    assert.equal(sourceRows.length, 98);
    assert.equal(sourceRows.filter((row) => row.src === '___epoh___').length, 56);
    assert.deepEqual(added, APPROVED_ADDED_SLUGS);
    assert.deepEqual(removed, APPROVED_REMOVED_SLUGS);
  }
);
