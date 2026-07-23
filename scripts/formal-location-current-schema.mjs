export const CURRENT_FORMAL_BASELINE_FIELDS = Object.freeze([
  'Name',
  'Name ZH',
  'Thai / Alt Name',
  'Category',
  'Google Maps URL',
  'Google Place ID',
  'Lat',
  'Lng',
  'Notes EN',
  'Notes ZH',
  'Slug',
  'Source Tags',
  'Source URLs',
  'Status',
  'Country Code',
  'Destination Key',
]);

export const CURRENT_FORMAL_WORKFLOW_FIELDS = Object.freeze([
  'Review Needed',
  'Verification Note',
  'Last Verified',
]);

export const CURRENT_FORMAL_LOCATION_PROPERTIES = Object.freeze([
  ...CURRENT_FORMAL_BASELINE_FIELDS,
  ...CURRENT_FORMAL_WORKFLOW_FIELDS,
]);

export const CURRENT_FORMAL_LOCATION_PROPERTY_TYPES = Object.freeze({
  Name: 'title',
  'Name ZH': 'rich_text',
  'Thai / Alt Name': 'rich_text',
  Category: 'select',
  'Google Maps URL': 'url',
  'Google Place ID': 'rich_text',
  Lat: 'number',
  Lng: 'number',
  'Notes EN': 'rich_text',
  'Notes ZH': 'rich_text',
  Slug: 'rich_text',
  'Source Tags': 'multi_select',
  'Source URLs': 'rich_text',
  Status: 'select',
  'Country Code': 'select',
  'Destination Key': 'select',
  'Review Needed': 'checkbox',
  'Verification Note': 'rich_text',
  'Last Verified': 'date',
});

export const CURRENT_FORMAL_STATUS_OPTIONS = Object.freeze([
  { name: LOCATION_STATUSES[0], color: 'green' },
  { name: LOCATION_STATUSES[1], color: 'yellow' },
  { name: LOCATION_STATUSES[2], color: 'red' },
]);

export const FORMAL_PROPERTIES_RETIRED_AFTER_20260720 = Object.freeze([
  'Branch Group',
  'Coordinates Approx',
  'Rejected Place IDs',
]);

export const FORMAL_BASELINE_FIELDS_RETIRED_AFTER_20260720 = Object.freeze([
  'Branch Group',
  'Coordinates Approx',
]);

export function inspectCurrentFormalStatusOptions(properties) {
  const options = properties?.Status?.select?.options;
  if (!Array.isArray(options)) {
    return {
      checked: false,
      ok: true,
      missing: [],
      unexpected: [],
      wrongColors: [],
    };
  }

  const actualByName = new Map(
    options.map((option) => [option.name, option])
  );
  const expectedByName = new Map(
    CURRENT_FORMAL_STATUS_OPTIONS.map((option) => [option.name, option])
  );
  const missing = CURRENT_FORMAL_STATUS_OPTIONS
    .filter((option) => !actualByName.has(option.name))
    .map((option) => option.name);
  const unexpected = options
    .filter((option) => !expectedByName.has(option.name))
    .map((option) => option.name)
    .sort();
  const wrongColors = CURRENT_FORMAL_STATUS_OPTIONS.flatMap((expected) => {
    const actual = actualByName.get(expected.name);
    return actual && actual.color !== expected.color
      ? [{
          name: expected.name,
          expected: expected.color,
          actual: actual.color,
        }]
      : [];
  });

  return {
    checked: true,
    ok:
      missing.length === 0 &&
      unexpected.length === 0 &&
      wrongColors.length === 0,
    missing,
    unexpected,
    wrongColors,
  };
}

export function inspectCurrentFormalLocationProperties(properties) {
  const source = properties || {};
  const expectedNames = new Set(CURRENT_FORMAL_LOCATION_PROPERTIES);
  const missing = CURRENT_FORMAL_LOCATION_PROPERTIES.filter(
    (field) => !Object.hasOwn(source, field)
  );
  const unexpected = Object.keys(source)
    .filter((field) => !expectedNames.has(field))
    .sort();
  const wrongTypes = CURRENT_FORMAL_LOCATION_PROPERTIES.flatMap((field) => {
    const actual = source[field]?.type;
    const expected = CURRENT_FORMAL_LOCATION_PROPERTY_TYPES[field];
    return actual && actual !== expected
      ? [{ field, expected, actual }]
      : [];
  });
  const statusOptions = inspectCurrentFormalStatusOptions(source);
  return {
    ok:
      missing.length === 0 &&
      unexpected.length === 0 &&
      wrongTypes.length === 0 &&
      statusOptions.ok,
    missing,
    unexpected,
    wrongTypes,
    statusOptions,
  };
}
import { LOCATION_STATUSES } from '../src/csv-parser.js';
