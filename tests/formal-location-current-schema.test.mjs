import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_FORMAL_BASELINE_FIELDS,
  CURRENT_FORMAL_COUNTRY_OPTIONS,
  CURRENT_FORMAL_DESTINATION_OPTIONS,
  CURRENT_FORMAL_LOCATION_PROPERTIES,
  CURRENT_FORMAL_LOCATION_PROPERTY_TYPES,
  CURRENT_FORMAL_STATUS_OPTIONS,
  CURRENT_FORMAL_TYPE_OPTIONS,
  CURRENT_FORMAL_WORKFLOW_FIELDS,
  FORMAL_BASELINE_FIELDS_RETIRED_AFTER_20260720,
  FORMAL_PROPERTIES_RETIRED_AFTER_20260720,
  currentFormalSchemaIssueMessages,
  inspectCurrentFormalCountryOptions,
  inspectCurrentFormalDataSourceProperties,
  inspectCurrentFormalDestinationOptions,
  inspectCurrentFormalLocationProperties,
  inspectCurrentFormalStatusOptions,
  inspectCurrentFormalTypeOptions,
} from '../scripts/formal-location-current-schema.mjs';

test('current formal schema matches the 20-property Notion contract', () => {
  assert.equal(CURRENT_FORMAL_BASELINE_FIELDS.length, 17);
  assert.ok(CURRENT_FORMAL_BASELINE_FIELDS.includes('Country Code'));
  assert.ok(CURRENT_FORMAL_BASELINE_FIELDS.includes('Destination Key'));
  assert.ok(CURRENT_FORMAL_BASELINE_FIELDS.includes('Type'));
  assert.deepEqual(CURRENT_FORMAL_WORKFLOW_FIELDS, [
    'Review Needed',
    'Verification Note',
    'Last Verified',
  ]);
  assert.equal(CURRENT_FORMAL_LOCATION_PROPERTIES.length, 20);
  assert.deepEqual(CURRENT_FORMAL_STATUS_OPTIONS, [
    { name: 'Published', color: 'green' },
    { name: 'Paused', color: 'yellow' },
    { name: 'Inactive', color: 'red' },
  ]);
  assert.deepEqual(CURRENT_FORMAL_TYPE_OPTIONS, [
    { name: 'LingOrm', color: 'blue' },
    { name: 'JKR Picks', color: 'green' },
    { name: 'JKR Fan Projects', color: 'pink' },
    { name: 'Admin Picks', color: 'default' },
  ]);
  assert.deepEqual(CURRENT_FORMAL_COUNTRY_OPTIONS, [
    { name: 'TH', color: 'blue' },
    { name: 'VN', color: 'red' },
    { name: 'TW', color: 'pink' },
    { name: 'HK', color: 'yellow' },
    { name: 'MO', color: 'orange' },
  ]);
  assert.deepEqual(CURRENT_FORMAL_DESTINATION_OPTIONS, [
    { name: 'bangkok', color: 'blue' },
    { name: 'khon-kaen', color: 'orange' },
    { name: 'chiang-mai', color: 'green' },
    { name: 'khao-yai', color: 'brown' },
    { name: 'koh-samui', color: 'blue' },
    { name: 'pattaya', color: 'purple' },
    { name: 'ubon-ratchathani', color: 'pink' },
    { name: 'ho-chi-minh-city', color: 'red' },
    { name: 'taipei', color: 'pink' },
    { name: 'taichung', color: 'orange' },
    { name: 'kaohsiung', color: 'yellow' },
    { name: 'tainan', color: 'brown' },
    { name: 'hualien', color: 'green' },
    { name: 'hong-kong', color: 'purple' },
    { name: 'macau', color: 'red' },
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
    typeOptions: {
      checked: false,
      ok: true,
      missing: [],
      unexpected: [],
      wrongColors: [],
    },
    countryOptions: {
      checked: false,
      ok: true,
      missing: [],
      unexpected: [],
      wrongColors: [],
    },
    destinationOptions: {
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

test('data-source schema inspection requires complete types and select options', () => {
  const missingTypes = Object.fromEntries(
    CURRENT_FORMAL_LOCATION_PROPERTIES.map((field) => [field, {}])
  );
  const missingTypeResult =
    inspectCurrentFormalDataSourceProperties(missingTypes);
  assert.equal(missingTypeResult.ok, false);
  assert.equal(
    missingTypeResult.wrongTypes.length,
    CURRENT_FORMAL_LOCATION_PROPERTIES.length
  );
  assert.deepEqual(missingTypeResult.wrongTypes[0], {
    field: 'Name',
    expected: 'title',
    actual: '(missing)',
  });

  const missingOptions = Object.fromEntries(
    CURRENT_FORMAL_LOCATION_PROPERTIES.map((field) => [
      field,
      { type: CURRENT_FORMAL_LOCATION_PROPERTY_TYPES[field] },
    ])
  );
  const missingOptionResult =
    inspectCurrentFormalDataSourceProperties(missingOptions);
  assert.equal(missingOptionResult.ok, false);
  assert.equal(missingOptionResult.statusOptions.checked, false);
  assert.equal(missingOptionResult.statusOptions.ok, false);
  assert.match(
    currentFormalSchemaIssueMessages(missingOptionResult).join('; '),
    /Status options unavailable.*Destination Key options unavailable/
  );
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

test('current formal schema inspection enforces exactly four Type options', () => {
  const properties = {
    Type: {
      type: 'select',
      select: {
        options: CURRENT_FORMAL_TYPE_OPTIONS.map((option) => ({ ...option })),
      },
    },
  };
  assert.deepEqual(inspectCurrentFormalTypeOptions(properties), {
    checked: true,
    ok: true,
    missing: [],
    unexpected: [],
    wrongColors: [],
  });

  properties.Type.select.options = [
    { name: 'LingOrm', color: 'red' },
    { name: 'JKR Picks', color: 'green' },
    { name: 'Bookmark', color: 'default' },
  ];
  assert.deepEqual(inspectCurrentFormalTypeOptions(properties), {
    checked: true,
    ok: false,
    missing: ['JKR Fan Projects', 'Admin Picks'],
    unexpected: ['Bookmark'],
    wrongColors: [
      { name: 'LingOrm', expected: 'blue', actual: 'red' },
    ],
  });
});

test('current formal schema inspection enforces geography taxonomy options', () => {
  const properties = {
    'Country Code': {
      type: 'select',
      select: {
        options: CURRENT_FORMAL_COUNTRY_OPTIONS.map((option) => ({ ...option })),
      },
    },
    'Destination Key': {
      type: 'select',
      select: {
        options: CURRENT_FORMAL_DESTINATION_OPTIONS.map((option) => ({
          ...option,
        })),
      },
    },
  };

  assert.equal(inspectCurrentFormalCountryOptions(properties).ok, true);
  assert.equal(inspectCurrentFormalDestinationOptions(properties).ok, true);

  properties['Country Code'].select.options = [
    { name: 'TH', color: 'blue' },
    { name: 'VN', color: 'red' },
    { name: 'SG', color: 'gray' },
  ];
  assert.deepEqual(inspectCurrentFormalCountryOptions(properties), {
    checked: true,
    ok: false,
    missing: ['TW', 'HK', 'MO'],
    unexpected: ['SG'],
    wrongColors: [],
  });

  properties['Destination Key'].select.options = [
    ...CURRENT_FORMAL_DESTINATION_OPTIONS
      .filter((option) => option.name !== 'macau')
      .map((option) => ({ ...option })),
    { name: 'hong-kong', color: 'yellow' },
  ];
  const destinationResult = inspectCurrentFormalDestinationOptions(properties);
  assert.equal(destinationResult.ok, false);
  assert.deepEqual(destinationResult.missing, ['macau']);
  assert.deepEqual(destinationResult.unexpected, []);
  assert.deepEqual(destinationResult.wrongColors, [
    { name: 'hong-kong', expected: 'purple', actual: 'yellow' },
  ]);

  const schema = inspectCurrentFormalLocationProperties(properties);
  assert.equal(schema.ok, false);
  assert.match(
    currentFormalSchemaIssueMessages(schema).join('; '),
    /Country Code options missing TW, HK, MO; unexpected SG/
  );
  assert.match(
    currentFormalSchemaIssueMessages(schema).join('; '),
    /Destination Key options missing macau; wrong colors hong-kong:yellow->purple/
  );
});
