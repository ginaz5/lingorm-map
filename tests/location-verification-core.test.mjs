import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORMAL_DATA_SOURCE_ID,
  basisRevision,
  buildCandidatePatch,
  buildCompletedApplyPatch,
  buildPendingApplyPatch,
  buildPlaceIdCandidatePatch,
  buildStatusMigrationPatch,
  haversineMeters,
  validateCandidatePayload,
} from '../scripts/location-verification-core.mjs';

test('haversineMeters returns 0 for identical coordinates', () => {
  assert.equal(haversineMeters(13.75, 100.5, 13.75, 100.5), 0);
});

test('haversineMeters flags coordinates more than 150m apart (moved-place threshold)', () => {
  // ~0.01 degrees latitude at this latitude is well over 150m.
  const distance = haversineMeters(13.75, 100.5, 13.76, 100.5);
  assert.ok(distance > 150, `expected > 150m, got ${distance}`);
});

function row(overrides = {}) {
  return {
    Slug: 'the-siam-hotel',
    Name: 'The Siam Hotel',
    'Thai / Alt Name': '',
    Category: 'Hotel',
    'Google Maps URL': 'https://example.com/maps?utm_source=test',
    'Google Place ID': 'ChIJcurrent',
    Lat: 13.7811,
    Lng: 100.505,
    'Notes EN': '',
    'Notes ZH': '',
    'Source URLs': '',
    'Branch Group': '',
    Status: 'Paused',
    'Review Needed': '__YES__',
    'Coordinate Type': 'Exact',
    'Verification Note': 'Confirmed correct hotel and entrance.',
    'Review Decision': 'Keep Current',
    'Rejected Place IDs': '',
    ...overrides,
  };
}

function candidatePatch(currentRow = row()) {
  return buildPlaceIdCandidatePatch({
    row: currentRow,
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    placeId: currentRow['Google Place ID'],
    candidateSource: 'existing_place_id',
    verificationMethod: 'google_maps_manual',
    query: currentRow.Name,
    reviewRunId: 'review-001',
    resolvedAt: '2026-07-19T01:00:00.000Z',
    reviewExpiresAt: '2026-08-18T01:00:00.000Z',
  });
}

function parseEnvelope(value, prefix) {
  assert.ok(value.startsWith(`${prefix}:`));
  return JSON.parse(value.slice(prefix.length + 1));
}

test('PoC status migration is conservative and does not auto-publish legacy Verified', () => {
  assert.deepEqual(buildStatusMigrationPatch({ Status: 'Verified' }), {
    Status: 'Paused',
    'Review Needed': '__YES__',
  });
  assert.deepEqual(buildStatusMigrationPatch({ Status: 'Could Not Find' }), {
    Status: 'Inactive',
    'Review Needed': '__NO__',
  });
});

test('candidate patch persists only Place ID and workflow metadata', () => {
  const patch = candidatePatch();
  const payload = parseEnvelope(patch['Candidate Payload'], 'lv2');

  assert.equal(payload.result, 'place_id_candidate');
  assert.equal(payload.placeId, 'ChIJcurrent');
  assert.equal(payload.coordinateReviewRequired, false);
  for (const forbidden of [
    'name',
    'address',
    'lat',
    'lng',
    'businessStatus',
    'distanceMeters',
    'matchScore',
    'riskFlags',
  ]) {
    assert.equal(Object.hasOwn(payload, forbidden), false, forbidden);
  }
});

test('high-distance safety flag blocks publishing decisions without persisting Places coordinates', () => {
  const current = row({ 'Review Decision': 'Accept Candidate' });
  const flaggedCandidate = buildPlaceIdCandidatePatch({
    row: current,
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    placeId: 'ChIJcurrent',
    coordinateReviewRequired: true,
    candidateSource: 'existing_place_id',
    verificationMethod: 'places_refresh',
    query: current.Name,
    reviewRunId: 'review-coordinate-risk',
    resolvedAt: '2026-07-19T01:00:00.000Z',
    reviewExpiresAt: '2026-08-18T01:00:00.000Z',
  });
  const payload = parseEnvelope(
    flaggedCandidate['Candidate Payload'],
    'lv2'
  );

  assert.equal(payload.coordinateReviewRequired, true);
  assert.equal(Object.hasOwn(payload, 'lat'), false);
  assert.equal(Object.hasOwn(payload, 'lng'), false);
  assert.equal(
    flaggedCandidate['Candidate Summary'],
    '[Candidate Ready] [Coordinate Correction Required]'
  );
  assert.throws(
    () =>
      buildCompletedApplyPatch({
        row: {
          ...current,
          ...flaggedCandidate,
          'Review Decision': 'Accept Candidate',
        },
        dataSourceId: FORMAL_DATA_SOURCE_ID,
        actionRunId: 'action-coordinate-risk',
        now: '2026-07-19T02:00:00.000Z',
      }),
    /Coordinate correction required/
  );
});

test('candidate writes fail closed for an unrecognized data source', () => {
  assert.throws(
    () =>
      buildPlaceIdCandidatePatch({
        row: row(),
        dataSourceId: '11111111-1111-1111-1111-111111111111',
        placeId: 'ChIJcandidate',
        candidateSource: 'text_search',
        verificationMethod: 'places_refresh',
        query: 'The Siam Hotel',
        reviewRunId: 'review-001',
        resolvedAt: '2026-07-19T01:00:00.000Z',
        reviewExpiresAt: '2026-08-18T01:00:00.000Z',
      }),
    /not allowlisted/
  );
});

test('candidate payload rejects persisted Places content', () => {
  assert.throws(
    () =>
      validateCandidatePayload({
        schemaVersion: 2,
        reviewRunId: 'review-001',
        result: 'place_id_candidate',
        placeId: 'ChIJcandidate',
        name: 'Forbidden API content',
        resolvedAt: '2026-07-19T01:00:00.000Z',
        reviewExpiresAt: '2026-08-18T01:00:00.000Z',
        revisionSchemaVersion: 1,
        basisRevision: 'sha256:abc',
        workflowRevision: 'sha256:def',
      }),
    /must not persist Places content: name/
  );
});

test('basis revision canonicalizes equivalent URL and coordinate forms', () => {
  assert.equal(
    basisRevision(row()),
    basisRevision(
      row({
        Lat: '13.7811000',
        Lng: '100.5050000',
        'Google Maps URL': 'https://example.com/maps',
      })
    )
  );
});

test('Keep Current uses pending then completed metadata and preserves formal coordinates', () => {
  const current = row();
  const withCandidate = {
    ...current,
    ...candidatePatch(current),
    'Review Decision': 'Keep Current',
    'Coordinate Type': 'Exact',
    'Verification Note': 'Confirmed correct hotel and entrance.',
  };

  const pending = buildPendingApplyPatch({
    row: withCandidate,
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    actionRunId: 'action-001',
    now: '2026-07-19T02:00:00.000Z',
  });
  assert.equal(parseEnvelope(pending['Apply Metadata'], 'lv1').state, 'pending');

  const completed = buildCompletedApplyPatch({
    row: withCandidate,
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    actionRunId: 'action-001',
    now: '2026-07-19T02:00:00.000Z',
  });
  assert.equal(parseEnvelope(completed['Apply Metadata'], 'lv1').state, 'completed');
  assert.equal(completed.Status, 'Published');
  assert.equal(completed['Review Needed'], '__NO__');
  assert.equal(Object.hasOwn(completed, 'Lat'), false);
  assert.equal(Object.hasOwn(completed, 'Lng'), false);
  assert.equal(Object.hasOwn(completed, 'Google Place ID'), false);
});

test('Accept Candidate changes Place ID and Maps URL but never writes Lat/Lng', () => {
  const current = row({ 'Review Decision': 'Accept Candidate' });
  const withCandidate = {
    ...current,
    ...candidatePatch(current),
    'Review Decision': 'Accept Candidate',
  };
  const completed = buildCompletedApplyPatch({
    row: withCandidate,
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    actionRunId: 'action-002',
    now: '2026-07-19T02:00:00.000Z',
  });

  assert.equal(completed['Google Place ID'], 'ChIJcurrent');
  assert.match(completed['Google Maps URL'], /query_place_id=ChIJcurrent/);
  assert.equal(Object.hasOwn(completed, 'Lat'), false);
  assert.equal(Object.hasOwn(completed, 'Lng'), false);
});

test('expired candidate cannot be accepted', () => {
  const current = row({ 'Review Decision': 'Accept Candidate' });
  const expiredCandidate = buildPlaceIdCandidatePatch({
    row: current,
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    placeId: 'ChIJcurrent',
    candidateSource: 'existing_place_id',
    verificationMethod: 'google_maps_manual',
    query: current.Name,
    reviewRunId: 'review-expired',
    resolvedAt: '2026-06-01T00:00:00.000Z',
    reviewExpiresAt: '2026-07-01T00:00:00.000Z',
  });
  const withCandidate = {
    ...current,
    ...expiredCandidate,
    'Review Decision': 'Accept Candidate',
  };

  assert.throws(
    () =>
      buildCompletedApplyPatch({
        row: withCandidate,
        dataSourceId: FORMAL_DATA_SOURCE_ID,
        actionRunId: 'action-expired',
        now: '2026-07-19T02:00:00.000Z',
      }),
    /expired/
  );
});

test('Reject Candidate records the Place ID and keeps formal location fields', () => {
  const current = row({ 'Review Decision': 'Reject Candidate' });
  const completed = buildCompletedApplyPatch({
    row: {
      ...current,
      ...candidatePatch(current),
      'Review Decision': 'Reject Candidate',
    },
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    actionRunId: 'action-reject',
    now: '2026-07-19T02:00:00.000Z',
  });

  assert.equal(completed['Rejected Place IDs'], 'ChIJcurrent');
  assert.equal(completed['Review Needed'], '__YES__');
  assert.equal(Object.hasOwn(completed, 'Status'), false);
  assert.equal(Object.hasOwn(completed, 'Google Place ID'), false);
  assert.equal(completed['Candidate Payload'], null);
});

test('Need Research keeps the candidate queue and permits an empty note', () => {
  const current = row({
    'Review Decision': 'Need Research',
    'Verification Note': '',
  });
  const completed = buildCompletedApplyPatch({
    row: {
      ...current,
      ...candidatePatch(current),
      'Review Decision': 'Need Research',
    },
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    actionRunId: 'action-research',
    now: '2026-07-19T02:00:00.000Z',
  });

  assert.equal(completed['Review Needed'], '__YES__');
  assert.equal(Object.hasOwn(completed, 'Candidate Payload'), false);
  assert.equal(Object.hasOwn(completed, 'Status'), false);
});

test('Could Not Find inactivates the page and rejects a remaining candidate', () => {
  const current = row({ 'Review Decision': 'Could Not Find' });
  const completed = buildCompletedApplyPatch({
    row: {
      ...current,
      ...candidatePatch(current),
      'Review Decision': 'Could Not Find',
    },
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    actionRunId: 'action-not-found',
    now: '2026-07-19T02:00:00.000Z',
  });

  assert.equal(completed.Status, 'Inactive');
  assert.equal(completed['Review Needed'], '__NO__');
  assert.equal(completed['Rejected Place IDs'], 'ChIJcurrent');
  assert.equal(completed['Candidate Payload'], null);
});

test('Deactivate requires no candidate and does not reject the current Place ID', () => {
  const completed = buildCompletedApplyPatch({
    row: row({
      Status: 'Published',
      'Review Needed': '__NO__',
      'Review Decision': 'Deactivate',
      'Candidate Payload': '',
      'Rejected Place IDs': '',
    }),
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    actionRunId: 'action-deactivate',
    now: '2026-07-19T02:00:00.000Z',
  });

  assert.equal(completed.Status, 'Inactive');
  assert.equal(completed['Review Needed'], '__NO__');
  assert.equal(Object.hasOwn(completed, 'Rejected Place IDs'), false);
  assert.equal(Object.hasOwn(completed, 'Google Place ID'), false);
});

test('Accept Candidate rejects ambiguous resolver results', () => {
  const current = row({ 'Review Decision': 'Accept Candidate' });
  const ambiguous = buildCandidatePatch({
    row: current,
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    result: 'ambiguous',
    candidateSource: 'text_search',
    verificationMethod: 'places_text_search',
    query: current.Name,
    reviewRunId: 'review-ambiguous',
    resolvedAt: '2026-07-19T01:00:00.000Z',
    reviewExpiresAt: '2026-08-18T01:00:00.000Z',
  });

  assert.throws(
    () =>
      buildCompletedApplyPatch({
        row: {
          ...current,
          ...ambiguous,
          'Review Decision': 'Accept Candidate',
        },
        dataSourceId: FORMAL_DATA_SOURCE_ID,
        actionRunId: 'action-ambiguous',
        now: '2026-07-19T02:00:00.000Z',
      }),
    /requires place_id_candidate/
  );
});

test('apply rejects candidates already listed in Rejected Place IDs', () => {
  const current = row({
    'Review Decision': 'Accept Candidate',
    'Rejected Place IDs': 'ChIJcurrent',
  });
  assert.throws(
    () =>
      buildCompletedApplyPatch({
        row: {
          ...current,
          ...candidatePatch(current),
          'Review Decision': 'Accept Candidate',
        },
        dataSourceId: FORMAL_DATA_SOURCE_ID,
        actionRunId: 'action-rejected-before',
        now: '2026-07-19T02:00:00.000Z',
      }),
    /already been rejected/
  );
});

test('apply rejects changed basis and workflow revisions', () => {
  const current = row();
  const candidate = candidatePatch(current);
  assert.throws(
    () =>
      buildCompletedApplyPatch({
        row: {
          ...current,
          ...candidate,
          Lat: current.Lat + 0.001,
          'Review Decision': 'Keep Current',
        },
        dataSourceId: FORMAL_DATA_SOURCE_ID,
        actionRunId: 'action-basis-changed',
        now: '2026-07-19T02:00:00.000Z',
      }),
    /basisRevision changed/
  );
  assert.throws(
    () =>
      buildCompletedApplyPatch({
        row: {
          ...current,
          ...candidate,
          Status: 'Published',
          'Review Decision': 'Keep Current',
        },
        dataSourceId: FORMAL_DATA_SOURCE_ID,
        actionRunId: 'action-workflow-changed',
        now: '2026-07-19T02:00:00.000Z',
      }),
    /workflowRevision changed/
  );
});

test('Inactive pages cannot be republished through an old apply request', () => {
  const inactive = row({
    Status: 'Inactive',
    'Review Decision': 'Keep Current',
  });
  assert.throws(
    () =>
      buildCompletedApplyPatch({
        row: {
          ...inactive,
          ...candidatePatch(inactive),
          'Review Decision': 'Keep Current',
        },
        dataSourceId: FORMAL_DATA_SOURCE_ID,
        actionRunId: 'action-inactive',
        now: '2026-07-19T02:00:00.000Z',
      }),
    /Unsupported apply source Status: Inactive/
  );
});
