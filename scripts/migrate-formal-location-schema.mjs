#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { FORMAL_DATA_SOURCE_ID } from './location-verification-core.mjs';
import {
  queryAllNotionDataSourcePages,
} from './location-verification-runner.mjs';
import {
  CURRENT_FORMAL_LOCATION_PROPERTIES,
  CURRENT_FORMAL_LOCATION_PROPERTY_TYPES,
  CURRENT_FORMAL_STATUS_OPTIONS,
  CURRENT_FORMAL_WORKFLOW_FIELDS,
  inspectCurrentFormalStatusOptions,
} from './formal-location-current-schema.mjs';
import {
  buildFormalCutoverBaseline,
  formalPagesToRows,
  sha256,
} from './capture-formal-cutover-baseline.mjs';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2025-09-03';
const CUTOVER_BASELINE_URL = new URL(
  '../docs/location-verification-formal-cutover-baseline-20260719.json',
  import.meta.url
);
const PREVIOUS_BASELINE_URL = new URL(
  '../docs/location-verification-poc-baseline-20260719.json',
  import.meta.url
);
const FORMAL_APPROVALS_URL = new URL(
  '../docs/location-verification-formal-change-approvals.json',
  import.meta.url
);

export const FORMAL_PROPERTY_TYPES = CURRENT_FORMAL_LOCATION_PROPERTY_TYPES;
export const FORMAL_STATUS_OPTIONS = CURRENT_FORMAL_STATUS_OPTIONS;

export const WORKFLOW_SCHEMA = Object.freeze({
  'Review Needed': { checkbox: {} },
  'Verification Note': { rich_text: {} },
  'Last Verified': { date: {} },
});

function normalizeId(value) {
  return String(value || '').replaceAll('-', '').toLowerCase();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectedType(definition) {
  return Object.keys(definition)[0];
}

function optionMap(property) {
  return new Map(
    (property?.select?.options || []).map((option) => [option.name, option])
  );
}

function assertOptionsMatch(propertyName, property, expectedOptions) {
  const actual = optionMap(property);
  if (actual.size !== expectedOptions.length) {
    throw new Error(
      `${propertyName} must contain exactly ${expectedOptions.length} options`
    );
  }
  for (const expected of expectedOptions) {
    const option = actual.get(expected.name);
    if (!option || option.color !== expected.color) {
      throw new Error(
        `${propertyName} option ${expected.name} does not match the rehearsal schema`
      );
    }
  }
}

export function planFormalSchemaMigration(dataSource) {
  if (normalizeId(dataSource?.id) !== normalizeId(FORMAL_DATA_SOURCE_ID)) {
    throw new Error(
      `Refusing formal schema migration for data source ${dataSource?.id || '(missing)'}`
    );
  }
  const properties = dataSource.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error('Formal data source did not return a property schema');
  }

  const allowedPropertyNames = new Set([
    ...CURRENT_FORMAL_LOCATION_PROPERTIES,
  ]);
  const unexpectedProperties = Object.keys(properties)
    .filter((name) => !allowedPropertyNames.has(name))
    .sort();
  if (unexpectedProperties.length > 0) {
    throw new Error(
      `Formal schema contains unexpected properties: ${unexpectedProperties.join(', ')}`
    );
  }

  for (const field of CURRENT_FORMAL_LOCATION_PROPERTIES) {
    const property = properties[field];
    if (!property) {
      throw new Error(`Formal schema is missing required property ${field}`);
    }
    if (property.type !== FORMAL_PROPERTY_TYPES[field]) {
      throw new Error(
        `Formal property ${field} must remain ${FORMAL_PROPERTY_TYPES[field]}; ` +
        `found ${property.type || '(missing type)'}`
      );
    }
  }

  const statusOptions = optionMap(properties.Status);
  const statusInspection = inspectCurrentFormalStatusOptions(properties);
  if (!statusInspection.checked) {
    throw new Error('Formal Status options are unavailable');
  }

  const missingWorkflowFields = [];
  for (const field of CURRENT_FORMAL_WORKFLOW_FIELDS) {
    const definition = WORKFLOW_SCHEMA[field];
    const property = properties[field];
    if (!property) {
      missingWorkflowFields.push(field);
      continue;
    }
    const type = expectedType(definition);
    if (property.type !== type) {
      throw new Error(
        `Formal workflow property ${field} must be ${type}; found ${property.type}`
      );
    }
    if (type === 'select') {
      assertOptionsMatch(field, property, definition.select.options);
    }
  }

  const missingStatusOptions = statusInspection.missing;
  const unexpectedStatusOptions = statusInspection.unexpected;
  const wrongStatusOptionColors = statusInspection.wrongColors;
  const patch = {};
  for (const field of missingWorkflowFields) {
    patch[field] = clone(WORKFLOW_SCHEMA[field]);
  }
  if (!statusInspection.ok) {
    patch.Status = {
      select: {
        options: FORMAL_STATUS_OPTIONS.map((expected) => {
          const existing = statusOptions.get(expected.name);
          return existing
            ? {
                id: existing.id,
                name: expected.name,
                color: expected.color,
              }
            : { ...expected };
        }),
      },
    };
  }

  return {
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    currentPropertyCount: Object.keys(properties).length,
    targetPropertyCount: CURRENT_FORMAL_LOCATION_PROPERTIES.length,
    missingWorkflowFields,
    missingStatusOptions,
    unexpectedStatusOptions,
    wrongStatusOptionColors,
    patch,
    alreadyApplied:
      missingWorkflowFields.length === 0 && statusInspection.ok,
  };
}

async function readJsonResponse(response, label) {
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.message || body?.code || '';
    } catch {
      // HTTP status and label are sufficient.
    }
    throw new Error(
      `${label} failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`
    );
  }
  return response.json();
}

export async function fetchFormalDataSource({
  notionApiKey,
  fetchImpl = fetch,
}) {
  if (!notionApiKey) throw new Error('Missing formal Notion API key');
  const response = await fetchImpl(
    `${NOTION_API_BASE}/data_sources/${FORMAL_DATA_SOURCE_ID}`,
    {
      headers: {
        Authorization: `Bearer ${notionApiKey}`,
        'Notion-Version': NOTION_VERSION,
      },
    }
  );
  return readJsonResponse(response, 'Formal data source read');
}

export async function updateFormalDataSourceSchema({
  notionApiKey,
  patch,
  fetchImpl = fetch,
}) {
  if (!notionApiKey) {
    throw new Error('Missing NOTION_FORMAL_WRITE_API_KEY');
  }
  if (!patch || Object.keys(patch).length === 0) {
    throw new Error('Refusing empty formal schema PATCH');
  }
  const response = await fetchImpl(
    `${NOTION_API_BASE}/data_sources/${FORMAL_DATA_SOURCE_ID}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${notionApiKey}`,
        'Notion-Version': NOTION_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ properties: patch }),
    }
  );
  return readJsonResponse(response, 'Formal data source schema update');
}

export async function verifyLiveCutoverBaseline({
  notionApiKey,
  fetchImpl = fetch,
}) {
  const [artifactRaw, previousRaw, approvalsRaw, pages] = await Promise.all([
    readFile(CUTOVER_BASELINE_URL, 'utf8'),
    readFile(PREVIOUS_BASELINE_URL, 'utf8'),
    readFile(FORMAL_APPROVALS_URL, 'utf8'),
    queryAllNotionDataSourcePages({
      dataSourceId: FORMAL_DATA_SOURCE_ID,
      notionApiKey,
      fetchImpl,
    }),
  ]);
  const artifact = JSON.parse(artifactRaw);
  if (
    artifact?.schemaVersion !== 1 ||
    artifact.formalDataSourceId !== FORMAL_DATA_SOURCE_ID ||
    artifact.rowCount !== 99
  ) {
    throw new Error('Cutover artifact does not match the formal 99-row contract');
  }
  const formalRows = formalPagesToRows(pages);
  const rebuilt = buildFormalCutoverBaseline({
    formalRows,
    previousBaseline: JSON.parse(previousRaw),
    previousBaselineSha256: sha256(previousRaw),
    formalChangeApprovals: JSON.parse(approvalsRaw),
    expectedCount: artifact.rowCount,
    allowedAddedSlugs: artifact.transition.addedSlugs,
    capturedAt: new Date().toISOString(),
    baselineId: artifact.baselineId,
  });
  if (rebuilt.contentSha256 !== artifact.contentSha256) {
    throw new Error(
      `Live formal data no longer matches cutover baseline: ` +
      `${rebuilt.contentSha256} != ${artifact.contentSha256}`
    );
  }
  return {
    rowCount: rebuilt.rowCount,
    contentSha256: rebuilt.contentSha256,
    addedSlugs: rebuilt.transition.addedSlugs,
    removedSlugs: rebuilt.transition.removedSlugs,
    formalRows,
  };
}

function parseArgs(args) {
  if (args.length !== 1 || !['--dry-run', '--confirm'].includes(args[0])) {
    throw new Error('Use exactly one of --dry-run or --confirm');
  }
  return { confirm: args[0] === '--confirm' };
}

function formatResult(result) {
  return [
    `MODE=${result.mode}`,
    `FORMAL_DATA_SOURCE_ID=${result.plan.dataSourceId}`,
    `CURRENT_PROPERTY_COUNT=${result.plan.currentPropertyCount}`,
    `TARGET_PROPERTY_COUNT=${result.plan.targetPropertyCount}`,
    `MISSING_WORKFLOW_FIELDS=${result.plan.missingWorkflowFields.join(',') || '(none)'}`,
    `MISSING_STATUS_OPTIONS=${result.plan.missingStatusOptions.join(',') || '(none)'}`,
    `UNEXPECTED_STATUS_OPTIONS=${result.plan.unexpectedStatusOptions.join(',') || '(none)'}`,
    `CUTOVER_ROW_COUNT=${result.cutover.rowCount}`,
    `CUTOVER_CONTENT_SHA256=${result.cutover.contentSha256}`,
    `SCHEMA_PATCH_PROPERTIES=${Object.keys(result.plan.patch).join(',') || '(none)'}`,
    `SCHEMA_ALREADY_APPLIED=${result.plan.alreadyApplied}`,
    `SCHEMA_READBACK_VERIFIED=${result.schemaReadbackVerified}`,
    `FORMAL_FIELD_VALUES_UNCHANGED=${result.formalFieldValuesUnchanged}`,
    `NOTION_PAGE_WRITE_PERFORMED=false`,
    `NOTION_SCHEMA_WRITE_PERFORMED=${result.schemaWritePerformed}`,
  ].join('\n');
}

async function main() {
  const { confirm } = parseArgs(process.argv.slice(2));
  const formalReadApiKey = process.env.NOTION_FORMAL_READ_API_KEY;
  if (!formalReadApiKey) {
    throw new Error('Missing NOTION_FORMAL_READ_API_KEY');
  }
  const [dataSource, cutover] = await Promise.all([
    fetchFormalDataSource({ notionApiKey: formalReadApiKey }),
    verifyLiveCutoverBaseline({ notionApiKey: formalReadApiKey }),
  ]);
  const plan = planFormalSchemaMigration(dataSource);

  if (!confirm) {
    console.log(formatResult({
      mode: 'dry-run',
      plan,
      cutover,
      schemaReadbackVerified: false,
      formalFieldValuesUnchanged: true,
      schemaWritePerformed: false,
    }));
    return;
  }

  const formalWriteApiKey = process.env.NOTION_FORMAL_WRITE_API_KEY;
  if (!formalWriteApiKey) {
    throw new Error('Missing NOTION_FORMAL_WRITE_API_KEY');
  }
  let schemaWritePerformed = false;
  if (!plan.alreadyApplied) {
    await updateFormalDataSourceSchema({
      notionApiKey: formalWriteApiKey,
      patch: plan.patch,
    });
    schemaWritePerformed = true;
  }

  const [readBackDataSource, readBackCutover] = await Promise.all([
    fetchFormalDataSource({ notionApiKey: formalReadApiKey }),
    verifyLiveCutoverBaseline({ notionApiKey: formalReadApiKey }),
  ]);
  const readBackPlan = planFormalSchemaMigration(readBackDataSource);
  if (!readBackPlan.alreadyApplied) {
    throw new Error(
      `Formal schema readback is incomplete: ` +
      `${readBackPlan.missingWorkflowFields.join(', ')} / ` +
      `${readBackPlan.missingStatusOptions.join(', ')} / ` +
      `${readBackPlan.unexpectedStatusOptions.join(', ')}`
    );
  }
  if (readBackCutover.contentSha256 !== cutover.contentSha256) {
    throw new Error('Formal page values changed during schema migration');
  }

  console.log(formatResult({
    mode: plan.alreadyApplied ? 'confirm-noop' : 'confirm',
    plan: readBackPlan,
    cutover: readBackCutover,
    schemaReadbackVerified: true,
    formalFieldValuesUnchanged: true,
    schemaWritePerformed,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
