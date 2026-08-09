import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { csvRow } from '../scripts/export-snapshot.mjs';
import { validateFavoriteCompatibility } from '../scripts/validate-favorite-compatibility.mjs';
import { tokenizeCSV } from '../src/data/csv-parser.js';

const snapshotPath = fileURLToPath(new URL('../data/locations.csv', import.meta.url));
const manifestPath = fileURLToPath(
  new URL('../data/legacy-favorite-ids.json', import.meta.url)
);
const snapshotCsv = readFileSync(snapshotPath, 'utf8');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

test('Notion snapshot preserves every protected favorite ID', () => {
  const notionSlugCount = tokenizeCSV(snapshotCsv).length - 1;
  assert.deepEqual(validateFavoriteCompatibility(snapshotCsv, manifest), {
    legacyIdCount: manifest.ids.length,
    notionSlugCount,
    newSlugCount: notionSlugCount - manifest.ids.length,
  });
});

test('favorite compatibility rejects a renamed or removed legacy slug', () => {
  const changed = changeSlug(snapshotCsv, 'the-siam-hotel', 'the-siam-hotel-renamed');

  assert.throws(
    () => validateFavoriteCompatibility(changed, manifest),
    /missing legacy favorite IDs: the-siam-hotel/
  );
});

test('favorite compatibility rejects duplicate Notion slugs', () => {
  const changed = changeSlug(snapshotCsv, 'dear-december-cafe', 'the-siam-hotel');

  assert.throws(
    () => validateFavoriteCompatibility(changed, manifest),
    /duplicate Slugs: the-siam-hotel/
  );
});

test('favorite compatibility rejects an empty Notion slug', () => {
  const changed = changeSlug(snapshotCsv, 'the-siam-hotel', '');

  assert.throws(
    () => validateFavoriteCompatibility(changed, manifest),
    /contains an empty Slug/
  );
});

test('favorite compatibility allows new locations without weakening legacy IDs', () => {
  const rows = tokenizeCSV(snapshotCsv);
  const slugIndex = rows[0].indexOf('Slug');
  const extra = [...rows[1]];
  extra[slugIndex] = 'future-location';
  rows.push(extra);

  const result = validateFavoriteCompatibility(serialize(rows), manifest);
  const original = validateFavoriteCompatibility(snapshotCsv, manifest);

  assert.equal(result.legacyIdCount, original.legacyIdCount);
  assert.equal(result.notionSlugCount, original.notionSlugCount + 1);
  assert.equal(result.newSlugCount, original.newSlugCount + 1);
});

function changeSlug(csv, currentSlug, nextSlug) {
  const rows = tokenizeCSV(csv);
  const slugIndex = rows[0].indexOf('Slug');
  const row = rows.slice(1).find((candidate) => candidate[slugIndex] === currentSlug);
  assert.ok(row, `missing test fixture slug: ${currentSlug}`);
  row[slugIndex] = nextSlug;
  return serialize(rows);
}

function serialize(rows) {
  return rows.map((row) => csvRow(row)).join('\r\n');
}
