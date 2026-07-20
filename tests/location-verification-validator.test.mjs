import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  FORMAL_DATA_SOURCE_ID,
  POC_DATA_SOURCE_ID,
  buildCandidatePatch,
} from '../scripts/location-verification-core.mjs';
import {
  parseApplyMetadata,
  reconcileFormalRows,
  reconcilePocRows,
  validateAllData,
  validateFormalCutoverBaseline,
  validateFormalCutoverChangeApprovals,
  validateSlugIntegrity,
  validateTargetRows,
} from '../scripts/location-verification-validator.mjs';

const FORMAL_FIELDS = [
  'Branch Group',
  'Category',
  'Coordinates Approx',
  'Google Maps URL',
  'Google Place ID',
  'Lat',
  'Lng',
  'Name',
  'Name ZH',
  'Notes EN',
  'Notes ZH',
  'Origin',
  'Slug',
  'Source Tags',
  'Source URLs',
  'Status',
  'Thai / Alt Name',
];

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

function baselineFixture() {
  return {
    formalCount: 2,
    pocCount: 2,
    pocDataSourceId: POC_DATA_SOURCE_ID,
    formalDataSourceId: FORMAL_DATA_SOURCE_ID,
    formalFieldNames: FORMAL_FIELDS,
    rows: [
      {
        slug: 'alpha',
        pageUrl: 'https://app.notion.com/p/alpha',
        fields: legacyFields('alpha', 'Verified'),
      },
      {
        slug: 'beta',
        pageUrl: 'https://app.notion.com/p/beta',
        fields: legacyFields('beta', 'Needs Review'),
      },
    ],
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
    __dataSourceId: POC_DATA_SOURCE_ID,
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

function validSnapshots() {
  const baseline = baselineFixture();
  const alphaAction = 'action-alpha';
  const alpha = {
    ...workflowDefaults({
      ...baseline.rows[0].fields,
      Status: 'Published',
    }),
    __pageUrl: baseline.rows[0].pageUrl,
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
  const beta = {
    ...workflowDefaults({
      ...baseline.rows[1].fields,
      Status: 'Paused',
    }),
    __pageUrl: baseline.rows[1].pageUrl,
  };
  const formalRows = baseline.rows.map((entry) => ({
    ...workflowDefaults(entry.fields),
    __pageUrl: `https://app.notion.com/p/formal-${entry.slug}`,
    __dataSourceId: FORMAL_DATA_SOURCE_ID,
  }));
  return { baseline, pocRows: [alpha, beta], formalRows };
}

test('validateAllData passes target invariants and all three reconciliation layers', () => {
  const snapshots = validSnapshots();
  const result = validateAllData({ ...snapshots, expectedCount: 2 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.layers, {
    baseline: true,
    approvals: true,
    retirement: true,
    slug: true,
    target: true,
    poc: true,
    formal: true,
  });
  assert.equal(result.reconciliation.migrationDifferenceCount, 2);
  assert.equal(result.reconciliation.actionDifferenceCount, 1);
  assert.equal(result.reconciliation.formalDifferenceCount, 0);
});

function formalApproval({
  slug = 'alpha',
  field = 'Notes EN',
  fromValue = '',
  approvedValue = 'Intentional formal edit',
  syncPoc = false,
} = {}) {
  return {
    approvalId: `formal-change-${slug}-${field
      .toLowerCase()
      .replaceAll(' ', '-')}-01`,
    approvedAt: '2026-07-19T10:20:26.000Z',
    approvedBy: 'maintainer',
    slug,
    field,
    fromValue,
    approvedValue,
    reason: 'Maintainer confirmed this exact formal change.',
    syncPoc,
  };
}

function formalApprovalManifest(approvals) {
  return {
    schemaVersion: 1,
    baselineSha256: 'sha256:test-baseline',
    approvals,
  };
}

function formalCutoverFixture(baseline) {
  const addedFields = legacyFields('gamma', 'Draft');
  const rows = [
    ...baseline.rows.map((entry, index) => ({
      slug: entry.slug,
      pageId: String(index + 1).padStart(32, '0'),
      pageUrl: `https://app.notion.com/p/formal-${entry.slug}`,
      fields: { ...entry.fields },
    })),
    {
      slug: 'gamma',
      pageId: 'f'.repeat(32),
      pageUrl: `https://app.notion.com/p/${'f'.repeat(32)}`,
      fields: addedFields,
    },
  ];
  const content = {
    formalDataSourceId: FORMAL_DATA_SOURCE_ID,
    formalFieldNames: FORMAL_FIELDS,
    rows,
  };
  return {
    schemaVersion: 1,
    baselineId: 'formal-cutover-test',
    capturedAt: '2026-07-19T12:00:00.000Z',
    purpose: 'test',
    formalDatabaseId: 'formal-database',
    formalDataSourceId: FORMAL_DATA_SOURCE_ID,
    formalFieldNames: FORMAL_FIELDS,
    rowCount: rows.length,
    contentSha256: `sha256:${createHash('sha256')
      .update(JSON.stringify(content))
      .digest('hex')}`,
    transition: {
      previousBaselineSha256: 'sha256:test-baseline',
      addedSlugs: ['gamma'],
      removedSlugs: [],
    },
    rows,
  };
}

function formalCutoverApprovalManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    cutoverBaselineId: 'formal-cutover-test',
    cutoverContentSha256: overrides.cutoverContentSha256 ||
      formalCutoverFixture(baselineFixture()).contentSha256,
    approvals: [
      {
        ...formalApproval({
          slug: 'gamma',
          field: 'Status',
          fromValue: 'Draft',
          approvedValue: 'Published',
        }),
        approvalId: 'formal-change-gamma-status-published-01',
        ...(overrides.approval || {}),
      },
    ],
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'approval')
    ),
  };
}

test('formal cutover baseline admits only its hashed added Slug', () => {
  const snapshots = validSnapshots();
  const formalCutoverBaseline = formalCutoverFixture(
    snapshots.baseline
  );
  snapshots.formalRows.push({
    ...workflowDefaults(legacyFields('gamma', 'Draft')),
    __pageUrl: `https://app.notion.com/p/${'f'.repeat(32)}`,
    __dataSourceId: FORMAL_DATA_SOURCE_ID,
  });
  const result = validateAllData({
    ...snapshots,
    formalCutoverBaseline,
    baselineSha256: 'sha256:test-baseline',
    expectedCount: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.counts.baseline, 2);
  assert.equal(result.counts.formalBaseline, 3);
  assert.equal(result.counts.formal, 3);
  assert.equal(result.layers.baseline, true);
  assert.equal(result.layers.slug, true);
  assert.equal(result.layers.formal, true);
});

test('formal cutover approval permits an exact change on an added Slug', () => {
  const snapshots = validSnapshots();
  const formalCutoverBaseline = formalCutoverFixture(
    snapshots.baseline
  );
  snapshots.formalRows.push({
    ...workflowDefaults(legacyFields('gamma', 'Published')),
    __pageUrl: `https://app.notion.com/p/${'f'.repeat(32)}`,
    __dataSourceId: FORMAL_DATA_SOURCE_ID,
  });
  const result = validateAllData({
    ...snapshots,
    formalCutoverBaseline,
    formalCutoverChangeApprovals:
      formalCutoverApprovalManifest({
        cutoverContentSha256:
          formalCutoverBaseline.contentSha256,
      }),
    baselineSha256: 'sha256:test-baseline',
    expectedCount: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.layers.approvals, true);
  assert.equal(result.layers.formal, true);
  assert.equal(result.counts.formalApprovals, 1);
  assert.equal(result.counts.immutableFormalApprovals, 0);
  assert.equal(result.counts.cutoverFormalApprovals, 1);
  assert.equal(result.reconciliation.formalObservedDifferenceCount, 1);
  assert.equal(result.reconciliation.formalApprovedDifferenceCount, 1);
  assert.equal(result.reconciliation.formalDifferenceCount, 0);
});

test('formal cutover approval rejects the wrong hash or a non-added Slug', () => {
  const baseline = baselineFixture();
  const formalCutoverBaseline = formalCutoverFixture(baseline);
  const addedBaselineRows = [formalCutoverBaseline.rows.at(-1)];
  let result = validateFormalCutoverChangeApprovals({
    formalCutoverBaseline,
    addedBaselineRows,
    formalCutoverChangeApprovals:
      formalCutoverApprovalManifest({
        cutoverContentSha256: 'sha256:wrong',
      }),
  });
  assert.equal(
    result.issues.some(
      ({ code }) =>
        code === 'FORMAL_CUTOVER_APPROVAL_CONTENT_HASH_MISMATCH'
    ),
    true
  );

  result = validateFormalCutoverChangeApprovals({
    formalCutoverBaseline,
    addedBaselineRows,
    formalCutoverChangeApprovals:
      formalCutoverApprovalManifest({
        cutoverContentSha256:
          formalCutoverBaseline.contentSha256,
        approval: {
          approvalId: 'formal-change-alpha-status-published-01',
          slug: 'alpha',
        },
      }),
  });
  assert.equal(
    result.issues.some(
      ({ code }) => code === 'FORMAL_APPROVAL_SLUG_UNKNOWN'
    ),
    true
  );
});

test('formal cutover baseline fails closed on transition or content drift', () => {
  const baseline = baselineFixture();
  const transitionDrift = formalCutoverFixture(baseline);
  transitionDrift.transition.addedSlugs = [];
  let result = validateFormalCutoverBaseline({
    baseline,
    formalCutoverBaseline: transitionDrift,
    baselineSha256: 'sha256:test-baseline',
  });
  assert.equal(
    result.issues.some(
      ({ code }) => code === 'FORMAL_CUTOVER_ADDITIONS_MISMATCH'
    ),
    true
  );
  assert.equal(result.formalBaseline.rows.length, 2);

  const contentDrift = formalCutoverFixture(baseline);
  contentDrift.rows.at(-1).fields.Name = 'Tampered name';
  result = validateFormalCutoverBaseline({
    baseline,
    formalCutoverBaseline: contentDrift,
    baselineSha256: 'sha256:test-baseline',
  });
  assert.equal(
    result.issues.some(
      ({ code }) => code === 'FORMAL_CUTOVER_CONTENT_HASH_MISMATCH'
    ),
    true
  );
});

test('exact-value formal approval passes without changing the PoC baseline', () => {
  const snapshots = validSnapshots();
  snapshots.formalRows[0]['Notes EN'] = 'Intentional formal edit';
  const result = validateAllData({
    ...snapshots,
    formalChangeApprovals: formalApprovalManifest([formalApproval()]),
    baselineSha256: 'sha256:test-baseline',
    expectedCount: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.layers.approvals, true);
  assert.equal(result.layers.formal, true);
  assert.equal(result.counts.formalApprovals, 1);
  assert.equal(result.reconciliation.formalObservedDifferenceCount, 1);
  assert.equal(result.reconciliation.formalApprovedDifferenceCount, 1);
  assert.equal(result.reconciliation.formalDifferenceCount, 0);
  assert.equal(snapshots.pocRows[0]['Notes EN'], '');
});

test('current formal reconciliation retires only the removed schema fields', () => {
  const snapshots = validSnapshots();
  for (const row of snapshots.formalRows) {
    delete row['Branch Group'];
    delete row['Coordinates Approx'];
    delete row['Rejected Place IDs'];
  }

  let result = validateAllData({ ...snapshots, expectedCount: 2 });
  assert.equal(result.layers.formal, true);
  assert.equal(result.reconciliation.formalDifferenceCount, 0);
  assert.equal(result.counts.retiredFormalProperties, 3);

  snapshots.formalRows[0].Name = 'Unexpected rename';
  result = validateAllData({ ...snapshots, expectedCount: 2 });
  assert.equal(result.layers.formal, false);
  assert.equal(result.reconciliation.formalDifferenceCount, 1);
  assert.equal(
    result.issues.some(
      ({ code, field }) =>
        code === 'FORMAL_BASELINE_DRIFT' && field === 'Name'
    ),
    true
  );
});

test('formal approval accepts only the latest exact value', () => {
  const snapshots = validSnapshots();
  const first = formalApproval();
  const second = {
    ...formalApproval({
      fromValue: 'Intentional formal edit',
      approvedValue: 'Second approved edit',
    }),
    approvalId: 'formal-change-alpha-notes-en-02',
  };
  snapshots.formalRows[0]['Notes EN'] = 'Second approved edit';
  let result = validateAllData({
    ...snapshots,
    formalChangeApprovals: formalApprovalManifest([first, second]),
    baselineSha256: 'sha256:test-baseline',
    expectedCount: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.counts.formalApprovals, 2);

  snapshots.formalRows[0]['Notes EN'] = 'Intentional formal edit';
  result = validateAllData({
    ...snapshots,
    formalChangeApprovals: formalApprovalManifest([first, second]),
    baselineSha256: 'sha256:test-baseline',
    expectedCount: 2,
  });
  assert.equal(result.ok, false);
  assert.equal(result.layers.approvals, true);
  assert.equal(result.layers.formal, false);
  assert.equal(result.reconciliation.formalDifferenceCount, 1);
  assert.equal(result.issues[0].code, 'FORMAL_BASELINE_DRIFT');
});

test('formal approval manifest rejects a broken chain, PoC sync, or baseline hash', () => {
  const snapshots = validSnapshots();
  const brokenChain = formalApproval({ fromValue: 'Not the baseline' });
  const syncPoc = formalApproval({
    slug: 'beta',
    fromValue: '',
    approvedValue: 'Beta edit',
    syncPoc: true,
  });
  const result = validateAllData({
    ...snapshots,
    formalChangeApprovals: formalApprovalManifest([brokenChain, syncPoc]),
    baselineSha256: 'sha256:different-baseline',
    expectedCount: 2,
  });
  const codes = new Set(result.issues.map(({ code }) => code));

  assert.equal(result.layers.approvals, false);
  assert.equal(codes.has('FORMAL_APPROVAL_BASELINE_HASH_MISMATCH'), true);
  assert.equal(codes.has('FORMAL_APPROVAL_CHAIN_MISMATCH'), true);
  assert.equal(codes.has('FORMAL_APPROVAL_POC_SYNC_FORBIDDEN'), true);
});

test('Slug integrity compares the Notion page ID without title contamination', () => {
  const compactId = '3a1c23158ea28176adaac0c9b107b49a';
  const pageId = '3a1c2315-8ea2-8176-adaa-c0c9b107b49a';
  const baseline = {
    rows: [
      {
        slug: '10',
        pageUrl: `https://app.notion.com/p/${compactId}`,
        fields: legacyFields('10'),
      },
    ],
  };
  const pocRows = [
    {
      Slug: '10',
      __pageId: pageId,
      __pageUrl: `https://www.notion.so/10-${compactId}`,
    },
  ];
  const formalRows = [{ Slug: '10' }];

  const matching = validateSlugIntegrity({
    baseline,
    pocRows,
    formalRows,
    expectedCount: 1,
  });
  assert.equal(
    matching.issues.some(({ code }) => code === 'POC_PAGE_ID_DRIFT'),
    false
  );

  pocRows[0].__pageId = '00000000-0000-0000-0000-000000000000';
  const changed = validateSlugIntegrity({
    baseline,
    pocRows,
    formalRows,
    expectedCount: 1,
  });
  assert.equal(
    changed.issues.some(({ code }) => code === 'POC_PAGE_ID_DRIFT'),
    true
  );
});

test('formal reconciliation fails closed on any of the 17 baseline fields', () => {
  const { baseline, formalRows } = validSnapshots();
  formalRows[0].Name = 'Unexpected rename';
  const result = reconcileFormalRows({ baseline, formalRows });
  assert.equal(result.differenceCount, 1);
  assert.equal(result.issues[0].code, 'FORMAL_BASELINE_DRIFT');
  assert.equal(result.issues[0].field, 'Name');
});

test('PoC reconciliation rejects an untraced formal-field change', () => {
  const { baseline, pocRows } = validSnapshots();
  pocRows[1].Name = 'Untraced rename';
  const result = reconcilePocRows({ baseline, pocRows });
  assert.equal(
    result.issues.some(
      ({ code, field }) =>
        code === 'POC_DIFFERENCE_UNTRACED' && field === 'Name'
    ),
    true
  );
});

test('Need Research is a valid completed state that retains its Candidate', () => {
  const base = workflowDefaults({
    ...legacyFields('research'),
    Status: 'Paused',
  });
  const candidate = buildCandidatePatch({
    row: base,
    dataSourceId: POC_DATA_SOURCE_ID,
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
  const { pocRows } = validSnapshots();
  pocRows[1].Status = 'Verified';
  pocRows[1]['Google Place ID'] = pocRows[0]['Google Place ID'];
  pocRows[0]['Apply Metadata'] = metadata({
    decision: 'Keep Current',
    actionRunId: 'action-alpha',
    state: 'pending',
  });
  const result = validateTargetRows(pocRows, { expectedCount: 2 });
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
