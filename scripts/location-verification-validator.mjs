import {
  FORMAL_DATA_SOURCE_ID,
  REVIEW_DECISIONS,
  TARGET_STATUSES,
  basisRevision,
  validateCandidatePayload,
  workflowRevision,
} from './location-verification-core.mjs';

export const EXPECTED_LOCATION_COUNT = 100;
export const TARGET_COORDINATE_TYPES = new Set([
  'Exact',
  'Entrance',
  'Representative',
  'Approximate',
]);

const ACTION_EXPECTED_STATUS = {
  'Accept Candidate': 'Published',
  'Keep Current': 'Published',
  'Could Not Find': 'Inactive',
  Deactivate: 'Inactive',
};

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
      dataSourceId: row.__dataSourceId || FORMAL_DATA_SOURCE_ID,
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
        'LOCATION_COUNT_MISMATCH',
        `Expected ${expectedCount} rows, found ${rows.length}`
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
