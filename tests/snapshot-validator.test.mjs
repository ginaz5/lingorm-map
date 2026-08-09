import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CSV_HEADER, csvRow } from '../scripts/export-snapshot.mjs';
import {
  validateLocationSnapshot,
} from '../scripts/validate-location-snapshot.mjs';
import { tokenizeCSV } from '../src/data/csv-parser.js';

const snapshotPath = fileURLToPath(new URL('../data/locations.csv', import.meta.url));
const snapshotCsv = readFileSync(snapshotPath, 'utf8');
const snapshotRows = tokenizeCSV(snapshotCsv);

test('production snapshot validator accepts the committed snapshot under the current policy', () => {
  const result = validateLocationSnapshot(snapshotCsv);
  const dataRowCount = snapshotRows.length - 1;

  assert.equal(result.policyId, 'three-status-20260721');
  assert.equal(result.rowCount, dataRowCount);
  assert.equal(result.uniqueSlugCount, dataRowCount);
  assert.equal(result.publicRowCount, result.statusCounts.Published ?? 0);
  assert.equal(
    Object.values(result.statusCounts).reduce((total, count) => total + count, 0),
    dataRowCount
  );
});

test('production snapshot validator rejects a partial snapshot', () => {
  const partialCsv = [
    csvRow(snapshotRows[0]),
    csvRow(snapshotRows[1]),
  ].join('\r\n');

  assert.throws(
    () => validateLocationSnapshot(partialCsv),
    /must contain at least 98 rows; found 1/
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

function changedRow(sourceRow, changes) {
  const row = [...sourceRow];
  const headers = snapshotRows[0];
  for (const [header, value] of Object.entries(changes)) {
    row[headers.indexOf(header)] = value;
  }
  return row;
}

test('production snapshot validator accepts additions while protecting the baseline Slugs', () => {
  const added = changedRow(snapshotRows[1], {
    'Location Name': 'New Location',
    'Verification Status': 'Paused',
    Slug: 'new-location',
  });
  const expandedCsv = [
    ...snapshotRows.map(csvRow),
    csvRow(added),
  ].join('\r\n');

  const result = validateLocationSnapshot(expandedCsv);
  const expectedRowCount = snapshotRows.length;
  assert.equal(result.rowCount, expectedRowCount);
  assert.equal(result.uniqueSlugCount, expectedRowCount);
});

test('production snapshot validator rejects replacement additions when a protected Slug disappears', () => {
  const replacement = changedRow(snapshotRows[1], {
    'Location Name': 'Replacement Location',
    Slug: 'replacement-location',
  });
  const changedCsv = [
    csvRow(snapshotRows[0]),
    csvRow(replacement),
    ...snapshotRows.slice(2).map(csvRow),
  ].join('\r\n');

  assert.throws(
    () => validateLocationSnapshot(changedCsv),
    /is missing protected Slugs/
  );
});

test('production snapshot validator rejects unknown raw statuses before parser fallback', () => {
  const invalid = changedRow(snapshotRows[1], {
    'Verification Status': 'Publishd',
  });
  const changedCsv = [
    csvRow(snapshotRows[0]),
    csvRow(invalid),
    ...snapshotRows.slice(2).map(csvRow),
  ].join('\r\n');

  assert.throws(
    () => validateLocationSnapshot(changedCsv),
    /unsupported raw status: Publishd/
  );
});

test('production snapshot validator rejects retired statuses', () => {
  for (const status of ['Draft', 'Verified', 'Needs Review', 'Closed']) {
    const invalid = changedRow(snapshotRows[1], {
      'Verification Status': status,
    });
    const changedCsv = [
      csvRow(snapshotRows[0]),
      csvRow(invalid),
      ...snapshotRows.slice(2).map(csvRow),
    ].join('\r\n');

    assert.throws(
      () => validateLocationSnapshot(changedCsv),
      new RegExp(`unsupported raw status: ${status}`)
    );
  }
});

test('production snapshot validator counts only Published fixture rows as public', () => {
  const fixtureCsv = [
    CSV_HEADER,
    snapshotFixtureRow('published-fixture', 'Published'),
    snapshotFixtureRow('paused-fixture', 'Paused'),
    snapshotFixtureRow('inactive-fixture', 'Inactive'),
  ].map(csvRow).join('\r\n');

  assert.deepEqual(validateLocationSnapshot(fixtureCsv, 3), {
    policyId: 'legacy-exact-count',
    rowCount: 3,
    uniqueSlugCount: 3,
    publicRowCount: 1,
    statusCounts: {
      Published: 1,
      Paused: 1,
      Inactive: 1,
    },
  });
});

function snapshotFixtureRow(slug, status) {
  const values = {
    'Location Name': slug,
    'Google Maps URL': `https://maps.google.com/?q=${slug}`,
    Category: 'Cafe',
    'Verification Status': status,
    Lat: '13.7',
    Lng: '100.5',
    Icon: '☕',
    'Country Code': 'TH',
    'Destination Key': 'bangkok',
    Type: 'LingOrm',
    Slug: slug,
  };
  return CSV_HEADER.map((header) => values[header] ?? '');
}

test('production snapshot validator requires geography for Published rows', () => {
  const missingGeography = changedRow(snapshotRows[1], {
    'Country Code': '',
    'Destination Key': '',
  });
  const changedCsv = [
    csvRow(snapshotRows[0]),
    csvRow(missingGeography),
    ...snapshotRows.slice(2).map(csvRow),
  ].join('\r\n');

  assert.throws(
    () => validateLocationSnapshot(changedCsv),
    /requires Country Code and Destination Key/
  );
});

test('production snapshot validator rejects mismatched country and destination', () => {
  const mismatched = changedRow(snapshotRows[1], {
    'Country Code': 'VN',
    'Destination Key': 'bangkok',
  });
  const changedCsv = [
    csvRow(snapshotRows[0]),
    csvRow(mismatched),
    ...snapshotRows.slice(2).map(csvRow),
  ].join('\r\n');

  assert.throws(
    () => validateLocationSnapshot(changedCsv),
    /mismatched Country Code and Destination Key/
  );
});

test('production snapshot validator accepts TW, HK, and MO geography pairs', () => {
  const pairs = [
    ['TW', 'taipei'],
    ['HK', 'hong-kong'],
    ['MO', 'macau'],
  ];

  for (const [countryCode, destinationKey] of pairs) {
    const changed = changedRow(snapshotRows[1], {
      'Country Code': countryCode,
      'Destination Key': destinationKey,
    });
    const changedCsv = [
      csvRow(snapshotRows[0]),
      csvRow(changed),
      ...snapshotRows.slice(2).map(csvRow),
    ].join('\r\n');
    assert.doesNotThrow(() => validateLocationSnapshot(changedCsv));
  }
});

test('production snapshot validator permits blank Type and rejects unsupported values', () => {
  const blank = changedRow(snapshotRows[1], { Type: '' });
  const blankCsv = [
    csvRow(snapshotRows[0]),
    csvRow(blank),
    ...snapshotRows.slice(2).map(csvRow),
  ].join('\r\n');
  assert.doesNotThrow(() => validateLocationSnapshot(blankCsv));

  const unsupported = changedRow(snapshotRows[1], { Type: 'Bookmark' });
  const unsupportedCsv = [
    csvRow(snapshotRows[0]),
    csvRow(unsupported),
    ...snapshotRows.slice(2).map(csvRow),
  ].join('\r\n');
  assert.throws(
    () => validateLocationSnapshot(unsupportedCsv),
    /unsupported Type: Bookmark/
  );
});

test('production snapshot validator requires navigation-safe Published rows', () => {
  const publishedWithoutCoordinates = changedRow(snapshotRows[1], {
    'Verification Status': 'Published',
    Lat: '',
    Lng: '',
  });
  const missingCoordinatesCsv = [
    csvRow(snapshotRows[0]),
    csvRow(publishedWithoutCoordinates),
    ...snapshotRows.slice(2).map(csvRow),
  ].join('\r\n');
  assert.throws(
    () => validateLocationSnapshot(missingCoordinatesCsv),
    /Published location snapshot row 2 requires Lat and Lng/
  );

  const publishedWithoutMaps = changedRow(snapshotRows[1], {
    'Verification Status': 'Published',
    'Google Maps URL': 'https://example.com/not-maps',
  });
  const missingMapsCsv = [
    csvRow(snapshotRows[0]),
    csvRow(publishedWithoutMaps),
    ...snapshotRows.slice(2).map(csvRow),
  ].join('\r\n');
  assert.throws(
    () => validateLocationSnapshot(missingMapsCsv),
    /requires a valid Google Maps URL/
  );

  for (const unrelatedGoogleUrl of [
    'https://drive.google.com/file/d/not-a-map',
    'https://mail.google.com/mail/u/0/',
    'https://www.google.com/',
  ]) {
    const unrelatedGoogle = changedRow(snapshotRows[1], {
      'Google Maps URL': unrelatedGoogleUrl,
    });
    const unrelatedGoogleCsv = [
      csvRow(snapshotRows[0]),
      csvRow(unrelatedGoogle),
      ...snapshotRows.slice(2).map(csvRow),
    ].join('\r\n');
    assert.throws(
      () => validateLocationSnapshot(unrelatedGoogleCsv),
      /requires a valid Google Maps URL/
    );
  }
});

test('production snapshot validator rejects rows outside the 17-field contract', () => {
  const invalidCsv = [
    csvRow(snapshotRows[0]),
    csvRow([...snapshotRows[1], 'unexpected']),
  ].join('\r\n');
  assert.throws(
    () => validateLocationSnapshot(invalidCsv, 1),
    /row 2 has 18 fields; expected 17/
  );
});

test('production snapshot validator rejects out-of-range coordinates for every status', () => {
  const invalid = changedRow(snapshotRows[1], { Lat: '91' });
  const changedCsv = [
    csvRow(snapshotRows[0]),
    csvRow(invalid),
    ...snapshotRows.slice(2).map(csvRow),
  ].join('\r\n');

  assert.throws(
    () => validateLocationSnapshot(changedCsv),
    /has invalid coordinates/
  );
});
