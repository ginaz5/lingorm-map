import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORMAL_DATA_SOURCE_ID,
  buildCandidatePatch,
} from '../scripts/location-verification-core.mjs';
import {
  parseApplyMetadata,
  validateTargetRows,
} from '../scripts/location-verification-validator.mjs';

function legacyFields(slug, status = 'Verified') {
  return {
    'Branch Group': '',
    Category: 'Cafe',
    'Coordinates Approx': '__NO__',
    'Google Maps URL': `https://maps.example/${slug}`,
    'Google Place ID': `place-${slug}`,
    Lat: 13.7,
    Lng: 100.5,
    Name: `${slug} name`,
    'Name ZH': '',
    'Notes EN': '',
    'Notes ZH': '',
    Origin: 'manual',
    Slug: slug,
    'Source Tags': '["Threads"]',
    'Source URLs': 'https://source.example/item',
    Status: status,
    'Thai / Alt Name': '',
  };
}

function workflowDefaults(fields) {
  return {
    ...fields,
    'Source Tags': ['Threads'],
    'Review Needed': '__YES__',
    'Review Decision': '',
    'Coordinate Type': '',
    'Verification Note': '',
    'Rejected Place IDs': '',
    'Candidate Summary': '',
    'Candidate Maps URL': '',
    'Candidate Payload': '',
    'Apply Metadata': '',
    'Last Verified': '',
    'Place ID Checked At': '',
    __dataSourceId: FORMAL_DATA_SOURCE_ID,
    __inTrash: false,
  };
}

function metadata({
  decision,
  actionRunId,
  reviewRunId = null,
  state = 'completed',
}) {
  return `lv1:${JSON.stringify({
    schemaVersion: 1,
    actionRunId,
    reviewRunId,
    decision,
    state,
    basisRevision: 'sha256:test-basis',
    updatedAt: '2026-07-19T10:00:00.000Z',
  })}`;
}

// Mirrors the pair of rows used across the target-validation tests below:
// one Published row with a completed apply action, one Paused row.
function targetSnapshotRows() {
  const alphaAction = 'action-alpha';
  const alpha = {
    ...workflowDefaults(legacyFields('alpha', 'Published')),
    'Review Needed': '__NO__',
    'Coordinate Type': 'Exact',
    'Verification Note': `Owner decision\n${alphaAction}`,
    'Apply Metadata': metadata({
      decision: 'Keep Current',
      actionRunId: alphaAction,
      reviewRunId: 'review-alpha',
    }),
    'Last Verified': '2026-07-19T10:00:00.000Z',
    'Place ID Checked At': '2026-07-19T10:00:00.000Z',
  };
  const beta = workflowDefaults(legacyFields('beta', 'Paused'));
  return [alpha, beta];
}

test('Need Research is a valid completed state that retains its Candidate', () => {
  const base = workflowDefaults({
    ...legacyFields('research'),
    Status: 'Paused',
  });
  const candidate = buildCandidatePatch({
    row: base,
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    result: 'place_id_candidate',
    placeId: 'place-research-candidate',
    candidateSource: 'existing_place_id',
    verificationMethod: 'places_refresh',
    query: 'Research place',
    reviewRunId: 'review-research',
    resolvedAt: '2026-07-19T10:00:00.000Z',
    reviewExpiresAt: '2026-08-18T10:00:00.000Z',
  });
  const actionRunId = 'action-research';
  const row = {
    ...base,
    ...candidate,
    'Review Decision': 'Need Research',
    'Verification Note': `Missing evidence\n${actionRunId}`,
    'Apply Metadata': metadata({
      decision: 'Need Research',
      actionRunId,
      reviewRunId: 'review-research',
    }),
  };
  const result = validateTargetRows([row], { expectedCount: 1 });
  assert.deepEqual(result.issues, []);
});

test('target validation blocks invalid status, duplicate Place ID, and pending apply', () => {
  const [alpha, beta] = targetSnapshotRows();
  beta.Status = 'Verified';
  beta['Google Place ID'] = alpha['Google Place ID'];
  alpha['Apply Metadata'] = metadata({
    decision: 'Keep Current',
    actionRunId: 'action-alpha',
    state: 'pending',
  });
  const result = validateTargetRows([alpha, beta], { expectedCount: 2 });
  const codes = new Set(result.issues.map(({ code }) => code));
  assert.equal(codes.has('STATUS_INVALID'), true);
  assert.equal(codes.has('PLACE_ID_DUPLICATE'), true);
  assert.equal(codes.has('APPLY_NOT_COMPLETED'), true);
});

test('current rejected Place ID requires a completed Reject Candidate override', () => {
  const row = workflowDefaults({
    ...legacyFields('reject'),
    Status: 'Paused',
  });
  row['Rejected Place IDs'] = row['Google Place ID'];
  let result = validateTargetRows([row], { expectedCount: 1 });
  assert.equal(
    result.issues.some(({ code }) => code === 'CURRENT_PLACE_ID_REJECTED'),
    true
  );

  const actionRunId = 'action-reject';
  row['Apply Metadata'] = metadata({
    decision: 'Reject Candidate',
    actionRunId,
    reviewRunId: 'review-reject',
  });
  row['Verification Note'] = `Same-name wrong location\n${actionRunId}`;
  result = validateTargetRows([row], { expectedCount: 1 });
  assert.equal(
    result.issues.some(({ code }) => code === 'CURRENT_PLACE_ID_REJECTED'),
    false
  );
});

test('Apply Metadata parser rejects malformed envelopes', () => {
  assert.throws(() => parseApplyMetadata('not-json'), /lv1/);
  assert.throws(() => parseApplyMetadata('lv1:{}'), /schema/);
});
