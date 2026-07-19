// Phase 2 full-dataset acceptance test
// (docs/notion-migration-and-location-automation-plan.md §13).
//
// data/locations.csv is committed because it is the runtime snapshot. The
// frozen Google Sheet source is deliberately gitignored after migration, so
// the cross-source golden comparison runs when that local audit artifact is
// present and skips cleanly in a fresh checkout.
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

const STATUS_DOWNGRADES = new Set([
  'chag-emquartier',
  'franca-modern-italian-and-fine-steaks',
  'chin-bo-dang',
]);

test('Phase 2 snapshot uses the stable CSV contract and contains 98 unique rows', () => {
  assert.deepEqual(tokenizeCSV(snapshotCsv)[0], CSV_HEADER);
  assert.equal(snapshotRows.length, 98);
  assert.equal(new Set(snapshotRows.map((row) => row.id)).size, 98);
});

test('Phase 2 snapshot preserves the reviewed status and coordinate distributions', () => {
  const statusCounts = Object.fromEntries(
    ['Verified', 'Needs Review', 'Could Not Find'].map((status) => [
      status,
      snapshotRows.filter((row) => row.status === status).length,
    ])
  );

  assert.deepEqual(statusCounts, {
    Verified: 81,
    'Needs Review': 16,
    'Could Not Find': 1,
  });
  assert.equal(snapshotRows.filter((row) => row.approx === 'TRUE').length, 40);
});

test(
  'Phase 2 golden parse-equality: all 98 source rows survive the Notion round-trip',
  { skip: !existsSync(frozenSourcePath) && 'frozen migration source is intentionally gitignored' },
  () => {
    const sourceRows = parseCSV(readFileSync(frozenSourcePath, 'utf8'));
    const snapshotBySlug = new Map(snapshotRows.map((row) => [row.id, row]));
    const exactFields = [
      'nameEn', 'nameZh', 'alt', 'catEn', 'catZh', 'notesEn', 'notesZh',
      'icon', 'maps', 'approx', 'sourceUrl',
    ];

    assert.equal(sourceRows.length, 98);
    assert.equal(sourceRows.filter((row) => row.src === '___epoh___').length, 56);
    assert.deepEqual(
      sourceRows.map((row) => row.id).sort(),
      snapshotRows.map((row) => row.id).sort()
    );

    for (const source of sourceRows) {
      const snapshot = snapshotBySlug.get(source.id);
      assert.ok(snapshot, `missing Notion snapshot row for ${source.id}`);

      for (const field of exactFields) {
        assert.equal(snapshot[field], source[field], `${source.id}.${field} mismatch`);
      }

      assert.equal(Number(snapshot.lat), Number(source.lat), `${source.id}.lat mismatch`);
      assert.equal(Number(snapshot.lng), Number(source.lng), `${source.id}.lng mismatch`);

      const expectedStatus = STATUS_DOWNGRADES.has(source.id)
        ? 'Needs Review'
        : source.status;
      assert.equal(snapshot.status, expectedStatus, `${source.id}.status mismatch`);

      // Notion multi-select intentionally fixes the raw Threads handle,
      // removes duplicates, and does not promise source-tag display order.
      assert.deepEqual(
        normalizedTagSet(snapshot.src),
        normalizedTagSet(source.src),
        `${source.id}.src mismatch`
      );
    }
  }
);

function normalizedTagSet(value) {
  return [...new Set(
    value
      .split(' + ')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => tag === '___epoh___' ? 'Threads' : tag)
  )].sort();
}
