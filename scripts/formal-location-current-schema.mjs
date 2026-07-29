import {
  LOCATION_STATUSES,
  LOCATION_TYPES,
} from '../src/data/csv-parser.js';
import {
  COUNTRIES,
  DESTINATIONS,
} from '../src/data/destinations.js';

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
  'Type',
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
  Type: 'select',
  'Review Needed': 'checkbox',
  'Verification Note': 'rich_text',
  'Last Verified': 'date',
});

export const CURRENT_FORMAL_STATUS_OPTIONS = Object.freeze([
  { name: LOCATION_STATUSES[0], color: 'green' },
  { name: LOCATION_STATUSES[1], color: 'yellow' },
  { name: LOCATION_STATUSES[2], color: 'red' },
]);

export const CURRENT_FORMAL_TYPE_OPTIONS = Object.freeze([
  { name: LOCATION_TYPES[0], color: 'blue' },
  { name: LOCATION_TYPES[1], color: 'green' },
  { name: LOCATION_TYPES[2], color: 'pink' },
  { name: LOCATION_TYPES[3], color: 'default' },
]);

/** @type {Readonly<Record<string, string>>} */
const COUNTRY_OPTION_COLORS = Object.freeze({
  TH: 'blue',
  VN: 'red',
  TW: 'pink',
  HK: 'yellow',
  MO: 'orange',
});

/** @type {Readonly<Record<string, string>>} */
const DESTINATION_OPTION_COLORS = Object.freeze({
  bangkok: 'blue',
  'khon-kaen': 'orange',
  'chiang-mai': 'green',
  'khao-yai': 'brown',
  'koh-samui': 'blue',
  pattaya: 'purple',
  'ubon-ratchathani': 'pink',
  'ho-chi-minh-city': 'red',
  taipei: 'pink',
  taichung: 'orange',
  kaohsiung: 'yellow',
  tainan: 'brown',
  hualien: 'green',
  'hong-kong': 'purple',
  macau: 'red',
});

export const CURRENT_FORMAL_COUNTRY_OPTIONS = Object.freeze(
  COUNTRIES.map((country) => ({
    name: country.code,
    color: COUNTRY_OPTION_COLORS[country.code],
  }))
);

export const CURRENT_FORMAL_DESTINATION_OPTIONS = Object.freeze(
  DESTINATIONS.map((destination) => ({
    name: destination.key,
    color: DESTINATION_OPTION_COLORS[destination.key],
  }))
);

export const FORMAL_PROPERTIES_RETIRED_AFTER_20260720 = Object.freeze([
  'Branch Group',
  'Coordinates Approx',
  'Rejected Place IDs',
]);

export const FORMAL_BASELINE_FIELDS_RETIRED_AFTER_20260720 = Object.freeze([
  'Branch Group',
  'Coordinates Approx',
]);

function inspectCurrentFormalSelectOptions(
  properties,
  field,
  expectedOptions,
  { requireOptions = false } = {}
) {
  const options = properties?.[field]?.select?.options;
  if (!Array.isArray(options)) {
    return {
      checked: false,
      ok: !requireOptions,
      missing: [],
      unexpected: [],
      wrongColors: [],
    };
  }

  const actualByName = new Map(
    options.map((option) => [option.name, option])
  );
  const expectedByName = new Map(
    expectedOptions.map((option) => [option.name, option])
  );
  const missing = expectedOptions
    .filter((option) => !actualByName.has(option.name))
    .map((option) => option.name);
  const unexpected = options
    .filter((option) => !expectedByName.has(option.name))
    .map((option) => option.name)
    .sort();
  const wrongColors = expectedOptions.flatMap((expected) => {
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

export function inspectCurrentFormalStatusOptions(properties, options) {
  return inspectCurrentFormalSelectOptions(
    properties,
    'Status',
    CURRENT_FORMAL_STATUS_OPTIONS,
    options
  );
}

export function inspectCurrentFormalTypeOptions(properties, options) {
  return inspectCurrentFormalSelectOptions(
    properties,
    'Type',
    CURRENT_FORMAL_TYPE_OPTIONS,
    options
  );
}

export function inspectCurrentFormalCountryOptions(properties, options) {
  return inspectCurrentFormalSelectOptions(
    properties,
    'Country Code',
    CURRENT_FORMAL_COUNTRY_OPTIONS,
    options
  );
}

export function inspectCurrentFormalDestinationOptions(properties, options) {
  return inspectCurrentFormalSelectOptions(
    properties,
    'Destination Key',
    CURRENT_FORMAL_DESTINATION_OPTIONS,
    options
  );
}

export function inspectCurrentFormalLocationProperties(
  properties,
  { requireCompleteDefinitions = false } = {}
) {
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
    if (actual === expected || (!actual && !requireCompleteDefinitions)) {
      return [];
    }
    return [{
      field,
      expected,
      actual: actual || '(missing)',
    }];
  });
  const optionInspection = {
    requireOptions: requireCompleteDefinitions,
  };
  const statusOptions = inspectCurrentFormalStatusOptions(
    source,
    optionInspection
  );
  const typeOptions = inspectCurrentFormalTypeOptions(source, optionInspection);
  const countryOptions = inspectCurrentFormalCountryOptions(
    source,
    optionInspection
  );
  const destinationOptions = inspectCurrentFormalDestinationOptions(
    source,
    optionInspection
  );
  return {
    ok:
      missing.length === 0 &&
      unexpected.length === 0 &&
      wrongTypes.length === 0 &&
      statusOptions.ok &&
      typeOptions.ok &&
      countryOptions.ok &&
      destinationOptions.ok,
    missing,
    unexpected,
    wrongTypes,
    statusOptions,
    typeOptions,
    countryOptions,
    destinationOptions,
  };
}

export function inspectCurrentFormalDataSourceProperties(properties) {
  return inspectCurrentFormalLocationProperties(properties, {
    requireCompleteDefinitions: true,
  });
}

function optionIssueMessage(label, result) {
  if (result.ok) return '';
  if (!result.checked) return `${label} options unavailable`;
  const details = [
    result.missing.length > 0
      ? `missing ${result.missing.join(', ')}`
      : '',
    result.unexpected.length > 0
      ? `unexpected ${result.unexpected.join(', ')}`
      : '',
    result.wrongColors.length > 0
      ? `wrong colors ${result.wrongColors
          .map(({ name, actual, expected }) =>
            `${name}:${actual}->${expected}`
          )
          .join(', ')}`
      : '',
  ].filter(Boolean);
  return `${label} options ${details.join('; ')}`;
}

export function currentFormalSchemaIssueMessages(schema) {
  return [
    schema.missing.length > 0
      ? `missing properties ${schema.missing.join(', ')}`
      : '',
    schema.unexpected.length > 0
      ? `unexpected properties ${schema.unexpected.join(', ')}`
      : '',
    schema.wrongTypes.length > 0
      ? `wrong property types ${schema.wrongTypes
          .map(
            ({ field, expected, actual }) =>
              `${field}:${actual}->${expected}`
          )
          .join(', ')}`
      : '',
    optionIssueMessage('Status', schema.statusOptions),
    optionIssueMessage('Type', schema.typeOptions),
    optionIssueMessage('Country Code', schema.countryOptions),
    optionIssueMessage('Destination Key', schema.destinationOptions),
  ].filter(Boolean);
}
