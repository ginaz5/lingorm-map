import { createHash } from 'node:crypto';

import {
  FORMAL_DATA_SOURCE_ID,
  POC_DATA_SOURCE_ID,
  REVIEW_DECISIONS,
  TARGET_STATUSES,
  basisRevision,
  buildStatusMigrationPatch,
  validateCandidatePayload,
  workflowRevision,
} from './location-verification-core.mjs';
import {
  FORMAL_PROPERTY_DROP_STATEMENTS,
  RETIRED_FORMAL_LOCATION_PROPERTIES,
  RETIRED_IMMUTABLE_FORMAL_FIELDS,
  formalPropertyRetirementPlanContent,
  sha256Json,
} from './formal-location-property-retirement-contract.mjs';
import {
  FORMAL_BASELINE_FIELDS_RETIRED_AFTER_20260720,
  FORMAL_PROPERTIES_RETIRED_AFTER_20260720,
} from './formal-location-current-schema.mjs';

export const EXPECTED_LOCATION_COUNT = 98;
export const TARGET_COORDINATE_TYPES = new Set([
  'Exact',
  'Entrance',
  'Representative',
  'Approximate',
]);

const ACTION_FORMAL_FIELDS = {
  'Accept Candidate': new Set([
    'Google Maps URL',
    'Google Place ID',
    'Status',
  ]),
  'Keep Current': new Set(['Status']),
  'Reject Candidate': new Set(),
  'Need Research': new Set(),
  'Could Not Find': new Set(['Status']),
  Deactivate: new Set(['Status']),
};

const ACTION_EXPECTED_STATUS = {
  'Accept Candidate': 'Published',
  'Keep Current': 'Published',
  'Could Not Find': 'Inactive',
  Deactivate: 'Inactive',
};

const FORMAL_APPROVAL_KEYS = new Set([
  'approvalId',
  'approvedAt',
  'approvedBy',
  'slug',
  'field',
  'fromValue',
  'approvedValue',
  'reason',
  'syncPoc',
]);
const FORMAL_CUTOVER_APPROVAL_MANIFEST_KEYS = new Set([
  'schemaVersion',
  'cutoverBaselineId',
  'cutoverContentSha256',
  'approvals',
]);

function issue(layer, code, message, { slug = null, field = null } = {}) {
  return { layer, code, slug, field, message };
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\r\n?/g, '\n')
    .trim()
    .normalize('NFC');
}

function normalizeMultiValue(value) {
  if (value === null || value === undefined || value === '') return [];
  let values = value;
  if (typeof values === 'string') {
    try {
      const parsed = JSON.parse(values);
      values = Array.isArray(parsed) ? parsed : [values];
    } catch {
      values = values.split(',');
    }
  }
  if (!Array.isArray(values)) values = [values];
  return [...new Set(values.map(normalizeText).filter(Boolean))].sort();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(7)) : value;
}

export function canonicalFormalValue(field, value) {
  if (field === 'Source Tags') return normalizeMultiValue(value);
  if (field === 'Lat' || field === 'Lng') return normalizeNumber(value);
  if (field === 'Coordinates Approx') {
    return value === '__YES__' ? '__YES__' : '__NO__';
  }
  return normalizeText(value);
}

function comparableFormalFields(row, formalFieldNames) {
  return Object.fromEntries(
    formalFieldNames.map((field) => [
      field,
      canonicalFormalValue(field, row[field]),
    ])
  );
}

function changedFormalFields(actual, expected, formalFieldNames) {
  const actualComparable = comparableFormalFields(actual, formalFieldNames);
  const expectedComparable = comparableFormalFields(expected, formalFieldNames);
  return formalFieldNames.filter(
    (field) =>
      JSON.stringify(actualComparable[field]) !==
      JSON.stringify(expectedComparable[field])
  );
}

export function parseApplyMetadata(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (!text.startsWith('lv1:')) {
    throw new Error('Apply Metadata must use the lv1: envelope');
  }
  let metadata;
  try {
    metadata = JSON.parse(text.slice('lv1:'.length));
  } catch {
    throw new Error('Apply Metadata is not valid JSON');
  }
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    metadata.schemaVersion !== 1
  ) {
    throw new Error('Unsupported Apply Metadata schema');
  }
  if (!String(metadata.actionRunId || '').startsWith('action-')) {
    throw new Error('Apply Metadata actionRunId is invalid');
  }
  if (!REVIEW_DECISIONS.has(metadata.decision)) {
    throw new Error('Apply Metadata decision is invalid');
  }
  if (!['pending', 'completed', 'failed'].includes(metadata.state)) {
    throw new Error('Apply Metadata state is invalid');
  }
  if (!String(metadata.basisRevision || '').startsWith('sha256:')) {
    throw new Error('Apply Metadata basisRevision is invalid');
  }
  if (!Number.isFinite(Date.parse(metadata.updatedAt))) {
    throw new Error('Apply Metadata updatedAt is invalid');
  }
  return metadata;
}

export function parseCandidatePayload(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (!text.startsWith('lv2:')) {
    throw new Error('Candidate Payload must use the lv2: envelope');
  }
  let payload;
  try {
    payload = JSON.parse(text.slice('lv2:'.length));
  } catch {
    throw new Error('Candidate Payload is not valid JSON');
  }
  return validateCandidatePayload(payload);
}

function validHttpUrl(value) {
  const text = normalizeText(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function rejectedPlaceIds(value) {
  return new Set(
    String(value || '')
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function rowLabel(row) {
  return normalizeText(row.Slug) || normalizeText(row.Name) || '(missing slug)';
}

function validateCoordinates(row, issues) {
  const slug = rowLabel(row);
  const hasLat = row.Lat !== null && row.Lat !== undefined && row.Lat !== '';
  const hasLng = row.Lng !== null && row.Lng !== undefined && row.Lng !== '';
  if (hasLat !== hasLng) {
    issues.push(
      issue(
        'target',
        'COORDINATE_PAIR_INCOMPLETE',
        'Lat and Lng must either both exist or both be blank',
        { slug }
      )
    );
    return;
  }
  if (!hasLat) return;
  const lat = Number(row.Lat);
  const lng = Number(row.Lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    issues.push(
      issue('target', 'LAT_INVALID', `Invalid latitude: ${row.Lat}`, {
        slug,
        field: 'Lat',
      })
    );
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    issues.push(
      issue('target', 'LNG_INVALID', `Invalid longitude: ${row.Lng}`, {
        slug,
        field: 'Lng',
      })
    );
  }
}

function validateCandidateLifecycle(row, metadata, issues) {
  const slug = rowLabel(row);
  const candidateText = normalizeText(row['Candidate Payload']);
  const hasCandidate = Boolean(candidateText);
  const hasSummary = Boolean(normalizeText(row['Candidate Summary']));
  const hasMapsUrl = Boolean(normalizeText(row['Candidate Maps URL']));
  const decision = normalizeText(row['Review Decision']);
  let payload = null;

  if (hasCandidate) {
    try {
      payload = parseCandidatePayload(candidateText);
    } catch (error) {
      issues.push(
        issue('target', 'CANDIDATE_PAYLOAD_INVALID', error.message, {
          slug,
          field: 'Candidate Payload',
        })
      );
    }
    if (row['Review Needed'] !== '__YES__') {
      issues.push(
        issue(
          'target',
          'CANDIDATE_WITHOUT_REVIEW',
          'Candidate Payload requires Review Needed = TRUE',
          { slug, field: 'Review Needed' }
        )
      );
    }
    if (!hasSummary) {
      issues.push(
        issue(
          'target',
          'CANDIDATE_SUMMARY_MISSING',
          'Candidate Payload requires Candidate Summary',
          { slug, field: 'Candidate Summary' }
        )
      );
    }
  } else {
    if (hasSummary || hasMapsUrl) {
      issues.push(
        issue(
          'target',
          'ORPHAN_CANDIDATE_DISPLAY',
          'Candidate Summary and Maps URL must be blank without Candidate Payload',
          { slug }
        )
      );
    }
    if (decision && decision !== 'Deactivate') {
      issues.push(
        issue(
          'target',
          'DECISION_WITHOUT_CANDIDATE',
          `${decision} requires Candidate Payload`,
          { slug, field: 'Review Decision' }
        )
      );
    }
  }

  if (decision && !REVIEW_DECISIONS.has(decision)) {
    issues.push(
      issue(
        'target',
        'REVIEW_DECISION_INVALID',
        `Unsupported Review Decision: ${decision}`,
        { slug, field: 'Review Decision' }
      )
    );
  }

  if (payload) {
    if (
      ['place_id_candidate', 'ambiguous'].includes(payload.result) !==
      hasMapsUrl
    ) {
      issues.push(
        issue(
          'target',
          'CANDIDATE_MAPS_URL_MISMATCH',
          `Candidate Maps URL does not match payload result=${payload.result}`,
          { slug, field: 'Candidate Maps URL' }
        )
      );
    }
    if (payload.basisRevision !== basisRevision(row)) {
      issues.push(
        issue(
          'target',
          'CANDIDATE_BASIS_STALE',
          'Candidate basisRevision does not match the current formal fields',
          { slug, field: 'Candidate Payload' }
        )
      );
    }
    const expectedWorkflowRevision = workflowRevision({
      status: row.Status,
      dataSourceId: row.__dataSourceId || POC_DATA_SOURCE_ID,
      inTrash: Boolean(row.__inTrash),
    });
    if (payload.workflowRevision !== expectedWorkflowRevision) {
      issues.push(
        issue(
          'target',
          'CANDIDATE_WORKFLOW_STALE',
          'Candidate workflowRevision does not match the current page state',
          { slug, field: 'Candidate Payload' }
        )
      );
    }
  }

  if (metadata?.state === 'completed' && metadata.decision === 'Need Research') {
    if (
      decision !== 'Need Research' ||
      !hasCandidate ||
      row['Review Needed'] !== '__YES__'
    ) {
      issues.push(
        issue(
          'target',
          'NEED_RESEARCH_STATE_INVALID',
          'Completed Need Research must retain Candidate, decision, and Review Needed',
          { slug }
        )
      );
    }
  }
}

function validateApplyMetadata(row, issues) {
  const slug = rowLabel(row);
  let metadata = null;
  try {
    metadata = parseApplyMetadata(row['Apply Metadata']);
  } catch (error) {
    issues.push(
      issue('target', 'APPLY_METADATA_INVALID', error.message, {
        slug,
        field: 'Apply Metadata',
      })
    );
    return null;
  }
  if (!metadata) return null;

  if (metadata.state !== 'completed') {
    issues.push(
      issue(
        'target',
        'APPLY_NOT_COMPLETED',
        `Apply Metadata state=${metadata.state}; operator recovery is required`,
        { slug, field: 'Apply Metadata' }
      )
    );
  }
  if (!normalizeText(row['Verification Note']).includes(metadata.actionRunId)) {
    issues.push(
      issue(
        'target',
        'ACTION_AUDIT_MISSING',
        `Verification Note does not contain ${metadata.actionRunId}`,
        { slug, field: 'Verification Note' }
      )
    );
  }

  const expectedStatus = ACTION_EXPECTED_STATUS[metadata.decision];
  if (expectedStatus && row.Status !== expectedStatus) {
    issues.push(
      issue(
        'target',
        'ACTION_STATUS_MISMATCH',
        `${metadata.decision} requires Status=${expectedStatus}`,
        { slug, field: 'Status' }
      )
    );
  }
  if (
    ['Reject Candidate', 'Need Research'].includes(metadata.decision) &&
    row['Review Needed'] !== '__YES__'
  ) {
    issues.push(
      issue(
        'target',
        'ACTION_REVIEW_QUEUE_MISMATCH',
        `${metadata.decision} requires Review Needed = TRUE`,
        { slug, field: 'Review Needed' }
      )
    );
  }
  if (
    ['Could Not Find', 'Deactivate'].includes(metadata.decision) &&
    row['Review Needed'] !== '__NO__'
  ) {
    issues.push(
      issue(
        'target',
        'ACTION_REVIEW_QUEUE_MISMATCH',
        `${metadata.decision} requires Review Needed = FALSE`,
        { slug, field: 'Review Needed' }
      )
    );
  }
  return metadata;
}

export function validateTargetRows(rows, { expectedCount = EXPECTED_LOCATION_COUNT } = {}) {
  const issues = [];
  const slugs = new Map();
  const placeIds = new Map();
  const statusCounts = {};

  if (rows.length !== expectedCount) {
    issues.push(
      issue(
        'target',
        'POC_COUNT_MISMATCH',
        `Expected ${expectedCount} PoC rows, found ${rows.length}`
      )
    );
  }

  for (const row of rows) {
    const slug = rowLabel(row);
    statusCounts[row.Status || '(blank)'] =
      (statusCounts[row.Status || '(blank)'] || 0) + 1;
    if (!normalizeText(row.Slug)) {
      issues.push(
        issue('target', 'SLUG_MISSING', 'Slug is required', {
          slug,
          field: 'Slug',
        })
      );
    } else {
      const duplicate = slugs.get(row.Slug);
      if (duplicate) {
        issues.push(
          issue(
            'target',
            'SLUG_DUPLICATE',
            `Duplicate Slug shared with ${rowLabel(duplicate)}`,
            { slug, field: 'Slug' }
          )
        );
      } else {
        slugs.set(row.Slug, row);
      }
    }
    if (!normalizeText(row.Name)) {
      issues.push(
        issue('target', 'NAME_MISSING', 'Name is required', {
          slug,
          field: 'Name',
        })
      );
    }
    if (!TARGET_STATUSES.has(row.Status)) {
      issues.push(
        issue(
          'target',
          'STATUS_INVALID',
          `Unsupported target Status: ${row.Status || '(blank)'}`,
          { slug, field: 'Status' }
        )
      );
    }

    validateCoordinates(row, issues);
    const metadata = validateApplyMetadata(row, issues);
    validateCandidateLifecycle(row, metadata, issues);

    const hasLat =
      row.Lat !== null &&
      row.Lat !== undefined &&
      row.Lat !== '' &&
      Number.isFinite(Number(row.Lat));
    const hasLng =
      row.Lng !== null &&
      row.Lng !== undefined &&
      row.Lng !== '' &&
      Number.isFinite(Number(row.Lng));
    if (row.Status === 'Published') {
      if (!hasLat || !hasLng) {
        issues.push(
          issue(
            'target',
            'PUBLISHED_COORDINATES_MISSING',
            'Published requires Lat and Lng',
            { slug }
          )
        );
      }
      if (
        !validHttpUrl(row['Google Maps URL']) &&
        !normalizeText(row['Google Place ID'])
      ) {
        issues.push(
          issue(
            'target',
            'PUBLISHED_MAP_REFERENCE_MISSING',
            'Published requires a valid Google Maps URL or Place ID',
            { slug }
          )
        );
      }
      if (!normalizeText(row['Verification Note'])) {
        issues.push(
          issue(
            'target',
            'PUBLISHED_NOTE_MISSING',
            'Published requires Verification Note',
            { slug, field: 'Verification Note' }
          )
        );
      }
      if (!normalizeText(row['Last Verified'])) {
        issues.push(
          issue(
            'target',
            'PUBLISHED_LAST_VERIFIED_MISSING',
            'Published requires Last Verified',
            { slug, field: 'Last Verified' }
          )
        );
      }
      if (
        normalizeText(row['Google Place ID']) &&
        !normalizeText(row['Place ID Checked At'])
      ) {
        issues.push(
          issue(
            'target',
            'PUBLISHED_PLACE_ID_CHECK_MISSING',
            'Published with Place ID requires Place ID Checked At',
            { slug, field: 'Place ID Checked At' }
          )
        );
      }
      if (!TARGET_COORDINATE_TYPES.has(row['Coordinate Type'])) {
        issues.push(
          issue(
            'target',
            'PUBLISHED_COORDINATE_TYPE_MISSING',
            'Published requires a supported Coordinate Type',
            { slug, field: 'Coordinate Type' }
          )
        );
      }
      if (!metadata || metadata.state !== 'completed') {
        issues.push(
          issue(
            'target',
            'PUBLISHED_ACTION_MISSING',
            'Published requires a completed human apply action',
            { slug, field: 'Apply Metadata' }
          )
        );
      }
    }

    if (row.Status === 'Paused' && row['Review Needed'] !== '__YES__') {
      issues.push(
        issue(
          'target',
          'QUEUE_STATUS_MISMATCH',
          `${row.Status} requires Review Needed = TRUE`,
          { slug, field: 'Review Needed' }
        )
      );
    }
    if (row.Status === 'Inactive') {
      if (row['Review Needed'] !== '__NO__') {
        issues.push(
          issue(
            'target',
            'INACTIVE_REVIEW_MISMATCH',
            'Inactive requires Review Needed = FALSE',
            { slug, field: 'Review Needed' }
          )
        );
      }
      if (
        !normalizeText(row['Last Verified']) ||
        !normalizeText(row['Verification Note'])
      ) {
        issues.push(
          issue(
            'target',
            'INACTIVE_AUDIT_MISSING',
            'Inactive requires Last Verified and Verification Note',
            { slug }
          )
        );
      }
    }

    const placeId = normalizeText(row['Google Place ID']);
    if (placeId) {
      const duplicate = placeIds.get(placeId);
      if (duplicate) {
        issues.push(
          issue(
            'target',
            'PLACE_ID_DUPLICATE',
            `Google Place ID is also used by ${rowLabel(duplicate)}`,
            { slug, field: 'Google Place ID' }
          )
        );
      } else {
        placeIds.set(placeId, row);
      }
    }

    if (placeId && rejectedPlaceIds(row['Rejected Place IDs']).has(placeId)) {
      const hasOverride =
        metadata?.state === 'completed' &&
        metadata.decision === 'Reject Candidate' &&
        normalizeText(row['Verification Note']).includes(metadata.actionRunId);
      if (!hasOverride) {
        issues.push(
          issue(
            'target',
            'CURRENT_PLACE_ID_REJECTED',
            'Current Google Place ID appears in Rejected Place IDs without a completed manual override',
            { slug, field: 'Rejected Place IDs' }
          )
        );
      }
    }
  }

  return { issues, statusCounts };
}

function rowsBySlug(rows) {
  const map = new Map();
  const duplicates = new Set();
  for (const row of rows) {
    const slug = normalizeText(row.Slug);
    if (!slug) continue;
    if (map.has(slug)) duplicates.add(slug);
    else map.set(slug, row);
  }
  return { map, duplicates };
}

function baselineBySlug(baseline) {
  return new Map(
    (baseline.rows || []).map((entry) => [normalizeText(entry.slug), entry])
  );
}

function canonicalValuesEqual(field, left, right) {
  return (
    JSON.stringify(canonicalFormalValue(field, left)) ===
    JSON.stringify(canonicalFormalValue(field, right))
  );
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value || {});
  return (
    actualKeys.length === expectedKeys.size &&
    actualKeys.every((key) => expectedKeys.has(key))
  );
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateFormalCutoverBaseline({
  baseline,
  formalCutoverBaseline = null,
  baselineSha256 = null,
}) {
  const issues = [];
  if (formalCutoverBaseline === null) {
    return {
      issues,
      formalBaseline: baseline,
      addedSlugs: [],
    };
  }
  if (
    !formalCutoverBaseline ||
    typeof formalCutoverBaseline !== 'object' ||
    Array.isArray(formalCutoverBaseline) ||
    formalCutoverBaseline.schemaVersion !== 1
  ) {
    issues.push(
      issue(
        'baseline',
        'FORMAL_CUTOVER_BASELINE_INVALID',
        'Formal cutover baseline must use schemaVersion 1'
      )
    );
    return {
      issues,
      formalBaseline: baseline,
      addedSlugs: [],
    };
  }
  if (
    formalCutoverBaseline.formalDataSourceId !== FORMAL_DATA_SOURCE_ID
  ) {
    issues.push(
      issue(
        'baseline',
        'FORMAL_CUTOVER_SOURCE_MISMATCH',
        'Formal cutover baseline points to an unexpected data source'
      )
    );
  }
  if (
    !equalJson(
      formalCutoverBaseline.formalFieldNames,
      baseline.formalFieldNames
    )
  ) {
    issues.push(
      issue(
        'baseline',
        'FORMAL_CUTOVER_FIELDS_MISMATCH',
        'Formal cutover baseline fields do not match the immutable baseline'
      )
    );
  }
  if (
    !baselineSha256 ||
    formalCutoverBaseline.transition?.previousBaselineSha256 !==
      baselineSha256
  ) {
    issues.push(
      issue(
        'baseline',
        'FORMAL_CUTOVER_PREVIOUS_HASH_MISMATCH',
        'Formal cutover baseline is not linked to the current immutable baseline'
      )
    );
  }

  const rows = Array.isArray(formalCutoverBaseline.rows)
    ? formalCutoverBaseline.rows
    : [];
  if (
    rows.length !== formalCutoverBaseline.rowCount ||
    rows.length < (baseline.rows?.length || 0)
  ) {
    issues.push(
      issue(
        'baseline',
        'FORMAL_CUTOVER_COUNT_MISMATCH',
        'Formal cutover baseline rowCount does not match its rows'
      )
    );
  }
  const content = {
    formalDataSourceId: formalCutoverBaseline.formalDataSourceId,
    formalFieldNames: formalCutoverBaseline.formalFieldNames,
    rows,
  };
  const contentSha256 = `sha256:${createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex')}`;
  if (formalCutoverBaseline.contentSha256 !== contentSha256) {
    issues.push(
      issue(
        'baseline',
        'FORMAL_CUTOVER_CONTENT_HASH_MISMATCH',
        'Formal cutover baseline content hash does not match its rows'
      )
    );
  }

  const immutableMap = baselineBySlug(baseline);
  const cutoverMap = new Map();
  const duplicateSlugs = new Set();
  for (const entry of rows) {
    const slug = normalizeText(entry?.slug);
    if (!slug || normalizeText(entry?.fields?.Slug) !== slug) {
      issues.push(
        issue(
          'baseline',
          'FORMAL_CUTOVER_SLUG_INVALID',
          'Formal cutover row Slug must match fields.Slug',
          { slug: slug || null }
        )
      );
      continue;
    }
    if (cutoverMap.has(slug)) duplicateSlugs.add(slug);
    else cutoverMap.set(slug, entry);
  }
  for (const slug of duplicateSlugs) {
    issues.push(
      issue(
        'baseline',
        'FORMAL_CUTOVER_SLUG_DUPLICATE',
        'Formal cutover baseline contains a duplicate Slug',
        { slug }
      )
    );
  }

  const removedSlugs = [...immutableMap.keys()]
    .filter((slug) => !cutoverMap.has(slug))
    .sort();
  const addedSlugs = [...cutoverMap.keys()]
    .filter((slug) => !immutableMap.has(slug))
    .sort();
  const declaredAddedSlugs = [
    ...new Set(
      Array.isArray(formalCutoverBaseline.transition?.addedSlugs)
        ? formalCutoverBaseline.transition.addedSlugs.map(normalizeText)
        : []
    ),
  ].sort();
  const declaredRemovedSlugs = [
    ...new Set(
      Array.isArray(formalCutoverBaseline.transition?.removedSlugs)
        ? formalCutoverBaseline.transition.removedSlugs.map(normalizeText)
        : []
    ),
  ].sort();
  if (!equalJson(addedSlugs, declaredAddedSlugs)) {
    issues.push(
      issue(
        'baseline',
        'FORMAL_CUTOVER_ADDITIONS_MISMATCH',
        'Formal cutover added Slugs do not match its transition allowlist'
      )
    );
  }
  if (removedSlugs.length > 0 || declaredRemovedSlugs.length > 0) {
    issues.push(
      issue(
        'baseline',
        'FORMAL_CUTOVER_REMOVAL_FORBIDDEN',
        'Formal cutover baseline may not remove immutable Slugs'
      )
    );
  }

  if (issues.length > 0) {
    return {
      issues,
      formalBaseline: baseline,
      addedSlugs: [],
    };
  }
  return {
    issues,
    formalBaseline: {
      ...baseline,
      rows: [
        ...baseline.rows,
        ...addedSlugs.map((slug) => cutoverMap.get(slug)),
      ],
    },
    addedSlugs,
  };
}

export function validateFormalChangeApprovals({
  baseline,
  formalChangeApprovals = null,
  baselineSha256 = null,
}) {
  const issues = [];
  const effectiveFieldsBySlug = new Map(
    (baseline.rows || []).map((entry) => [
      normalizeText(entry.slug),
      { ...entry.fields },
    ])
  );
  if (formalChangeApprovals === null) {
    return {
      issues,
      effectiveFieldsBySlug,
      approvalCount: 0,
    };
  }
  if (
    !formalChangeApprovals ||
    typeof formalChangeApprovals !== 'object' ||
    Array.isArray(formalChangeApprovals) ||
    !hasExactKeys(
      formalChangeApprovals,
      new Set(['schemaVersion', 'baselineSha256', 'approvals'])
    )
  ) {
    issues.push(
      issue(
        'approvals',
        'FORMAL_APPROVAL_MANIFEST_INVALID',
        'Formal approval manifest must contain only schemaVersion, baselineSha256, and approvals'
      )
    );
    return {
      issues,
      effectiveFieldsBySlug,
      approvalCount: 0,
    };
  }
  if (formalChangeApprovals.schemaVersion !== 1) {
    issues.push(
      issue(
        'approvals',
        'FORMAL_APPROVAL_SCHEMA_UNSUPPORTED',
        'Formal approval manifest schemaVersion must be 1'
      )
    );
  }
  if (
    !baselineSha256 ||
    formalChangeApprovals.baselineSha256 !== baselineSha256
  ) {
    issues.push(
      issue(
        'approvals',
        'FORMAL_APPROVAL_BASELINE_HASH_MISMATCH',
        'Formal approval manifest is not bound to the current immutable baseline'
      )
    );
  }
  if (!Array.isArray(formalChangeApprovals.approvals)) {
    issues.push(
      issue(
        'approvals',
        'FORMAL_APPROVAL_LIST_INVALID',
        'Formal approval manifest approvals must be an array'
      )
    );
    return {
      issues,
      effectiveFieldsBySlug,
      approvalCount: 0,
    };
  }

  const baselineMap = baselineBySlug(baseline);
  const approvalIds = new Set();
  let approvalCount = 0;
  for (const approval of formalChangeApprovals.approvals) {
    const slug = normalizeText(approval?.slug);
    const field = normalizeText(approval?.field);
    const issueCountBefore = issues.length;
    if (
      !approval ||
      typeof approval !== 'object' ||
      Array.isArray(approval) ||
      !hasExactKeys(approval, FORMAL_APPROVAL_KEYS)
    ) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_APPROVAL_INVALID',
          'Each formal approval must use the exact version 1 property set',
          { slug, field }
        )
      );
      continue;
    }
    if (!/^formal-change-[a-z0-9-]+$/.test(approval.approvalId || '')) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_APPROVAL_ID_INVALID',
          'Formal approvalId must start with formal-change-',
          { slug, field }
        )
      );
    } else if (approvalIds.has(approval.approvalId)) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_APPROVAL_ID_DUPLICATE',
          `Duplicate formal approvalId ${approval.approvalId}`,
          { slug, field }
        )
      );
    } else {
      approvalIds.add(approval.approvalId);
    }
    if (!Number.isFinite(Date.parse(approval.approvedAt))) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_APPROVAL_TIME_INVALID',
          'Formal approvedAt must be an ISO timestamp',
          { slug, field }
        )
      );
    }
    if (!normalizeText(approval.approvedBy)) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_APPROVAL_ACTOR_MISSING',
          'Formal approvedBy is required',
          { slug, field }
        )
      );
    }
    if (!normalizeText(approval.reason)) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_APPROVAL_REASON_MISSING',
          'Formal approval reason is required',
          { slug, field }
        )
      );
    }
    if (approval.syncPoc !== false) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_APPROVAL_POC_SYNC_FORBIDDEN',
          'Formal approval must keep syncPoc=false in Phase A',
          { slug, field }
        )
      );
    }

    const baselineEntry = baselineMap.get(slug);
    if (!baselineEntry) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_APPROVAL_SLUG_UNKNOWN',
          'Formal approval Slug is not present in the immutable baseline',
          { slug, field }
        )
      );
    }
    if (
      !baseline.formalFieldNames?.includes(field) ||
      field === 'Slug'
    ) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_APPROVAL_FIELD_INVALID',
          'Formal approval field must be a non-Slug formal field',
          { slug, field }
        )
      );
    }
    const effectiveFields = effectiveFieldsBySlug.get(slug);
    if (
      effectiveFields &&
      baseline.formalFieldNames?.includes(field) &&
      !canonicalValuesEqual(field, approval.fromValue, effectiveFields[field])
    ) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_APPROVAL_CHAIN_MISMATCH',
          'Formal approval fromValue does not match the preceding approved value',
          { slug, field }
        )
      );
    }
    if (
      baseline.formalFieldNames?.includes(field) &&
      canonicalValuesEqual(field, approval.fromValue, approval.approvedValue)
    ) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_APPROVAL_NO_CHANGE',
          'Formal approval must change the canonical field value',
          { slug, field }
        )
      );
    }

    if (issues.length === issueCountBefore && effectiveFields) {
      effectiveFields[field] = approval.approvedValue;
      approvalCount += 1;
    }
  }

  return {
    issues,
    effectiveFieldsBySlug,
    approvalCount,
  };
}

export function validateFormalCutoverChangeApprovals({
  formalCutoverBaseline = null,
  addedBaselineRows = [],
  formalCutoverChangeApprovals = null,
}) {
  const baseline = {
    formalFieldNames: formalCutoverBaseline?.formalFieldNames || [],
    rows: addedBaselineRows,
  };
  if (formalCutoverChangeApprovals === null) {
    return validateFormalChangeApprovals({ baseline });
  }

  const issues = [];
  if (
    !formalCutoverChangeApprovals ||
    typeof formalCutoverChangeApprovals !== 'object' ||
    Array.isArray(formalCutoverChangeApprovals) ||
    !hasExactKeys(
      formalCutoverChangeApprovals,
      FORMAL_CUTOVER_APPROVAL_MANIFEST_KEYS
    )
  ) {
    issues.push(
      issue(
        'approvals',
        'FORMAL_CUTOVER_APPROVAL_MANIFEST_INVALID',
        'Formal cutover approval manifest must contain only schemaVersion, cutoverBaselineId, cutoverContentSha256, and approvals'
      )
    );
  } else {
    if (formalCutoverChangeApprovals.schemaVersion !== 1) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_CUTOVER_APPROVAL_SCHEMA_UNSUPPORTED',
          'Formal cutover approval manifest schemaVersion must be 1'
        )
      );
    }
    if (
      formalCutoverChangeApprovals.cutoverBaselineId !==
      formalCutoverBaseline?.baselineId
    ) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_CUTOVER_APPROVAL_BASELINE_ID_MISMATCH',
          'Formal cutover approval manifest is not bound to the current cutover baseline ID'
        )
      );
    }
    if (
      formalCutoverChangeApprovals.cutoverContentSha256 !==
      formalCutoverBaseline?.contentSha256
    ) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_CUTOVER_APPROVAL_CONTENT_HASH_MISMATCH',
          'Formal cutover approval manifest is not bound to the current cutover content hash'
        )
      );
    }
    if (!Array.isArray(formalCutoverChangeApprovals.approvals)) {
      issues.push(
        issue(
          'approvals',
          'FORMAL_CUTOVER_APPROVAL_LIST_INVALID',
          'Formal cutover approval manifest approvals must be an array'
        )
      );
    }
  }
  if (issues.length > 0) {
    const fallback = validateFormalChangeApprovals({ baseline });
    return {
      ...fallback,
      issues,
    };
  }

  const chain = validateFormalChangeApprovals({
    baseline,
    baselineSha256: formalCutoverBaseline.contentSha256,
    formalChangeApprovals: {
      schemaVersion: 1,
      baselineSha256:
        formalCutoverChangeApprovals.cutoverContentSha256,
      approvals: formalCutoverChangeApprovals.approvals,
    },
  });
  return chain;
}

function notionPageId(value) {
  const withoutQuery = normalizeText(value)
    .split(/[?#]/, 1)[0]
    .replace(/\/+$/, '')
    .toLowerCase();
  const finalSegment = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  const compact = finalSegment.replaceAll('-', '');
  return compact.match(/[0-9a-f]{32}$/)?.[0] || null;
}

export function validateSlugIntegrity({
  baseline,
  formalBaseline = baseline,
  pocRows,
  formalRows,
  expectedCount = EXPECTED_LOCATION_COUNT,
}) {
  const issues = [];
  const baselineMap = baselineBySlug(baseline);
  const formalBaselineMap = baselineBySlug(formalBaseline);
  const pocIndex = rowsBySlug(pocRows);
  const formalIndex = rowsBySlug(formalRows);
  const pocMap = pocIndex.map;
  const formalMap = formalIndex.map;

  if (baseline.rows?.length !== expectedCount || baselineMap.size !== expectedCount) {
    issues.push(
      issue(
        'slug',
        'BASELINE_SLUG_SET_INVALID',
        `Baseline must contain ${expectedCount} unique Slugs`
      )
    );
  }
  for (const slug of pocIndex.duplicates) {
    issues.push(
      issue('slug', 'POC_SLUG_DUPLICATE', 'PoC contains duplicate Slug', {
        slug,
      })
    );
  }
  for (const slug of formalIndex.duplicates) {
    issues.push(
      issue(
        'slug',
        'FORMAL_SLUG_DUPLICATE',
        'Formal Locations contains duplicate Slug',
        { slug }
      )
    );
  }

  for (const [slug, baselineEntry] of baselineMap) {
    const poc = pocMap.get(slug);
    const formal = formalMap.get(slug);
    if (!poc) {
      issues.push(
        issue('slug', 'POC_SLUG_MISSING', 'PoC is missing baseline Slug', {
          slug,
        })
      );
    } else if (
      normalizeText(baselineEntry.pageUrl) &&
      notionPageId(poc.__pageId || poc.__pageUrl) !==
        notionPageId(baselineEntry.pageUrl)
    ) {
      issues.push(
        issue(
          'slug',
          'POC_PAGE_ID_DRIFT',
          'PoC Slug now points to a different Notion page',
          { slug }
        )
      );
    }
    if (!formal && formalBaselineMap.has(slug)) {
      issues.push(
        issue(
          'slug',
          'FORMAL_SLUG_MISSING',
          'Formal Locations is missing baseline Slug',
          { slug }
        )
      );
    }
  }
  for (const slug of formalBaselineMap.keys()) {
    if (!formalMap.has(slug) && !baselineMap.has(slug)) {
      issues.push(
        issue(
          'slug',
          'FORMAL_SLUG_MISSING',
          'Formal Locations is missing approved cutover Slug',
          { slug }
        )
      );
    }
  }
  for (const slug of pocMap.keys()) {
    if (!baselineMap.has(slug)) {
      issues.push(
        issue('slug', 'POC_SLUG_UNEXPECTED', 'PoC has an unexpected Slug', {
          slug,
        })
      );
    }
  }
  for (const slug of formalMap.keys()) {
    if (!formalBaselineMap.has(slug)) {
      issues.push(
        issue(
          'slug',
          'FORMAL_SLUG_UNEXPECTED',
          'Formal Locations has an unexpected Slug',
          { slug }
        )
      );
    }
  }
  return { issues };
}

export function reconcileFormalRows({
  baseline,
  formalRows,
  effectiveFieldsBySlug = null,
  retiredFormalFields = [],
}) {
  const issues = [];
  const baselineMap = baselineBySlug(baseline);
  const formalMap = rowsBySlug(formalRows).map;
  const retired = new Set(retiredFormalFields);
  const activeFormalFieldNames = baseline.formalFieldNames.filter(
    (field) => !retired.has(field)
  );
  let differenceCount = 0;
  let observedDifferenceCount = 0;
  let approvedDifferenceCount = 0;

  for (const [slug, entry] of baselineMap) {
    const row = formalMap.get(slug);
    if (!row) continue;
    const expected =
      effectiveFieldsBySlug?.get(slug) || entry.fields;
    observedDifferenceCount += changedFormalFields(
      row,
      entry.fields,
      activeFormalFieldNames
    ).length;
    approvedDifferenceCount += changedFormalFields(
      expected,
      entry.fields,
      activeFormalFieldNames
    ).length;
    const changed = changedFormalFields(
      row,
      expected,
      activeFormalFieldNames
    );
    differenceCount += changed.length;
    for (const field of changed) {
      issues.push(
        issue(
          'formal',
          'FORMAL_BASELINE_DRIFT',
          `Formal Locations differs from the immutable baseline plus approved changes in ${field}`,
          { slug, field }
        )
      );
    }
  }
  return {
    issues,
    differenceCount,
    observedDifferenceCount,
    approvedDifferenceCount,
  };
}

export function validateFormalPropertyRetirement({
  formalCutoverBaseline,
  formalPropertyRetirement = null,
}) {
  const issues = [];
  if (formalPropertyRetirement === null) {
    return {
      issues,
      retiredFormalFields: new Set(),
      retiredPropertyCount: 0,
    };
  }

  const artifact = formalPropertyRetirement;
  if (
    !artifact ||
    typeof artifact !== 'object' ||
    Array.isArray(artifact) ||
    artifact.schemaVersion !== 1
  ) {
    issues.push(
      issue(
        'retirement',
        'FORMAL_PROPERTY_RETIREMENT_INVALID',
        'Formal property retirement contract must use schemaVersion 1'
      )
    );
  }
  if (artifact?.formalDataSourceId !== FORMAL_DATA_SOURCE_ID) {
    issues.push(
      issue(
        'retirement',
        'FORMAL_PROPERTY_RETIREMENT_SOURCE_MISMATCH',
        'Formal property retirement contract points to an unexpected data source'
      )
    );
  }
  if (
    artifact?.sourceCutoverBaselineId !==
      formalCutoverBaseline?.baselineId ||
    artifact?.sourceCutoverContentSha256 !==
      formalCutoverBaseline?.contentSha256
  ) {
    issues.push(
      issue(
        'retirement',
        'FORMAL_PROPERTY_RETIREMENT_BASELINE_MISMATCH',
        'Formal property retirement contract is not bound to the active cutover baseline'
      )
    );
  }
  if (
    !equalJson(
      artifact?.retiredProperties,
      RETIRED_FORMAL_LOCATION_PROPERTIES
    )
  ) {
    issues.push(
      issue(
        'retirement',
        'FORMAL_PROPERTY_RETIREMENT_FIELDS_MISMATCH',
        'Formal property retirement contract does not contain the exact approved field list'
      )
    );
  }
  if (artifact?.dropStatements !== FORMAL_PROPERTY_DROP_STATEMENTS) {
    issues.push(
      issue(
        'retirement',
        'FORMAL_PROPERTY_RETIREMENT_DDL_MISMATCH',
        'Formal property retirement DDL is not the exact approved DROP list'
      )
    );
  }
  if (!Array.isArray(artifact?.pagePatches)) {
    issues.push(
      issue(
        'retirement',
        'FORMAL_PROPERTY_RETIREMENT_PATCHES_INVALID',
        'Formal property retirement pagePatches must be an array'
      )
    );
  } else if (artifact.pagePatches.length > 0) {
    issues.push(
      issue(
        'retirement',
        'FORMAL_PROPERTY_RETIREMENT_PATCHES_PENDING',
        'Formal property retirement cannot activate while page patches remain pending'
      )
    );
  }

  const archive = artifact?.archive;
  const archiveRows = Array.isArray(archive?.rows) ? archive.rows : [];
  if (
    archive?.formalDataSourceId !== FORMAL_DATA_SOURCE_ID ||
    !equalJson(
      archive?.retiredProperties,
      RETIRED_FORMAL_LOCATION_PROPERTIES
    ) ||
    archive?.rowCount !== archiveRows.length
  ) {
    issues.push(
      issue(
        'retirement',
        'FORMAL_PROPERTY_RETIREMENT_ARCHIVE_INVALID',
        'Formal property retirement archive metadata is invalid'
      )
    );
  }
  if (artifact?.archiveSha256 !== sha256Json(archive)) {
    issues.push(
      issue(
        'retirement',
        'FORMAL_PROPERTY_RETIREMENT_ARCHIVE_HASH_MISMATCH',
        'Formal property retirement archive hash does not match its content'
      )
    );
  }

  const archivedSlugs = [];
  for (const entry of archiveRows) {
    const slug = normalizeText(entry?.slug);
    archivedSlugs.push(slug);
    if (
      !slug ||
      !entry?.pageId ||
      !entry?.pageUrl ||
      !entry?.properties ||
      RETIRED_FORMAL_LOCATION_PROPERTIES.some(
        (property) => !Object.hasOwn(entry.properties, property)
      )
    ) {
      issues.push(
        issue(
          'retirement',
          'FORMAL_PROPERTY_RETIREMENT_ARCHIVE_ROW_INVALID',
          'Each archive row must preserve its identity and all retired properties',
          { slug: slug || null }
        )
      );
    }
  }
  const expectedSlugs = (formalCutoverBaseline?.rows || [])
    .map((entry) => normalizeText(entry.slug))
    .sort();
  const actualSlugs = archivedSlugs.sort();
  if (
    new Set(actualSlugs).size !== actualSlugs.length ||
    !equalJson(actualSlugs, expectedSlugs)
  ) {
    issues.push(
      issue(
        'retirement',
        'FORMAL_PROPERTY_RETIREMENT_ARCHIVE_COVERAGE_MISMATCH',
        'Formal property retirement archive does not cover the cutover baseline Slugs exactly'
      )
    );
  }
  if (
    artifact?.planSha256 !==
    sha256Json(formalPropertyRetirementPlanContent(artifact))
  ) {
    issues.push(
      issue(
        'retirement',
        'FORMAL_PROPERTY_RETIREMENT_PLAN_HASH_MISMATCH',
        'Formal property retirement plan hash does not match the exact archive and DROP plan'
      )
    );
  }

  return {
    issues,
    retiredFormalFields:
      issues.length === 0
        ? new Set(RETIRED_IMMUTABLE_FORMAL_FIELDS)
        : new Set(),
    retiredPropertyCount:
      issues.length === 0 ? RETIRED_FORMAL_LOCATION_PROPERTIES.length : 0,
  };
}

function migratedFormalFields(fields) {
  const migrated = { ...fields };
  migrated.Status = buildStatusMigrationPatch(fields).Status;
  return migrated;
}

export function reconcilePocRows({ baseline, pocRows }) {
  const issues = [];
  const baselineMap = baselineBySlug(baseline);
  const pocMap = rowsBySlug(pocRows).map;
  let migrationDifferenceCount = 0;
  let actionDifferenceCount = 0;

  for (const [slug, entry] of baselineMap) {
    const row = pocMap.get(slug);
    if (!row) continue;
    const migrated = migratedFormalFields(entry.fields);
    migrationDifferenceCount += changedFormalFields(
      entry.fields,
      migrated,
      baseline.formalFieldNames
    ).length;
    const changed = changedFormalFields(
      row,
      migrated,
      baseline.formalFieldNames
    );
    if (changed.length === 0) continue;
    actionDifferenceCount += changed.length;

    let metadata = null;
    try {
      metadata = parseApplyMetadata(row['Apply Metadata']);
    } catch {
      // Target validation reports the detailed metadata error.
    }
    if (!metadata || metadata.state !== 'completed') {
      for (const field of changed) {
        issues.push(
          issue(
            'poc',
            'POC_DIFFERENCE_UNTRACED',
            `${field} differs from the conservative migration without a completed action`,
            { slug, field }
          )
        );
      }
      continue;
    }
    if (!normalizeText(row['Verification Note']).includes(metadata.actionRunId)) {
      issues.push(
        issue(
          'poc',
          'POC_ACTION_AUDIT_MISSING',
          `Verification Note does not contain ${metadata.actionRunId}`,
          { slug, field: 'Verification Note' }
        )
      );
    }

    const allowedFields = ACTION_FORMAL_FIELDS[metadata.decision] || new Set();
    for (const field of changed) {
      if (!allowedFields.has(field)) {
        issues.push(
          issue(
            'poc',
            'POC_DIFFERENCE_NOT_ALLOWED',
            `${metadata.decision} cannot change formal field ${field}`,
            { slug, field }
          )
        );
      }
    }
    const expectedStatus =
      ACTION_EXPECTED_STATUS[metadata.decision] || migrated.Status;
    if (changed.includes('Status') && row.Status !== expectedStatus) {
      issues.push(
        issue(
          'poc',
          'POC_ACTION_STATUS_INVALID',
          `${metadata.decision} does not justify Status=${row.Status}`,
          { slug, field: 'Status' }
        )
      );
    }
  }

  return {
    issues,
    migrationDifferenceCount,
    actionDifferenceCount,
  };
}

export function validateAllData({
  baseline,
  pocRows,
  formalRows,
  formalChangeApprovals = null,
  formalCutoverBaseline = null,
  formalCutoverChangeApprovals = null,
  formalPropertyRetirement = null,
  baselineSha256 = null,
  expectedCount = EXPECTED_LOCATION_COUNT,
}) {
  const baselineIssues = [];
  if (baseline.pocDataSourceId !== POC_DATA_SOURCE_ID) {
    baselineIssues.push(
      issue(
        'baseline',
        'BASELINE_POC_SOURCE_MISMATCH',
        `Baseline PoC data source ${baseline.pocDataSourceId} is not ${POC_DATA_SOURCE_ID}`
      )
    );
  }
  if (baseline.formalDataSourceId !== FORMAL_DATA_SOURCE_ID) {
    baselineIssues.push(
      issue(
        'baseline',
        'BASELINE_FORMAL_SOURCE_MISMATCH',
        `Baseline formal data source ${baseline.formalDataSourceId} is not ${FORMAL_DATA_SOURCE_ID}`
      )
    );
  }
  if (baseline.formalCount !== expectedCount || baseline.pocCount !== expectedCount) {
    baselineIssues.push(
      issue(
        'baseline',
        'BASELINE_COUNT_MISMATCH',
        `Baseline counts must both be ${expectedCount}`
      )
    );
  }
  if (
    !Array.isArray(baseline.formalFieldNames) ||
    baseline.formalFieldNames.length !== 17
  ) {
    baselineIssues.push(
      issue(
        'baseline',
        'BASELINE_FIELDS_INVALID',
        'Baseline must define exactly 17 formal fields'
      )
    );
  }

  const approvals = validateFormalChangeApprovals({
    baseline,
    formalChangeApprovals,
    baselineSha256,
  });
  const cutover = validateFormalCutoverBaseline({
    baseline,
    formalCutoverBaseline,
    baselineSha256,
  });
  baselineIssues.push(...cutover.issues);
  const cutoverBaselineMap = baselineBySlug(
    cutover.formalBaseline
  );
  const cutoverApprovals = validateFormalCutoverChangeApprovals({
    formalCutoverBaseline,
    addedBaselineRows: cutover.addedSlugs.map((slug) =>
      cutoverBaselineMap.get(slug)
    ),
    formalCutoverChangeApprovals,
  });
  const retirement = validateFormalPropertyRetirement({
    formalCutoverBaseline,
    formalPropertyRetirement,
  });
  const slug = validateSlugIntegrity({
    baseline,
    formalBaseline: cutover.formalBaseline,
    pocRows,
    formalRows,
    expectedCount,
  });
  const target = validateTargetRows(pocRows, { expectedCount });
  const poc = reconcilePocRows({ baseline, pocRows });
  const effectiveFieldsBySlug = new Map(
    approvals.effectiveFieldsBySlug
  );
  for (const [slug, fields] of
    cutoverApprovals.effectiveFieldsBySlug) {
    effectiveFieldsBySlug.set(slug, fields);
  }
  const formal = reconcileFormalRows({
    baseline: cutover.formalBaseline,
    formalRows,
    effectiveFieldsBySlug,
    retiredFormalFields: new Set([
      ...retirement.retiredFormalFields,
      ...FORMAL_BASELINE_FIELDS_RETIRED_AFTER_20260720,
    ]),
  });
  const issues = [
    ...baselineIssues,
    ...approvals.issues,
    ...cutoverApprovals.issues,
    ...retirement.issues,
    ...slug.issues,
    ...target.issues,
    ...poc.issues,
    ...formal.issues,
  ];

  return {
    ok: issues.length === 0,
    issues,
    counts: {
      baseline: baseline.rows?.length || 0,
      formalBaseline: cutover.formalBaseline.rows?.length || 0,
      poc: pocRows.length,
      formal: formalRows.length,
      formalApprovals:
        approvals.approvalCount + cutoverApprovals.approvalCount,
      immutableFormalApprovals: approvals.approvalCount,
      cutoverFormalApprovals: cutoverApprovals.approvalCount,
      retiredFormalProperties:
        retirement.retiredPropertyCount +
        FORMAL_PROPERTIES_RETIRED_AFTER_20260720.length,
    },
    statusCounts: target.statusCounts,
    reconciliation: {
      migrationDifferenceCount: poc.migrationDifferenceCount,
      actionDifferenceCount: poc.actionDifferenceCount,
      formalObservedDifferenceCount: formal.observedDifferenceCount,
      formalApprovedDifferenceCount: formal.approvedDifferenceCount,
      formalDifferenceCount: formal.differenceCount,
    },
    layers: {
      baseline: baselineIssues.length === 0,
      approvals:
        approvals.issues.length === 0 &&
        cutoverApprovals.issues.length === 0,
      retirement: retirement.issues.length === 0,
      slug: slug.issues.length === 0,
      target: target.issues.length === 0,
      poc: poc.issues.length === 0,
      formal: formal.issues.length === 0,
    },
  };
}
