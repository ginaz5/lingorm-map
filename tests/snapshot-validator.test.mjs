import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { csvRow } from '../scripts/export-snapshot.mjs';
import {
  EXPECTED_LOCATION_COUNT,
  validateLocationSnapshot,
} from '../scripts/validate-location-snapshot.mjs';
import { tokenizeCSV } from '../src/csv-parser.js';

const snapshotPath = fileURLToPath(new URL('../data/locations.csv', import.meta.url));
const snapshotCsv = readFileSync(snapshotPath, 'utf8');
const snapshotRows = tokenizeCSV(snapshotCsv);

test('production snapshot validator accepts the committed 98-row snapshot', () => {
  assert.deepEqual(validateLocationSnapshot(snapshotCsv), {
    rowCount: EXPECTED_LOCATION_COUNT,
    uniqueSlugCount: EXPECTED_LOCATION_COUNT,
  });
});

test('production snapshot validator rejects a partial snapshot', () => {
  const partialCsv = [
    csvRow(snapshotRows[0]),
    csvRow(snapshotRows[1]),
  ].join('\r\n');

  assert.throws(
    () => validateLocationSnapshot(partialCsv),
    /must contain exactly 98 rows; found 1/
  );
});

test('production snapshot validator rejects duplicate slugs', () => {
  const duplicateCsv = [
    csvRow(snapshotRows[0]),
    csvRow(snapshotRows[1]),
    csvRow(snapshotRows[1]),
  ].join('\r\n');

  assert.throws(
    () => validateLocationSnapshot(duplicateCsv, 2),
    /contains duplicate Slug/
  );
});
