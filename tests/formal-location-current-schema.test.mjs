import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_FORMAL_BASELINE_FIELDS,
  CURRENT_FORMAL_LOCATION_PROPERTIES,
  CURRENT_FORMAL_LOCATION_PROPERTY_TYPES,
  CURRENT_FORMAL_STATUS_OPTIONS,
  CURRENT_FORMAL_WORKFLOW_FIELDS,
  FORMAL_BASELINE_FIELDS_RETIRED_AFTER_20260720,
  FORMAL_PROPERTIES_RETIRED_AFTER_20260720,
  inspectCurrentFormalLocationProperties,
  inspectCurrentFormalStatusOptions,
} from '../scripts/formal-location-current-schema.mjs';

test('current formal schema matches the 17-property Notion contract', () => {
  assert.equal(CURRENT_FORMAL_BASELINE_FIELDS.length, 14);
  assert.deepEqual(CURRENT_FORMAL_WORKFLOW_FIELDS, [
    'Review Needed',
    'Verification Note',
    'Last Verified',
  ]);
  assert.equal(CURRENT_FORMAL_LOCATION_PROPERTIES.length, 17);
  assert.deepEqual(CURRENT_FORMAL_STATUS_OPTIONS, [
    { name: 'Published', color: 'green' },
    { name: 'Paused', color: 'yellow' },
    { name: 'Inactive', color: 'red' },
  ]);
  assert.deepEqual(FORMAL_PROPERTIES_RETIRED_AFTER_20260720, [
    'Branch Group',
    'Coordinates Approx',
    'Rejected Place IDs',
  ]);
  assert.deepEqual(FORMAL_BASELINE_FIELDS_RETIRED_AFTER_20260720, [
    'Branch Group',
    'Coordinates Approx',
  ]);
});

test('current formal schema inspection rejects missing or mistyped fields', () => {
  const properties = Object.fromEntries(
    CURRENT_FORMAL_LOCATION_PROPERTIES.map((field) => [
      field,
      { type: CURRENT_FORMAL_LOCATION_PROPERTY_TYPES[field] },
    ])
  );
  assert.deepEqual(inspectCurrentFormalLocationProperties(properties), {
    ok: true,
    missing: [],
    unexpected: [],
    wrongTypes: [],
    statusOptions: {
      checked: false,
      ok: true,
      missing: [],
      unexpected: [],
      wrongColors: [],
    },
  });

  delete properties['Last Verified'];
  properties.Lat = { type: 'rich_text' };
  properties.Legacy = { type: 'rich_text' };
  const result = inspectCurrentFormalLocationProperties(properties);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['Last Verified']);
  assert.deepEqual(result.unexpected, ['Legacy']);
  assert.deepEqual(result.wrongTypes, [
    { field: 'Lat', expected: 'number', actual: 'rich_text' },
  ]);
});

test('current formal schema inspection enforces exactly three Status options', () => {
  const properties = {
    Status: {
      type: 'select',
      select: {
        options: CURRENT_FORMAL_STATUS_OPTIONS.map((option) => ({ ...option })),
      },
    },
  };
  assert.deepEqual(inspectCurrentFormalStatusOptions(properties), {
    checked: true,
    ok: true,
    missing: [],
    unexpected: [],
    wrongColors: [],
  });

  properties.Status.select.options = [
    { name: 'Published', color: 'blue' },
    { name: 'Paused', color: 'yellow' },
    { name: 'Draft', color: 'gray' },
  ];
  assert.deepEqual(inspectCurrentFormalStatusOptions(properties), {
    checked: true,
    ok: false,
    missing: ['Inactive'],
    unexpected: ['Draft'],
    wrongColors: [
      { name: 'Published', expected: 'green', actual: 'blue' },
    ],
  });
});
