import assert from 'node:assert/strict';
import test from 'node:test';

import { FORMAL_DATA_SOURCE_ID } from '../scripts/location-verification-core.mjs';
import {
  FORMAL_CANARY_PAGE_ID,
  FORMAL_CANARY_SLUG,
  FORMAL_WORKFLOW_FIELDS,
  formalCanaryPatchToNotionProperties,
  planFormalCanaryInitialization,
  updateFormalCanaryPage,
} from '../scripts/initialize-formal-location-canary.mjs';

function canaryRow(overrides = {}) {
  return {
    Name: 'Khlong Bang Luang Floating Market',
    Slug: FORMAL_CANARY_SLUG,
    Status: 'Paused',
    'Review Needed': '__NO__',
    ...Object.fromEntries(
      FORMAL_WORKFLOW_FIELDS
        .filter((field) => field !== 'Review Needed')
        .map((field) => [field, ''])
    ),
    ...overrides,
  };
}

function plan(overrides = {}) {
  return planFormalCanaryInitialization({
    pageId: FORMAL_CANARY_PAGE_ID,
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    row: canaryRow(),
    ...overrides,
  });
}

test('first formal canary proposes only Review Needed TRUE and keeps Paused', () => {
  const preview = plan();
  assert.equal(preview.beforeFormalSnapshot.Status, 'Paused');
  assert.deepEqual(preview.proposedPatch, {
    'Review Needed': '__YES__',
  });
  assert.deepEqual(preview.rollbackPatch, {
    'Review Needed': '__NO__',
  });
  assert.equal(preview.alreadyApplied, false);
});

test('first formal canary is idempotent after Review Needed is already TRUE', () => {
  const preview = plan({
    row: canaryRow({ 'Review Needed': '__YES__' }),
  });
  assert.deepEqual(preview.proposedPatch, {});
  assert.equal(preview.alreadyApplied, true);
});

test('first formal canary rejects another page, source, status, or occupied workflow', () => {
  assert.throws(
    () => plan({ pageId: 'f'.repeat(32) }),
    /Refusing first formal canary/
  );
  assert.throws(
    () => plan({ dataSourceId: 'redirected-source' }),
    /Refusing write/
  );
  assert.throws(
    () => plan({ row: canaryRow({ Status: 'Published' }) }),
    /must remain Paused/
  );
  assert.throws(
    () => plan({
      row: canaryRow({ 'Verification Note': 'Already initialized' }),
    }),
    /already has workflow content/
  );
});

test('first formal canary converter refuses every field except Review Needed TRUE', () => {
  assert.deepEqual(
    formalCanaryPatchToNotionProperties({
      'Review Needed': '__YES__',
    }),
    {
      'Review Needed': { checkbox: true },
    }
  );
  assert.throws(
    () => formalCanaryPatchToNotionProperties({
      Status: 'Paused',
      'Review Needed': '__YES__',
    }),
    /may only set Review Needed/
  );
  assert.throws(
    () => formalCanaryPatchToNotionProperties({
      'Review Needed': '__NO__',
    }),
    /may only set Review Needed/
  );
});

test('first formal canary write uses one page PATCH with one checkbox', async () => {
  const requests = [];
  await updateFormalCanaryPage({
    pageId: FORMAL_CANARY_PAGE_ID,
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    notionApiKey: 'formal-write-token',
    patch: { 'Review Needed': '__YES__' },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ id: FORMAL_CANARY_PAGE_ID }),
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    `https://api.notion.com/v1/pages/${FORMAL_CANARY_PAGE_ID}`
  );
  assert.equal(requests[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    properties: {
      'Review Needed': { checkbox: true },
    },
  });
});
