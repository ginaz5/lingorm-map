import { createHash } from 'node:crypto';
import { LOCATION_STATUSES } from '../src/data/csv-parser.js';

// The "Locations (PoC)" data source used during the 2026-07 migration has
// been deleted — there is now a single Notion Locations database, and
// NOTION_API_KEY is the sole credential (read + write) used to reach it.
export const FORMAL_DATA_SOURCE_ID = 'e55c2315-8ea2-837d-9637-07c1118486c8';

// Haversine distance in meters. Cross-checks a resolved/candidate place
// against the currently-stored Lat/Lng so a run can flag "moved more than
// 150m" for human review (originally scripts/resolve.mjs's Phase 1 PoC
// resolver spike; moved here since this core module is the only consumer
// left after the PoC resolver was retired).
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const BASIS_FIELDS = [
  'Slug',
  'Name',
  'Thai / Alt Name',
  'Category',
  'Google Maps URL',
  'Google Place ID',
  'Lat',
  'Lng',
  'Notes EN',
  'Notes ZH',
  'Source URLs',
  'Branch Group',
];

export const TARGET_STATUSES = new Set(LOCATION_STATUSES);

const APPLY_SOURCE_STATUSES = new Set(['Published', 'Paused']);
const LEGACY_APPLY_SOURCE_STATUSES = new Set([
  'Needs Review',
  'Verifying',
  'Verified',
]);

export const REVIEW_DECISIONS = new Set([
  'Accept Candidate',
  'Keep Current',
  'Reject Candidate',
  'Need Research',
  'Could Not Find',
  'Deactivate',
]);

export const COORDINATE_TYPES = new Set([
  'Exact',
  'Entrance',
  'Representative',
  'Approximate',
]);

const CANDIDATE_RESULTS = new Set([
  'place_id_candidate',
  'ambiguous',
  'no_candidate',
  'error',
  'expired',
]);

const FORBIDDEN_CANDIDATE_KEYS = new Set([
  'name',
  'address',
  'lat',
  'lng',
  'businessStatus',
  'distance',
  'distanceMeters',
  'matchScore',
  'riskFlags',
  'ranking',
]);

const MIGRATION_MAP = new Map([
  ['Draft', { status: 'Paused', reviewNeeded: true }],
  ['Needs Review', { status: 'Paused', reviewNeeded: true }],
  ['Verifying', { status: 'Paused', reviewNeeded: true }],
  ['Verified', { status: 'Paused', reviewNeeded: true }],
  ['Could Not Find', { status: 'Inactive', reviewNeeded: false }],
  ['Closed', { status: 'Inactive', reviewNeeded: false }],
]);

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .replace(/\r\n?/g, '\n')
    .trim()
    .normalize('NFC');
  return normalized || null;
}

function normalizeCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid coordinate value: ${value}`);
  }
  return number.toFixed(7);
}

function normalizeUrl(value) {
  const text = normalizeText(value);
  if (!text) return null;

  const url = new URL(text);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || ['gclid', 'fbclid'].includes(lower)) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

function normalizeMultiValue(value) {
  if (value === null || value === undefined || value === '') return [];
  let values = value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      values = Array.isArray(parsed) ? parsed : [value];
    } catch {
      values = value.split(',');
    }
  }
  if (!Array.isArray(values)) values = [values];

  return [...new Set(values.map(normalizeText).filter(Boolean))].sort();
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Revision(value) {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function encodeEnvelope(prefix, value) {
  return `${prefix}:${JSON.stringify(value)}`;
}

function decodeEnvelope(value, prefix, label) {
  const text = normalizeText(value);
  if (!text?.startsWith(`${prefix}:`)) {
    throw new Error(`${label} must use the ${prefix}: envelope`);
  }
  try {
    return JSON.parse(text.slice(prefix.length + 1));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

export function basisRevision(row) {
  const canonical = {};
  for (const field of BASIS_FIELDS) {
    const value = row[field];
    if (field === 'Lat' || field === 'Lng') {
      canonical[field] = normalizeCoordinate(value);
    } else if (field === 'Google Maps URL') {
      canonical[field] = normalizeUrl(value);
    } else if (field === 'Source URLs') {
      canonical[field] = normalizeMultiValue(value);
    } else {
      canonical[field] = normalizeText(value);
    }
  }
  return sha256Revision(canonical);
}

export function workflowRevision({ status, dataSourceId, inTrash = false }) {
  return sha256Revision({
    dataSourceId: normalizeText(dataSourceId),
    inTrash: Boolean(inTrash),
    status: normalizeText(status),
  });
}

export function assertAllowedDataSource(dataSourceId, expectedDataSourceId = FORMAL_DATA_SOURCE_ID) {
  if (dataSourceId !== expectedDataSourceId) {
    throw new Error(
      `Refusing write: data source ${dataSourceId} is not allowlisted ${expectedDataSourceId}`
    );
  }
}

export function buildStatusMigrationPatch(row) {
  const mapping = MIGRATION_MAP.get(row.Status);
  if (!mapping) {
    throw new Error(`Unsupported legacy Status: ${row.Status || '(blank)'}`);
  }
  return {
    Status: mapping.status,
    'Review Needed': mapping.reviewNeeded ? '__YES__' : '__NO__',
  };
}

function parseIso(value, label) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ${label}: ${value}`);
  return timestamp;
}

export function mapsUrlForPlaceId(placeId) {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', placeId);
  url.searchParams.set('query_place_id', placeId);
  return url.toString();
}

function mapsUrlForQuery(query) {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', query);
  return url.toString();
}

const CANDIDATE_SUMMARIES = {
  place_id_candidate: '[Candidate Ready]',
  ambiguous: '[Multiple Candidates]',
  no_candidate: '[No Candidate]',
  error: '[Resolver Error]',
  expired: '[Expired]',
};

export function buildCandidatePatch({
  row,
  dataSourceId,
  result,
  placeId = null,
  coordinateReviewRequired = false,
  candidateSource,
  verificationMethod,
  query,
  reviewRunId,
  resolvedAt,
  reviewExpiresAt,
  errorCode = null,
  expiredAt = null,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
}) {
  assertAllowedDataSource(dataSourceId, expectedDataSourceId);
  if (!CANDIDATE_RESULTS.has(result)) {
    throw new Error(`Unsupported Candidate Payload result: ${result}`);
  }
  if (!normalizeText(reviewRunId)) throw new Error('reviewRunId is required');

  const payload = {
    schemaVersion: 2,
    reviewRunId,
    result,
    revisionSchemaVersion: 1,
    basisRevision: basisRevision(row),
    workflowRevision: workflowRevision({
      status: row.Status,
      dataSourceId,
      inTrash: false,
    }),
  };

  const normalizedQuery = normalizeText(query);
  const resolvedTimestamp = parseIso(resolvedAt, 'resolvedAt');
  payload.resolvedAt = new Date(resolvedTimestamp).toISOString();

  if (['place_id_candidate', 'ambiguous', 'no_candidate'].includes(result)) {
    if (!normalizedQuery) throw new Error(`${result} requires query`);
    const expiryTimestamp = parseIso(reviewExpiresAt, 'reviewExpiresAt');
    if (expiryTimestamp <= resolvedTimestamp) {
      throw new Error('reviewExpiresAt must be later than resolvedAt');
    }
    payload.query = normalizedQuery;
    payload.reviewExpiresAt = new Date(expiryTimestamp).toISOString();
  }

  if (result === 'place_id_candidate') {
    const normalizedPlaceId = normalizeText(placeId);
    if (!normalizedPlaceId) throw new Error('Candidate Place ID is required');
    if (typeof coordinateReviewRequired !== 'boolean') {
      throw new Error('coordinateReviewRequired must be boolean');
    }
    payload.placeId = normalizedPlaceId;
    payload.coordinateReviewRequired = coordinateReviewRequired;
    payload.candidateSource = normalizeText(candidateSource);
    payload.verificationMethod = normalizeText(verificationMethod);
  } else if (result === 'error') {
    payload.errorCode = normalizeText(errorCode);
  } else if (result === 'expired') {
    payload.expiredAt = new Date(parseIso(expiredAt, 'expiredAt')).toISOString();
  }

  validateCandidatePayload(payload);

  return {
    'Review Needed': '__YES__',
    'Candidate Summary':
      result === 'error' && payload.errorCode
        ? `${CANDIDATE_SUMMARIES[result]} ${payload.errorCode}`
        : `${CANDIDATE_SUMMARIES[result]}${
            payload.coordinateReviewRequired
              ? ' [Coordinate Correction Required]'
              : ''
          }`,
    'Candidate Maps URL':
      result === 'place_id_candidate'
        ? mapsUrlForPlaceId(payload.placeId)
        : result === 'ambiguous'
          ? mapsUrlForQuery(payload.query)
          : null,
    'Candidate Payload': encodeEnvelope('lv2', payload),
    'Review Decision': null,
  };
}

export function buildPlaceIdCandidatePatch(options) {
  return buildCandidatePatch({
    ...options,
    result: 'place_id_candidate',
  });
}

export function validateCandidatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Candidate Payload must be an object');
  }
  if (payload.schemaVersion !== 2) {
    throw new Error(`Unsupported Candidate Payload schemaVersion: ${payload.schemaVersion}`);
  }
  if (!CANDIDATE_RESULTS.has(payload.result)) {
    throw new Error(`Unsupported Candidate Payload result: ${payload.result}`);
  }

  for (const key of FORBIDDEN_CANDIDATE_KEYS) {
    if (Object.hasOwn(payload, key)) {
      throw new Error(`Candidate Payload must not persist Places content: ${key}`);
    }
  }

  for (const key of [
    'reviewRunId',
    'revisionSchemaVersion',
    'basisRevision',
    'workflowRevision',
  ]) {
    if (payload[key] === null || payload[key] === undefined || payload[key] === '') {
      throw new Error(`Candidate Payload missing ${key}`);
    }
  }

  if (payload.result === 'place_id_candidate') {
    if (!normalizeText(payload.placeId)) {
      throw new Error('place_id_candidate missing placeId');
    }
    if (
      Object.hasOwn(payload, 'coordinateReviewRequired') &&
      typeof payload.coordinateReviewRequired !== 'boolean'
    ) {
      throw new Error(
        'place_id_candidate coordinateReviewRequired must be boolean'
      );
    }
    if (!normalizeText(payload.query)) {
      throw new Error('place_id_candidate missing query');
    }
    parseIso(payload.resolvedAt, 'resolvedAt');
    parseIso(payload.reviewExpiresAt, 'reviewExpiresAt');
  } else {
    if (Object.hasOwn(payload, 'placeId')) {
      throw new Error(`${payload.result} must not contain placeId`);
    }
    if (['ambiguous', 'no_candidate'].includes(payload.result)) {
      if (!normalizeText(payload.query)) {
        throw new Error(`${payload.result} missing query`);
      }
      parseIso(payload.resolvedAt, 'resolvedAt');
      parseIso(payload.reviewExpiresAt, 'reviewExpiresAt');
    } else if (payload.result === 'error') {
      if (!normalizeText(payload.errorCode)) {
        throw new Error('error missing errorCode');
      }
      parseIso(payload.resolvedAt, 'resolvedAt');
    } else if (payload.result === 'expired') {
      parseIso(payload.resolvedAt, 'resolvedAt');
      parseIso(payload.expiredAt, 'expiredAt');
    }
  }

  return payload;
}

function parsePayload(value) {
  if (!normalizeText(value)) return null;
  return validateCandidatePayload(decodeEnvelope(value, 'lv2', 'Candidate Payload'));
}

function requireNote(row) {
  const note = normalizeText(row['Verification Note']);
  if (!note) throw new Error('Verification Note is required');
  return note;
}

function requireCoordinateType(row) {
  const coordinateType = normalizeText(row['Coordinate Type']);
  if (!coordinateType) throw new Error('Coordinate Type is required');
  if (!COORDINATE_TYPES.has(coordinateType)) {
    throw new Error(`Unsupported Coordinate Type: ${coordinateType}`);
  }
  return coordinateType;
}

function appendVerificationNote(note, entry) {
  return `${note}\n${entry}`.trim();
}

function clearCandidateProperties() {
  return {
    'Candidate Summary': null,
    'Candidate Maps URL': null,
    'Candidate Payload': null,
    'Review Decision': null,
  };
}

function appendRejectedPlaceId(currentValue, placeId) {
  const values = String(currentValue || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...values, placeId])].join('\n');
}

function hasRejectedPlaceId(currentValue, placeId) {
  return String(currentValue || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(placeId);
}

export function buildPendingApplyPatch({
  row,
  dataSourceId,
  actionRunId,
  now,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
}) {
  assertAllowedDataSource(dataSourceId, expectedDataSourceId);
  if (!normalizeText(actionRunId)) throw new Error('actionRunId is required');
  const decision = normalizeText(row['Review Decision']);
  if (!REVIEW_DECISIONS.has(decision)) {
    throw new Error(`Unsupported Review Decision: ${decision || '(blank)'}`);
  }
  const payload = decision === 'Deactivate' ? null : parsePayload(row['Candidate Payload']);
  const metadata = {
    schemaVersion: 1,
    actionRunId,
    reviewRunId: payload?.reviewRunId || null,
    decision,
    state: 'pending',
    basisRevision: basisRevision(row),
    updatedAt: new Date(parseIso(now, 'now')).toISOString(),
  };
  return { 'Apply Metadata': encodeEnvelope('lv1', metadata) };
}

export function buildCompletedApplyPatch({
  row,
  dataSourceId,
  actionRunId,
  now,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
  allowLegacySourceStatus = false,
}) {
  assertAllowedDataSource(dataSourceId, expectedDataSourceId);
  if (!normalizeText(actionRunId)) throw new Error('actionRunId is required');
  const decision = normalizeText(row['Review Decision']);
  if (!REVIEW_DECISIONS.has(decision)) {
    throw new Error(`Unsupported Review Decision: ${decision || '(blank)'}`);
  }
  if (
    !APPLY_SOURCE_STATUSES.has(row.Status) &&
    !(
      allowLegacySourceStatus &&
      dataSourceId === FORMAL_DATA_SOURCE_ID &&
      LEGACY_APPLY_SOURCE_STATUSES.has(row.Status)
    )
  ) {
    throw new Error(`Unsupported apply source Status: ${row.Status || '(blank)'}`);
  }

  const nowIso = new Date(parseIso(now, 'now')).toISOString();
  const payload = decision === 'Deactivate' ? null : parsePayload(row['Candidate Payload']);
  const currentBasisRevision = basisRevision(row);
  const currentWorkflowRevision = workflowRevision({
    status: row.Status,
    dataSourceId,
    inTrash: false,
  });

  if (decision !== 'Deactivate') {
    if (row['Review Needed'] !== '__YES__') {
      throw new Error('Review Needed must be checked');
    }
    if (!payload) throw new Error('Candidate Payload is required');
    if (payload.basisRevision !== currentBasisRevision) {
      throw new Error('basisRevision changed; rerun resolver');
    }
    if (payload.workflowRevision !== currentWorkflowRevision) {
      throw new Error('workflowRevision changed; rerun resolver');
    }
  }

  if (['Accept Candidate', 'Reject Candidate'].includes(decision)) {
    if (payload?.result !== 'place_id_candidate') {
      throw new Error(`${decision} requires place_id_candidate`);
    }
    if (parseIso(payload.reviewExpiresAt, 'reviewExpiresAt') <= parseIso(nowIso, 'now')) {
      throw new Error('Candidate review has expired');
    }
    if (hasRejectedPlaceId(row['Rejected Place IDs'], payload.placeId)) {
      throw new Error('Candidate Place ID has already been rejected');
    }
  }

  const note = decision === 'Need Research' ? normalizeText(row['Verification Note']) : requireNote(row);
  if (['Accept Candidate', 'Keep Current'].includes(decision)) {
    if (payload?.coordinateReviewRequired === true) {
      throw new Error(
        'Coordinate correction required; update formal Lat/Lng from a traceable source, reset Candidate, and rerun resolver'
      );
    }
    requireCoordinateType(row);
  }

  const reviewRunId = payload?.reviewRunId || null;
  const auditEntry = `[${nowIso}] decision=${decision} actionRunId=${actionRunId} reviewRunId=${reviewRunId || 'null'}`;
  const metadata = {
    schemaVersion: 1,
    actionRunId,
    reviewRunId,
    decision,
    state: 'completed',
    basisRevision: currentBasisRevision,
    updatedAt: nowIso,
  };
  const common = {
    'Apply Metadata': encodeEnvelope('lv1', metadata),
    'Verification Note': appendVerificationNote(note || '', auditEntry),
  };

  switch (decision) {
    case 'Accept Candidate':
      return {
        ...common,
        'Google Place ID': payload.placeId,
        'Google Maps URL': mapsUrlForPlaceId(payload.placeId),
        Status: 'Published',
        'Review Needed': '__NO__',
        'date:Last Verified:start': nowIso,
        'date:Last Verified:is_datetime': 1,
        'date:Place ID Checked At:start': nowIso,
        'date:Place ID Checked At:is_datetime': 1,
        ...clearCandidateProperties(),
      };
    case 'Keep Current':
      return {
        ...common,
        Status: 'Published',
        'Review Needed': '__NO__',
        'date:Last Verified:start': nowIso,
        'date:Last Verified:is_datetime': 1,
        ...(payload?.verificationMethod === 'google_maps_manual' ||
        payload?.verificationMethod === 'places_refresh'
          ? {
              'date:Place ID Checked At:start': nowIso,
              'date:Place ID Checked At:is_datetime': 1,
            }
          : {}),
        ...clearCandidateProperties(),
      };
    case 'Reject Candidate':
      return {
        ...common,
        'Rejected Place IDs': appendRejectedPlaceId(
          row['Rejected Place IDs'],
          payload.placeId
        ),
        'Review Needed': '__YES__',
        ...clearCandidateProperties(),
      };
    case 'Need Research':
      return {
        ...common,
        'Review Needed': '__YES__',
      };
    case 'Could Not Find':
      return {
        ...common,
        Status: 'Inactive',
        'Review Needed': '__NO__',
        'date:Last Verified:start': nowIso,
        'date:Last Verified:is_datetime': 1,
        ...(payload?.result === 'place_id_candidate'
          ? {
              'Rejected Place IDs': appendRejectedPlaceId(
                row['Rejected Place IDs'],
                payload.placeId
              ),
            }
          : {}),
        ...clearCandidateProperties(),
      };
    case 'Deactivate':
      return {
        ...common,
        Status: 'Inactive',
        'Review Needed': '__NO__',
        'date:Last Verified:start': nowIso,
        'date:Last Verified:is_datetime': 1,
        ...clearCandidateProperties(),
      };
    default:
      throw new Error(`Unhandled Review Decision: ${decision}`);
  }
}
