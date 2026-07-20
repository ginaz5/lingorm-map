#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import {
  FORMAL_DATA_SOURCE_ID,
  assertAllowedDataSource,
} from './location-verification-core.mjs';
import {
  FORMAL_FIELDS,
  acquirePageApplyLock,
  fetchNotionPage,
  notionPageToRow,
  parsePageReference,
} from './location-verification-runner.mjs';
import { WORKFLOW_SCHEMA, verifyLiveCutoverBaseline } from './migrate-formal-location-schema.mjs';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2025-09-03';

export const FORMAL_CANARY_PAGE_ID = '3a2c23158ea281e7ae8bf62dd3244d26';
export const FORMAL_CANARY_SLUG = 'khlong-bang-luang-floating-market';
export const FORMAL_WORKFLOW_FIELDS = Object.freeze(
  Object.keys(WORKFLOW_SCHEMA)
);

function formalSnapshot(row) {
  return Object.fromEntries(FORMAL_FIELDS.map((field) => [field, row[field]]));
}

function workflowSnapshot(row) {
  return Object.fromEntries(
    FORMAL_WORKFLOW_FIELDS.map((field) => [field, row[field]])
  );
}

function assertVirginWorkflow(row) {
  const occupied = FORMAL_WORKFLOW_FIELDS.filter((field) => {
    if (field === 'Review Needed') return false;
    return String(row[field] || '').trim();
  });
  if (occupied.length > 0) {
    throw new Error(
      `Formal canary already has workflow content: ${occupied.join(', ')}`
    );
  }
}

export function planFormalCanaryInitialization({
  pageId,
  dataSourceId,
  row,
  inTrash = false,
}) {
  const normalizedPageId = parsePageReference(pageId);
  if (normalizedPageId !== FORMAL_CANARY_PAGE_ID) {
    throw new Error(
      `Refusing first formal canary for page ${normalizedPageId}; ` +
      `allowlisted page is ${FORMAL_CANARY_PAGE_ID}`
    );
  }
  assertAllowedDataSource(dataSourceId, FORMAL_DATA_SOURCE_ID);
  if (inTrash) {
    throw new Error('Refusing first formal canary for an archived or trashed page');
  }
  if (row.Slug !== FORMAL_CANARY_SLUG) {
    throw new Error(
      `Formal canary Slug must be ${FORMAL_CANARY_SLUG}; found ${row.Slug || '(blank)'}`
    );
  }
  if (row.Status !== 'Paused') {
    throw new Error(
      `Formal canary must remain Paused; found ${row.Status || '(blank)'}`
    );
  }
  assertVirginWorkflow(row);
  if (!['__YES__', '__NO__'].includes(row['Review Needed'])) {
    throw new Error('Formal canary Review Needed checkbox is unreadable');
  }

  const alreadyApplied = row['Review Needed'] === '__YES__';
  return {
    pageId: normalizedPageId,
    slug: row.Slug,
    name: row.Name,
    dataSourceId,
    beforeFormalSnapshot: formalSnapshot(row),
    beforeWorkflowSnapshot: workflowSnapshot(row),
    proposedPatch: alreadyApplied
      ? {}
      : { 'Review Needed': '__YES__' },
    rollbackPatch: { 'Review Needed': '__NO__' },
    alreadyApplied,
  };
}

export function formalCanaryPatchToNotionProperties(patch) {
  const fields = Object.keys(patch || {});
  if (
    fields.length !== 1 ||
    fields[0] !== 'Review Needed' ||
    patch['Review Needed'] !== '__YES__'
  ) {
    throw new Error(
      'First formal canary patch may only set Review Needed to __YES__'
    );
  }
  return {
    'Review Needed': { checkbox: true },
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

export async function updateFormalCanaryPage({
  pageId,
  dataSourceId,
  notionApiKey,
  patch,
  fetchImpl = fetch,
}) {
  if (!notionApiKey) throw new Error('Missing NOTION_FORMAL_WRITE_API_KEY');
  assertAllowedDataSource(dataSourceId, FORMAL_DATA_SOURCE_ID);
  const response = await fetchImpl(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      'Notion-Version': NOTION_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      properties: formalCanaryPatchToNotionProperties(patch),
    }),
  });
  return readJsonResponse(response, 'Formal canary page update');
}

async function readFormalCanary({
  pageId,
  formalReadApiKey,
  fetchImpl = fetch,
}) {
  const page = await fetchNotionPage({
    pageId,
    notionApiKey: formalReadApiKey,
    fetchImpl,
  });
  return {
    page,
    row: notionPageToRow(page),
    dataSourceId: page.parent?.data_source_id,
    inTrash: Boolean(page.in_trash || page.archived),
  };
}

function assertPreviewStillCurrent(current, preview) {
  const rebuilt = planFormalCanaryInitialization({
    pageId: current.page.id,
    dataSourceId: current.dataSourceId,
    row: current.row,
    inTrash: current.inTrash,
  });
  if (
    JSON.stringify(rebuilt.beforeFormalSnapshot) !==
      JSON.stringify(preview.beforeFormalSnapshot) ||
    JSON.stringify(rebuilt.beforeWorkflowSnapshot) !==
      JSON.stringify(preview.beforeWorkflowSnapshot) ||
    JSON.stringify(rebuilt.proposedPatch) !==
      JSON.stringify(preview.proposedPatch)
  ) {
    throw new Error(
      'Formal canary changed after preview; run the dry-run again'
    );
  }
}

function assertCanaryApplied(current, preview) {
  const afterFormal = formalSnapshot(current.row);
  if (
    JSON.stringify(afterFormal) !==
    JSON.stringify(preview.beforeFormalSnapshot)
  ) {
    const changed = FORMAL_FIELDS.filter(
      (field) =>
        JSON.stringify(afterFormal[field]) !==
        JSON.stringify(preview.beforeFormalSnapshot[field])
    );
    throw new Error(
      `Formal fields changed during canary initialization: ${changed.join(', ')}`
    );
  }
  if (current.row['Review Needed'] !== '__YES__') {
    throw new Error('Formal canary Review Needed write did not persist');
  }
  const changedWorkflowFields = FORMAL_WORKFLOW_FIELDS.filter((field) => {
    if (field === 'Review Needed') return false;
    return (
      JSON.stringify(current.row[field]) !==
      JSON.stringify(preview.beforeWorkflowSnapshot[field])
    );
  });
  if (changedWorkflowFields.length > 0) {
    throw new Error(
      `Unexpected formal workflow changes: ${changedWorkflowFields.join(', ')}`
    );
  }
}

export async function initializeFormalCanary({
  pageReference,
  formalReadApiKey,
  formalWriteApiKey = null,
  confirm = false,
  fetchImpl = fetch,
  onPreview = () => {},
}) {
  if (!formalReadApiKey) {
    throw new Error('Missing NOTION_FORMAL_READ_API_KEY');
  }
  const pageId = parsePageReference(pageReference);
  const [current, cutoverBefore] = await Promise.all([
    readFormalCanary({ pageId, formalReadApiKey, fetchImpl }),
    verifyLiveCutoverBaseline({
      notionApiKey: formalReadApiKey,
      fetchImpl,
    }),
  ]);
  const preview = planFormalCanaryInitialization({
    pageId: current.page.id,
    dataSourceId: current.dataSourceId,
    row: current.row,
    inTrash: current.inTrash,
  });
  await onPreview(preview);

  if (!confirm || preview.alreadyApplied) {
    return {
      mode: confirm ? 'confirm-noop' : 'dry-run',
      preview,
      cutoverBefore,
      cutoverAfter: cutoverBefore,
      formalFieldValuesUnchanged: true,
      readbackVerified: preview.alreadyApplied,
      pageWritePerformed: false,
      recoveredAfterResponseLoss: false,
    };
  }
  if (!formalWriteApiKey) {
    throw new Error('Missing NOTION_FORMAL_WRITE_API_KEY');
  }

  const lock = await acquirePageApplyLock({ pageId });
  let recoveredAfterResponseLoss = false;
  try {
    const beforeWrite = await readFormalCanary({
      pageId,
      formalReadApiKey,
      fetchImpl,
    });
    assertPreviewStillCurrent(beforeWrite, preview);

    try {
      await updateFormalCanaryPage({
        pageId,
        dataSourceId: beforeWrite.dataSourceId,
        notionApiKey: formalWriteApiKey,
        patch: preview.proposedPatch,
        fetchImpl,
      });
    } catch (error) {
      const recoveryRead = await readFormalCanary({
        pageId,
        formalReadApiKey,
        fetchImpl,
      });
      try {
        assertCanaryApplied(recoveryRead, preview);
        recoveredAfterResponseLoss = true;
      } catch {
        throw error;
      }
    }

    const [afterWrite, cutoverAfter] = await Promise.all([
      readFormalCanary({ pageId, formalReadApiKey, fetchImpl }),
      verifyLiveCutoverBaseline({
        notionApiKey: formalReadApiKey,
        fetchImpl,
      }),
    ]);
    assertCanaryApplied(afterWrite, preview);
    if (cutoverAfter.contentSha256 !== cutoverBefore.contentSha256) {
      throw new Error('Formal cutover hash changed during canary initialization');
    }
    return {
      mode: 'confirm',
      preview,
      cutoverBefore,
      cutoverAfter,
      formalFieldValuesUnchanged: true,
      readbackVerified: true,
      pageWritePerformed: true,
      recoveredAfterResponseLoss,
    };
  } finally {
    await lock.release();
  }
}

function parseArgs(args) {
  let pageReference = null;
  let mode = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--page') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--page requires a value');
      }
      pageReference = value;
      index += 1;
    } else if (['--dry-run', '--confirm'].includes(arg)) {
      if (mode) throw new Error('Use exactly one of --dry-run or --confirm');
      mode = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!pageReference) throw new Error('--page is required');
  if (!mode) throw new Error('Use exactly one of --dry-run or --confirm');
  return { pageReference, confirm: mode === '--confirm' };
}

function formatResult(result) {
  const preview = result.preview;
  return [
    `MODE=${result.mode}`,
    `PAGE_ID=${preview.pageId}`,
    `SLUG=${preview.slug}`,
    `NAME=${preview.name}`,
    `DATA_SOURCE_ID=${preview.dataSourceId}`,
    `BEFORE_STATUS=${preview.beforeFormalSnapshot.Status}`,
    `BEFORE_REVIEW_NEEDED=${preview.beforeWorkflowSnapshot['Review Needed']}`,
    `PROPOSED_PATCH=${JSON.stringify(preview.proposedPatch)}`,
    `ROLLBACK_PATCH=${JSON.stringify(preview.rollbackPatch)}`,
    `CUTOVER_CONTENT_SHA256_BEFORE=${result.cutoverBefore.contentSha256}`,
    `CUTOVER_CONTENT_SHA256_AFTER=${result.cutoverAfter.contentSha256}`,
    `FORMAL_FIELD_VALUES_UNCHANGED=${result.formalFieldValuesUnchanged}`,
    `READBACK_VERIFIED=${result.readbackVerified}`,
    `RECOVERED_AFTER_RESPONSE_LOSS=${result.recoveredAfterResponseLoss}`,
    `NOTION_SCHEMA_WRITE_PERFORMED=false`,
    `NOTION_PAGE_WRITE_PERFORMED=${result.pageWritePerformed}`,
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await initializeFormalCanary({
    ...args,
    formalReadApiKey: process.env.NOTION_FORMAL_READ_API_KEY,
    formalWriteApiKey: args.confirm
      ? process.env.NOTION_FORMAL_WRITE_API_KEY
      : null,
  });
  console.log(formatResult(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
