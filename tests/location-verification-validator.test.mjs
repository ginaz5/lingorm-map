import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CSV_HEADER,
  csvRow,
} from '../scripts/export-snapshot.mjs';
import {
  reconcileSnapshotCsv,
  validateTargetRows,
} from '../scripts/location-verification-validator.mjs';

function policy({
  minimumRowCount = 1,
  protectedSlugs = [],
  deletionManifest = [],
} = {}) {
  return {
    policyId: 'test-policy',
    minimumRowCount,
    protectedSlugs,
    deletionManifest,
  };
}

function currentRow(slug, status = 'Paused') {
  const published = status === 'Published';
  const inactive = status === 'Inactive';
  return {
    Category: 'Cafe',
    'Country Code': 'TH',
    'Destination Key': 'bangkok',
    'Google Maps URL': `https://www.google.com/maps/search/?api=1&query=${slug}`,
    'Google Place ID': `place-${slug}`,
    Lat: 13.7,
    Lng: 100.5,
    Name: `${slug} name`,
    'Name ZH': '',
    'Notes EN': '',
    'Notes ZH': '',
    Slug: slug,
    'Source Tags': ['Threads'],
    'Source URLs': 'https://source.example/item',
    Status: status,
    'Thai / Alt Name': '',
    Type: 'LingOrm',
    'Review Needed': published || inactive ? '__NO__' : '__YES__',
    'Verification Note':
      inactive ? '' : status === 'Paused' ? 'Pending review' : '',
    'Last Verified':
      published || inactive ? '2026-07-29T10:00:00.000Z' : '',
  };
}

function validate(rows, options = {}) {
  return validateTargetRows(rows, {
    snapshotPolicy: policy({
      minimumRowCount: rows.length || 1,
      ...options,
    }),
  });
}

function snapshotCsv(rows) {
  return `${[
    csvRow(CSV_HEADER),
    ...rows.map((row) => csvRow(row)),
  ].join('\n')}\n`;
}

function snapshotRow({
  slug,
  status = 'Published',
  name = `${slug} name`,
}) {
  return [
    name,
    '',
    '',
    `https://www.google.com/maps/search/?api=1&query=${slug}`,
    'Cafe',
    '',
    '',
    '',
    'Threads',
    status,
    '13.7000000',
    '100.5000000',
    '☕',
    'TH',
    'bangkok',
    'LingOrm',
    slug,
  ];
}

test('current 20-property rows validate without retired workflow fields', () => {
  const rows = [
    currentRow('published', 'Published'),
    currentRow('paused', 'Paused'),
    currentRow('inactive', 'Inactive'),
  ];
  const result = validate(rows);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.statusCounts, {
    Published: 1,
    Paused: 1,
    Inactive: 1,
  });
});

test('Review Needed without Verification Note is a non-blocking warning', () => {
  const row = {
    ...currentRow('review-note', 'Published'),
    'Review Needed': '__YES__',
    'Verification Note': '',
  };
  const result = validate([row]);
  assert.deepEqual(result.issues, []);
  assert.equal(
    result.warnings.some(({ code }) => code === 'REVIEW_NOTE_MISSING'),
    true
  );

  row['Review Needed'] = '__NO__';
  const completed = validate([row]);
  assert.equal(
    completed.warnings.some(({ code }) => code === 'REVIEW_NOTE_MISSING'),
    false
  );

  const paused = {
    ...currentRow('paused-review-note', 'Paused'),
    'Verification Note': '',
  };
  const pausedResult = validate([paused]);
  assert.deepEqual(pausedResult.issues, []);
  assert.equal(
    pausedResult.warnings.some(({ code }) => code === 'REVIEW_NOTE_MISSING'),
    true
  );

  const inactive = currentRow('inactive-without-note', 'Inactive');
  const inactiveResult = validate([inactive]);
  assert.deepEqual(inactiveResult.issues, []);
  assert.deepEqual(inactiveResult.warnings, []);
});

test('blank Type is a warning while unsupported Type remains an issue', () => {
  const row = currentRow('type-check');
  row.Type = '';
  let result = validate([row]);
  assert.equal(
    result.warnings.some(({ code }) => code === 'TYPE_MISSING'),
    true
  );
  assert.equal(result.issues.length, 0);

  row.Type = 'Bookmark';
  result = validate([row]);
  assert.equal(
    result.issues.some(({ code }) => code === 'TYPE_INVALID'),
    true
  );
});

test('live validation enforces geography pairing and a Google Maps URL', () => {
  const row = currentRow('geography', 'Published');
  row['Destination Key'] = 'taipei';
  row['Google Maps URL'] = 'https://example.com/not-google-maps';
  let result = validate([row]);
  const codes = new Set(result.issues.map(({ code }) => code));
  assert.equal(codes.has('GEOGRAPHY_PAIR_MISMATCH'), true);
  assert.equal(codes.has('PUBLISHED_MAP_URL_INVALID'), true);

  row['Country Code'] = '';
  row['Destination Key'] = '';
  result = validate([row]);
  assert.equal(
    result.issues.some(({ code }) => code === 'PUBLISHED_GEOGRAPHY_MISSING'),
    true
  );

  row['Country Code'] = 'TH';
  row['Destination Key'] = 'bangkok';
  row['Google Maps URL'] = 'https://drive.google.com/file/d/not-a-map';
  result = validate([row]);
  assert.equal(
    result.issues.some(({ code }) => code === 'PUBLISHED_MAP_URL_INVALID'),
    true
  );
});

test('live validation blocks invalid status and duplicate Place ID', () => {
  const alpha = currentRow('alpha');
  const beta = currentRow('beta');
  beta.Status = 'Verified';
  beta['Google Place ID'] = alpha['Google Place ID'];
  const result = validate([alpha, beta]);
  const codes = new Set(result.issues.map(({ code }) => code));
  assert.equal(codes.has('STATUS_INVALID'), true);
  assert.equal(codes.has('PLACE_ID_DUPLICATE'), true);
});

test('snapshot policy allows additions but protects its minimum and Slugs', () => {
  const alpha = currentRow('alpha');
  const beta = currentRow('beta');
  let result = validateTargetRows([alpha, beta], {
    snapshotPolicy: policy({
      minimumRowCount: 1,
      protectedSlugs: ['alpha'],
    }),
  });
  assert.equal(result.policy.minimumRowCount, 1);
  assert.deepEqual(result.issues, []);

  result = validateTargetRows([beta], {
    snapshotPolicy: policy({
      minimumRowCount: 2,
      protectedSlugs: ['alpha'],
    }),
  });
  const codes = new Set(result.issues.map(({ code }) => code));
  assert.equal(codes.has('LOCATION_COUNT_BELOW_MINIMUM'), true);
  assert.equal(codes.has('PROTECTED_SLUG_MISSING'), true);
});

test('snapshot reconciliation reports Slug and field drift', () => {
  const committed = snapshotCsv([
    snapshotRow({ slug: 'alpha' }),
    snapshotRow({ slug: 'removed' }),
  ]);
  const live = snapshotCsv([
    snapshotRow({ slug: 'alpha', status: 'Paused' }),
    snapshotRow({ slug: 'added' }),
  ]);
  const result = reconcileSnapshotCsv(live, committed);
  assert.equal(result.ok, false);
  assert.equal(result.liveRowCount, 2);
  assert.equal(result.committedRowCount, 2);
  assert.equal(result.addedSlugCount, 1);
  assert.equal(result.removedSlugCount, 1);
  assert.equal(result.changedSlugCount, 1);
  assert.equal(result.changedFieldCount, 1);
  assert.deepEqual(
    result.issues.map(({ code, slug, field }) => ({ code, slug, field })),
    [
      {
        code: 'SNAPSHOT_SLUG_MISSING',
        slug: 'added',
        field: 'Slug',
      },
      {
        code: 'NOTION_SLUG_MISSING',
        slug: 'removed',
        field: 'Slug',
      },
      {
        code: 'SNAPSHOT_FIELD_MISMATCH',
        slug: 'alpha',
        field: 'Verification Status',
      },
    ]
  );
});

test('identical live and committed snapshots reconcile cleanly', () => {
  const csv = snapshotCsv([snapshotRow({ slug: 'alpha' })]);
  assert.deepEqual(reconcileSnapshotCsv(csv, csv), {
    ok: true,
    issues: [],
    liveRowCount: 1,
    committedRowCount: 1,
    addedSlugCount: 0,
    removedSlugCount: 0,
    changedSlugCount: 0,
    changedFieldCount: 0,
  });
});

test('snapshot reconciliation preserves exact field values', () => {
  const committedRow = snapshotRow({ slug: 'alpha' });
  const liveRow = [...committedRow];
  liveRow[CSV_HEADER.indexOf('Location Name')] = ` ${committedRow[0]} `;

  const result = reconcileSnapshotCsv(
    snapshotCsv([liveRow]),
    snapshotCsv([committedRow])
  );
  assert.equal(result.ok, false);
  assert.equal(result.changedSlugCount, 1);
  assert.equal(result.changedFieldCount, 1);
  assert.deepEqual(
    result.issues.map(({ code, field }) => ({ code, field })),
    [{
      code: 'SNAPSHOT_FIELD_MISMATCH',
      field: 'Location Name',
    }]
  );
});

test('snapshot reconciliation rejects rows outside the 17-field contract', () => {
  const committedRow = snapshotRow({ slug: 'alpha' });
  const invalidRow = [...committedRow, 'unexpected'];
  const result = reconcileSnapshotCsv(
    snapshotCsv([committedRow]),
    snapshotCsv([invalidRow])
  );

  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'SNAPSHOT_CONTRACT_INVALID');
  assert.match(result.issues[0].message, /18 fields; expected 17/);
});
