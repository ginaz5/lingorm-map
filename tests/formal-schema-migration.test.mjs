import assert from 'node:assert/strict';
import test from 'node:test';

import { FORMAL_DATA_SOURCE_ID } from '../scripts/location-verification-core.mjs';
import {
  FORMAL_PROPERTY_TYPES,
  FORMAL_STATUS_OPTIONS,
  WORKFLOW_SCHEMA,
  planFormalSchemaMigration,
  updateFormalDataSourceSchema,
} from '../scripts/migrate-formal-location-schema.mjs';

function property(type, extra = {}) {
  return {
    id: `${type}-id`,
    name: type,
    type,
    [type]: {},
    ...extra,
  };
}

function dataSourceWithStatusOptions(options = FORMAL_STATUS_OPTIONS) {
  const properties = Object.fromEntries(
    Object.entries(FORMAL_PROPERTY_TYPES).map(([name, type]) => [
      name,
      property(type),
    ])
  );
  properties.Status = property('select', {
    select: {
      options: options.map((option, index) => ({
        id: `status-${index}`,
        ...option,
      })),
    },
  });
  return {
    id: FORMAL_DATA_SOURCE_ID,
    properties,
  };
}

const LEGACY_STATUS_OPTIONS = [
  { name: 'Draft', color: 'gray' },
  { name: 'Needs Review', color: 'yellow' },
  { name: 'Verifying', color: 'orange' },
  { name: 'Verified', color: 'green' },
  { name: 'Could Not Find', color: 'red' },
  { name: 'Closed', color: 'default' },
  ...FORMAL_STATUS_OPTIONS,
];

test('formal schema plan removes legacy Status options without adding properties', () => {
  const plan = planFormalSchemaMigration(
    dataSourceWithStatusOptions(LEGACY_STATUS_OPTIONS)
  );
  assert.equal(plan.currentPropertyCount, 17);
  assert.equal(plan.targetPropertyCount, 17);
  assert.deepEqual(plan.missingWorkflowFields, []);
  assert.deepEqual(plan.missingStatusOptions, []);
  assert.deepEqual(plan.unexpectedStatusOptions, [
    'Closed',
    'Could Not Find',
    'Draft',
    'Needs Review',
    'Verified',
    'Verifying',
  ]);
  assert.deepEqual(plan.wrongStatusOptionColors, []);
  assert.deepEqual(Object.keys(plan.patch), ['Status']);
  assert.equal(plan.alreadyApplied, false);

  assert.deepEqual(
    plan.patch.Status.select.options,
    FORMAL_STATUS_OPTIONS.map((option, index) => ({
      id: `status-${index + 6}`,
      ...option,
    }))
  );
});

test('formal schema migration is idempotent for the exact three-status schema', () => {
  const plan = planFormalSchemaMigration(dataSourceWithStatusOptions());
  assert.equal(plan.currentPropertyCount, 17);
  assert.deepEqual(plan.missingWorkflowFields, []);
  assert.deepEqual(plan.missingStatusOptions, []);
  assert.deepEqual(plan.unexpectedStatusOptions, []);
  assert.deepEqual(plan.wrongStatusOptionColors, []);
  assert.deepEqual(plan.patch, {});
  assert.equal(plan.alreadyApplied, true);
});

test('formal schema migration rejects a redirected source or unknown property', () => {
  assert.throws(
    () => planFormalSchemaMigration({
      ...dataSourceWithStatusOptions(),
      id: 'redirected-source',
    }),
    /Refusing formal schema migration/
  );

  const dataSource = dataSourceWithStatusOptions();
  dataSource.properties.Unexpected = property('rich_text');
  assert.throws(
    () => planFormalSchemaMigration(dataSource),
    /unexpected properties: Unexpected/
  );
});

test('formal schema migration repairs missing options and rejects wrong field types', () => {
  const incomplete = dataSourceWithStatusOptions([
    { name: 'Published', color: 'blue' },
    { name: 'Paused', color: 'yellow' },
  ]);
  const plan = planFormalSchemaMigration(incomplete);
  assert.deepEqual(plan.missingStatusOptions, ['Inactive']);
  assert.deepEqual(plan.wrongStatusOptionColors, [
    { name: 'Published', expected: 'green', actual: 'blue' },
  ]);
  assert.deepEqual(plan.patch.Status.select.options, [
    { id: 'status-0', name: 'Published', color: 'green' },
    { id: 'status-1', name: 'Paused', color: 'yellow' },
    { name: 'Inactive', color: 'red' },
  ]);

  const wrongWorkflow = dataSourceWithStatusOptions();
  wrongWorkflow.properties['Review Needed'] = property('rich_text');
  assert.throws(
    () => planFormalSchemaMigration(wrongWorkflow),
    /Review Needed must remain checkbox/
  );
});

test('schema update uses one PATCH against only the allowlisted formal data source', async () => {
  const requests = [];
  const response = await updateFormalDataSourceSchema({
    notionApiKey: 'formal-write-token',
    patch: { 'Review Needed': { checkbox: {} } },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ id: FORMAL_DATA_SOURCE_ID, properties: {} }),
      };
    },
  });

  assert.equal(response.id, FORMAL_DATA_SOURCE_ID);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    `https://api.notion.com/v1/data_sources/${FORMAL_DATA_SOURCE_ID}`
  );
  assert.equal(requests[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    properties: { 'Review Needed': { checkbox: {} } },
  });
});
