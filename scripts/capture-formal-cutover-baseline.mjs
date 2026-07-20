#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { LOCATION_STATUSES } from '../src/csv-parser.js';
import { FORMAL_DATA_SOURCE_ID } from './location-verification-core.mjs';
import {
  FORMAL_FIELDS,
  notionPageToRow,
  queryAllNotionDataSourcePages,
} from './location-verification-runner.mjs';
import {
  canonicalFormalValue,
  validateFormalChangeApprovals,
} from './location-verification-validator.mjs';

export const FORMAL_DATABASE_ID = 'ec7c23158ea283fda548813eb677e2bd';
export const DEFAULT_PREVIOUS_BASELINE_URL = new URL(
  '../docs/location-verification-poc-baseline-20260719.json',
  import.meta.url
);
export const DEFAULT_APPROVALS_URL = new URL(
  '../docs/location-verification-formal-change-approvals.json',
  import.meta.url
);

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalFields(row, fieldNames) {
  return Object.fromEntries(
    fieldNames.map((field) => [
      field,
      canonicalFormalValue(field, row[field]),
    ])
  );
}

function equalValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameMembers(left, right) {
  const rightSet = new Set(right);
  return left.length === right.length && left.every((value) => rightSet.has(value));
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

export function formalPagesToRows(pages) {
  return pages.map((page) => {
    const dataSourceId = page.parent?.data_source_id;
    if (dataSourceId !== FORMAL_DATA_SOURCE_ID) {
      throw new Error(
        `Formal cutover query returned page ${page.id} from unexpected data source ${dataSourceId}`
      );
    }
    if (page.in_trash || page.archived) {
      throw new Error(`Formal cutover query returned archived page ${page.id}`);
    }
    return {
      ...notionPageToRow(page),
      __pageId: page.id,
      __pageUrl: page.url,
      __dataSourceId: dataSourceId,
    };
  });
}

export function buildFormalCutoverBaseline({
  formalRows,
  previousBaseline,
  previousBaselineSha256,
  formalChangeApprovals,
  expectedCount,
  allowedAddedSlugs,
  capturedAt,
  baselineId,
}) {
  if (!Number.isInteger(expectedCount) || expectedCount <= 0) {
    throw new Error('Formal cutover expectedCount must be a positive integer');
  }
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new Error('Formal cutover capturedAt must be an ISO timestamp');
  }
  if (typeof baselineId !== 'string' || !baselineId.trim()) {
    throw new Error('Formal cutover baselineId is required');
  }
  if (previousBaseline?.formalDataSourceId !== FORMAL_DATA_SOURCE_ID) {
    throw new Error('Previous baseline does not reference the allowlisted formal data source');
  }
  const fieldNames = previousBaseline.formalFieldNames;
  if (
    !Array.isArray(fieldNames) ||
    !sameMembers(fieldNames, FORMAL_FIELDS)
  ) {
    throw new Error('Previous baseline does not define the complete 17-field formal contract');
  }
  if (formalRows.length !== expectedCount) {
    throw new Error(
      `Formal cutover expected exactly ${expectedCount} rows; found ${formalRows.length}`
    );
  }

  const slugs = formalRows.map((row) => String(row.Slug || '').trim());
  if (slugs.some((slug) => !slug)) {
    throw new Error('Formal cutover contains an empty Slug');
  }
  const repeatedSlugs = duplicates(slugs);
  if (repeatedSlugs.length > 0) {
    throw new Error(`Formal cutover contains duplicate Slugs: ${repeatedSlugs.join(', ')}`);
  }
  const allowedStatuses = new Set(LOCATION_STATUSES);
  const invalidStatusRow = formalRows.find(
    (row) => !allowedStatuses.has(String(row.Status || '').trim())
  );
  if (invalidStatusRow) {
    throw new Error(
      `Formal cutover Slug ${invalidStatusRow.Slug} has unsupported status ` +
      `${invalidStatusRow.Status || '(blank)'}`
    );
  }
  const wrongSource = formalRows.find(
    (row) => row.__dataSourceId !== FORMAL_DATA_SOURCE_ID
  );
  if (wrongSource) {
    throw new Error(
      `Formal cutover Slug ${wrongSource.Slug} is not from the allowlisted formal data source`
    );
  }
  const invalidPageIdentity = formalRows.find((row) => {
    const pageId = String(row.__pageId || '').replaceAll('-', '').toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(pageId)) return true;
    try {
      return !['http:', 'https:'].includes(new URL(row.__pageUrl).protocol);
    } catch {
      return true;
    }
  });
  if (invalidPageIdentity) {
    throw new Error(
      `Formal cutover Slug ${invalidPageIdentity.Slug} has an invalid page identity`
    );
  }

  const approvalResult = validateFormalChangeApprovals({
    baseline: previousBaseline,
    formalChangeApprovals,
    baselineSha256: previousBaselineSha256,
  });
  if (approvalResult.issues.length > 0) {
    throw new Error(
      `Formal cutover approval chain is invalid: ` +
      approvalResult.issues.map((entry) => entry.code).join(', ')
    );
  }

  const previousBySlug = new Map(
    previousBaseline.rows.map((entry) => [entry.slug, entry])
  );
  const currentBySlug = new Map(formalRows.map((row) => [row.Slug, row]));
  const addedSlugs = [...currentBySlug.keys()]
    .filter((slug) => !previousBySlug.has(slug))
    .sort();
  const removedSlugs = [...previousBySlug.keys()]
    .filter((slug) => !currentBySlug.has(slug))
    .sort();
  const approvedAddedSlugs = [...new Set(allowedAddedSlugs || [])].sort();
  if (!equalValue(addedSlugs, approvedAddedSlugs)) {
    throw new Error(
      `Formal cutover added Slugs ${JSON.stringify(addedSlugs)} do not match ` +
      `the explicit allowlist ${JSON.stringify(approvedAddedSlugs)}`
    );
  }
  if (removedSlugs.length > 0) {
    throw new Error(
      `Formal cutover removed baseline Slugs without a deletion manifest: ${removedSlugs.join(', ')}`
    );
  }

  const unapprovedChanges = [];
  for (const [slug, previousEntry] of previousBySlug) {
    const current = currentBySlug.get(slug);
    if (!current) continue;
    const expected =
      approvalResult.effectiveFieldsBySlug.get(slug) || previousEntry.fields;
    const actualFields = canonicalFields(current, fieldNames);
    const expectedFields = canonicalFields(expected, fieldNames);
    for (const field of fieldNames) {
      if (!equalValue(actualFields[field], expectedFields[field])) {
        unapprovedChanges.push({ slug, field });
      }
    }
  }
  if (unapprovedChanges.length > 0) {
    throw new Error(
      `Formal cutover contains unapproved field drift: ` +
      unapprovedChanges.map(({ slug, field }) => `${slug}.${field}`).join(', ')
    );
  }

  const rows = formalRows
    .map((row) => ({
      slug: row.Slug,
      pageId: String(row.__pageId || '').replaceAll('-', '').toLowerCase(),
      pageUrl: row.__pageUrl || '',
      fields: canonicalFields(row, fieldNames),
    }))
    .sort((left, right) => {
      if (left.slug < right.slug) return -1;
      if (left.slug > right.slug) return 1;
      return 0;
    });
  const content = {
    formalDataSourceId: FORMAL_DATA_SOURCE_ID,
    formalFieldNames: fieldNames,
    rows,
  };

  return {
    schemaVersion: 1,
    baselineId,
    capturedAt,
    purpose:
      'Versioned read-only formal cutover baseline; does not authorize production mutation',
    formalDatabaseId: FORMAL_DATABASE_ID,
    formalDataSourceId: FORMAL_DATA_SOURCE_ID,
    formalFieldNames: fieldNames,
    rowCount: rows.length,
    contentSha256: sha256(JSON.stringify(content)),
    transition: {
      previousBaselineId: 'location-verification-poc-baseline-20260719',
      previousBaselineSha256,
      approvalManifestId: 'location-verification-formal-change-approvals',
      approvalCount: approvalResult.approvalCount,
      approvalIds: formalChangeApprovals.approvals.map(
        (approval) => approval.approvalId
      ),
      addedSlugs,
      removedSlugs,
      unapprovedFieldChanges: [],
    },
    rows,
  };
}

function parseArgs(args) {
  const options = {
    allowedAddedSlugs: [],
    output: null,
    verify: null,
    expectedCount: null,
    baselineId: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (
      [
        '--allow-added-slug',
        '--output',
        '--verify',
        '--expected-count',
        '--baseline-id',
      ].includes(arg) &&
      (!value || value.startsWith('--'))
    ) {
      throw new Error(`${arg} requires a value`);
    }
    if (arg === '--allow-added-slug') {
      options.allowedAddedSlugs.push(value);
      index += 1;
    } else if (arg === '--output') {
      options.output = value;
      index += 1;
    } else if (arg === '--verify') {
      options.verify = value;
      index += 1;
    } else if (arg === '--expected-count') {
      options.expectedCount = Number(value);
      index += 1;
    } else if (arg === '--baseline-id') {
      options.baselineId = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.output && !options.verify) {
    throw new Error('Use exactly one of --output or --verify');
  }
  if (options.output && options.verify) {
    throw new Error('Use exactly one of --output or --verify');
  }
  if (!Number.isInteger(options.expectedCount) || options.expectedCount <= 0) {
    throw new Error('--expected-count must be a positive integer');
  }
  if (!options.baselineId) {
    throw new Error('--baseline-id is required');
  }
  return options;
}

async function main() {
  const formalReadApiKey = process.env.NOTION_FORMAL_READ_API_KEY;
  if (!formalReadApiKey) {
    throw new Error(
      'Missing NOTION_FORMAL_READ_API_KEY; cutover capture is formal read-only'
    );
  }
  const options = parseArgs(process.argv.slice(2));
  const [previousBaselineRaw, approvalsRaw, pages] = await Promise.all([
    readFile(DEFAULT_PREVIOUS_BASELINE_URL, 'utf8'),
    readFile(DEFAULT_APPROVALS_URL, 'utf8'),
    queryAllNotionDataSourcePages({
      dataSourceId: FORMAL_DATA_SOURCE_ID,
      notionApiKey: formalReadApiKey,
    }),
  ]);
  const artifact = buildFormalCutoverBaseline({
    formalRows: formalPagesToRows(pages),
    previousBaseline: JSON.parse(previousBaselineRaw),
    previousBaselineSha256: sha256(previousBaselineRaw),
    formalChangeApprovals: JSON.parse(approvalsRaw),
    expectedCount: options.expectedCount,
    allowedAddedSlugs: options.allowedAddedSlugs,
    capturedAt: new Date().toISOString(),
    baselineId: options.baselineId,
  });

  if (options.verify) {
    const existing = JSON.parse(await readFile(options.verify, 'utf8'));
    if (
      existing.contentSha256 !== artifact.contentSha256 ||
      existing.formalDataSourceId !== artifact.formalDataSourceId ||
      existing.rowCount !== artifact.rowCount
    ) {
      throw new Error('Formal cutover baseline no longer matches the live read-only source');
    }
    console.log(
      `Verified ${artifact.rowCount} formal rows against ${options.verify}; ` +
      `${artifact.contentSha256}. No Notion write was performed.`
    );
    return;
  }

  await writeFile(
    options.output,
    `${JSON.stringify(artifact, null, 2)}\n`,
    { flag: 'wx' }
  );
  console.log(
    `Captured ${artifact.rowCount} formal rows to ${options.output}; ` +
    `${artifact.contentSha256}. No Notion write was performed.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
