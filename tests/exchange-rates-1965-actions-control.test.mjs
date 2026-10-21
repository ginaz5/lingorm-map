import assert from 'node:assert/strict';
import test from 'node:test';

import { parseActionsControlArgs, runActionsControlCommand } from '../scripts/exchange-rates-1965-actions-control.mjs';
import { EXCHANGE_KEYS, createBreaker } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { SOURCE_GUARD_KEY } from '../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { BRANCH_GATE_KEY } from '../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { BATCH_JOB_KEY } from '../netlify/functions/_shared/exchange-rates-1965-background.mjs';
import { LEGACY_PREVIEW_DEPLOY_IDS } from '../netlify/functions/_shared/exchange-rates-1965-actions-target.mjs';
import { FakeBlobStore, enabledControl, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-20T01:00:00.000Z');
const args = command => [command, '--target', 'preview-reviewed'];
const openWith = store => async input => ({ target: { alias: input.alias, kind: 'preview' },
  metadata: { id: '0'.repeat(24), state: 'ready' }, store, sourceGuardStore: { forbidden: true } });

function sourceFixture() {
  const store = new FakeBlobStore(), sourceGuardStore = new FakeBlobStore();
  const legacy = [new FakeBlobStore(), new FakeBlobStore(), new FakeBlobStore()];
  const openTargetImpl = async input => ({ target: { alias: input.alias, kind: 'preview' },
    metadata: { id: '0'.repeat(24), state: 'ready' }, store, sourceGuardStore,
    openLegacyStores: async () => legacy.map((store, index) => ({ store,
      label: index === 0 ? 'production' : `legacy-preview-${LEGACY_PREVIEW_DEPLOY_IDS[index - 1]}` })),
  });
  return { store, sourceGuardStore, legacy, openTargetImpl };
}

function guardState(overrides = {}) {
  return { schemaVersion: 1, sourceEpoch: uuid(10), paused: true, breaker: createBreaker(uuid(10)),
    leaseId: null, leaseUntilMs: 0, nextRequestAtMs: 0, unresolvedAttempt: null, ...overrides };
}

test('actions control requires explicit command and reviewed target; accepts only a bounded disable reason', () => {
  assert.deepEqual(parseActionsControlArgs(args('status')), { command: 'status', alias: 'preview-reviewed', reason: 'manual' });
  assert.deepEqual(parseActionsControlArgs([...args('disable'), '--reason', 'source_review']),
    { command: 'disable', alias: 'preview-reviewed', reason: 'source_review' });
  for (const input of [[], ['status'], ['enable', '--target', 'https://example.test'],
    [...args('enable'), '--force'], [...args('status'), '--reason', 'manual'],
    [...args('disable'), '--reason', 'invalid!'], [...args('disable'), '--reason']]) {
    assert.throws(() => parseActionsControlArgs(input), /invalid_actions_control_arguments/);
  }
});

test('inspect and status only read existing target control and breaker, never initialize absent data', async () => {
  for (const command of ['inspect', 'status']) {
    const store = new FakeBlobStore();
    const result = await runActionsControlCommand(args(command), { openTargetImpl: openWith(store) });
    assert.equal(result.control, null);
    assert.equal(result.breaker, null);
    assert.deepEqual(store.calls.map(call => call.key), [EXCHANGE_KEYS.control, EXCHANGE_KEYS.breaker]);
    assert.equal(store.calls.every(call => call.operation === 'get'), true);
  }
});

test('status strips unknown control and breaker fields and blob metadata', async () => {
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, { ...enabledControl(uuid(1), START), accessToken: 'mock-hidden-value' });
  store.seed(EXCHANGE_KEYS.breaker, { ...createBreaker(uuid(1)), Authorization: 'mock-hidden-value' });
  const result = await runActionsControlCommand(args('status'), { openTargetImpl: openWith(store) });
  assert.equal(result.control.enabled, true);
  assert.equal(JSON.stringify(result).includes('mock-hidden-value'), false);
  assert.equal(JSON.stringify(result).includes('etag'), false);
});

test('explicit enable can initialize target control; disable preserves an existing future cooldown', async () => {
  const store = new FakeBlobStore();
  await runActionsControlCommand(args('enable'), { openTargetImpl: openWith(store), nowMs: START, randomUUIDImpl: () => uuid(1) });
  assert.equal(store.entries.get(EXCHANGE_KEYS.control).data.enabled, true);
  const blockedUntil = new Date(START + 3_600_000).toISOString();
  store.seed(EXCHANGE_KEYS.breaker, { ...createBreaker(uuid(1), blockedUntil), blockLevel: 2 });
  const result = await runActionsControlCommand([...args('disable'), '--reason', 'maintenance'], {
    openTargetImpl: openWith(store), nowMs: START + 1_000, randomUUIDImpl: () => uuid(2),
  });
  assert.equal(result.control.enabled, false);
  assert.equal(result.control.disabledReason, 'maintenance');
  assert.equal(store.entries.get(EXCHANGE_KEYS.breaker).data.blockedUntil, blockedUntil);
  assert.equal(store.entries.get(EXCHANGE_KEYS.breaker).data.controlVersion, uuid(2));
});

test('invalid stored state and storage exceptions fail with fixed messages', async () => {
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, { bad: true, accessToken: 'mock-hidden-value' });
  await assert.rejects(runActionsControlCommand(args('status'), { openTargetImpl: openWith(store) }), /^Error: invalid_control$/);
  store.getWithMetadata = async () => { throw new Error('mock-sensitive-storage-error'); };
  await assert.rejects(runActionsControlCommand(args('status'), { openTargetImpl: openWith(store) }), /^Error: actions_control_unavailable$/);
});

test('target rejection occurs before target state reads or writes', async () => {
  const store = new FakeBlobStore();
  await assert.rejects(runActionsControlCommand(args('enable'), {
    openTargetImpl: async () => { throw new Error('target_metadata_mismatch'); },
  }), /target_metadata_mismatch/);
  assert.equal(store.calls.length, 0);
});

test('source bootstrap requires explicit stopped-work confirmation before opening any target', async () => {
  await assert.rejects(runActionsControlCommand(args('source-bootstrap'), {
    openTargetImpl: async () => assert.fail('must not open without confirmation'),
  }), /invalid_actions_control_arguments/);
});

test('source bootstrap reads all three legacy stores and the target, preserving the strongest block while paused', async () => {
  const f = sourceFixture();
  const blockedUntil = new Date(START + 6 * 3_600_000).toISOString();
  f.legacy[0].seed(EXCHANGE_KEYS.breaker, { ...createBreaker(uuid(1)), blockLevel: 2 });
  f.legacy[1].seed(EXCHANGE_KEYS.breaker, createBreaker(uuid(2), blockedUntil));
  f.store.seed(EXCHANGE_KEYS.breaker, { ...createBreaker(uuid(3)), consecutiveFailedRuns: 2 });
  const result = await runActionsControlCommand([...args('source-bootstrap'), '--confirm-legacy-stopped'], {
    openTargetImpl: f.openTargetImpl, nowMs: START, randomUUIDImpl: () => uuid(10),
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceGuard.paused, true);
  assert.equal(result.sourceGuard.breaker.blockedUntil, blockedUntil);
  assert.equal(result.sourceGuard.breaker.blockLevel, 2);
  assert.equal(result.sourceGuard.breaker.consecutiveFailedRuns, 2);
  for (const store of [...f.legacy, f.store]) {
    assert.deepEqual(store.calls.map(call => call.key), [EXCHANGE_KEYS.control, EXCHANGE_KEYS.breaker, BRANCH_GATE_KEY, BATCH_JOB_KEY]);
    assert.equal(store.calls.every(call => call.operation === 'get'), true);
  }
  assert.equal(f.sourceGuardStore.calls.filter(call => call.operation === 'set').length, 1);
});

test('active legacy gates, pending jobs and unknown legacy state all block bootstrap without mutating source state', async () => {
  for (const kind of ['gate', 'job', 'invalid', 'unavailable']) {
    const f = sourceFixture();
    if (kind === 'gate') f.legacy[0].seed(BRANCH_GATE_KEY, { leaseId: uuid(1), leaseUntilMs: START + 15_000, nextRequestAtMs: 0 });
    if (kind === 'job') f.legacy[1].seed(BATCH_JOB_KEY, { token: uuid(1), controlVersion: uuid(2), status: 'pending',
      scheduledAtMs: START, deadlineAtMs: START + 60_000, leaseId: null });
    if (kind === 'invalid') f.legacy[2].seed(EXCHANGE_KEYS.breaker, { unknown: true });
    if (kind === 'unavailable') f.legacy[0].getWithMetadata = async () => { throw new Error('mock-secret'); };
    await assert.rejects(runActionsControlCommand([...args('source-bootstrap'), '--confirm-legacy-stopped'], {
      openTargetImpl: f.openTargetImpl, nowMs: START,
    }), /legacy_(work_active|state_unknown)/);
    assert.equal(f.sourceGuardStore.calls.length, 0);
  }
});

test('enabled legacy producers block bootstrap even with empty gates and jobs; the new target may stay enabled', async () => {
  for (let index = 0; index < 3; index++) {
    const f = sourceFixture();
    f.legacy[index].seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), START));
    await assert.rejects(runActionsControlCommand([...args('source-bootstrap'), '--confirm-legacy-stopped'], {
      openTargetImpl: f.openTargetImpl, nowMs: START,
    }), /legacy_source_enabled/);
    assert.equal(f.sourceGuardStore.calls.length, 0);
  }
  const f = sourceFixture();
  f.store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(1), START));
  const result = await runActionsControlCommand([...args('source-bootstrap'), '--confirm-legacy-stopped'], {
    openTargetImpl: f.openTargetImpl, nowMs: START, randomUUIDImpl: () => uuid(10),
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceGuard.paused, true);
  assert.equal(f.store.entries.get(EXCHANGE_KEYS.control).data.enabled, true);
});

test('bootstrap rejects missing fixed legacy identities and does not overwrite an existing guard', async () => {
  const f = sourceFixture();
  const incomplete = async input => ({ ...await f.openTargetImpl(input),
    openLegacyStores: async () => [{ label: 'production', store: f.legacy[0] }] });
  await assert.rejects(runActionsControlCommand([...args('source-bootstrap'), '--confirm-legacy-stopped'], {
    openTargetImpl: incomplete, nowMs: START,
  }), /legacy_state_unknown/);
  f.sourceGuardStore.seed(SOURCE_GUARD_KEY, guardState());
  const result = await runActionsControlCommand([...args('source-bootstrap'), '--confirm-legacy-stopped'], {
    openTargetImpl: f.openTargetImpl, nowMs: START,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'source_guard_exists');
  assert.equal(f.sourceGuardStore.calls.some(call => call.operation === 'set'), false);
});

test('source status reads without writing; pause and resume preserve epoch and effective cooldown', async () => {
  const f = sourceFixture();
  const blockedUntil = new Date(START + 3_600_000).toISOString();
  f.sourceGuardStore.seed(SOURCE_GUARD_KEY, guardState({ breaker: createBreaker(uuid(10), blockedUntil) }));
  const status = await runActionsControlCommand(args('source-status'), { openTargetImpl: f.openTargetImpl, nowMs: START });
  assert.equal(status.ok, true);
  assert.equal(status.reason, 'paused');
  assert.equal(f.sourceGuardStore.calls.some(call => call.operation === 'set'), false);
  const resumed = await runActionsControlCommand(args('source-resume'), { openTargetImpl: f.openTargetImpl, nowMs: START });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.sourceGuard.sourceEpoch, uuid(10));
  assert.equal(resumed.sourceGuard.breaker.blockedUntil, blockedUntil);
  const paused = await runActionsControlCommand(args('source-pause'), { openTargetImpl: f.openTargetImpl, nowMs: START });
  assert.equal(paused.sourceGuard.paused, true);
  assert.equal(f.store.calls.length, 0, 'source commands never mutate target control');
});

test('source resume refuses an unresolved expired attempt and preserves the marker', async () => {
  const f = sourceFixture();
  const unresolvedAttempt = { operationId: 'repo/123', ownerId: 'runner/1', slug: 'superrich1965-58', startedAtMs: START - 30_000 };
  f.sourceGuardStore.seed(SOURCE_GUARD_KEY, guardState({ leaseId: uuid(11), leaseUntilMs: START - 1_000, unresolvedAttempt }));
  const result = await runActionsControlCommand(args('source-resume'), { openTargetImpl: f.openTargetImpl, nowMs: START });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown_outcome');
  assert.deepEqual(result.sourceGuard.unresolvedAttempt, unresolvedAttempt);
  assert.equal(f.sourceGuardStore.calls.some(call => call.operation === 'set'), false);
});

test('source reconcile requires exact epoch and lease confirmation; result stays paused and retains the block', async () => {
  const f = sourceFixture();
  const blockedUntil = new Date(START + 6 * 3_600_000).toISOString();
  const pending = { operationId: 'repo/123', ownerId: 'runner/1', slug: 'superrich1965-58', startedAtMs: START - 30_000 };
  f.sourceGuardStore.seed(SOURCE_GUARD_KEY, guardState({ breaker: createBreaker(uuid(10), blockedUntil),
    leaseId: uuid(11), leaseUntilMs: START - 1_000, unresolvedAttempt: pending }));
  const reconcile = [...args('source-reconcile'), '--epoch', uuid(10), '--lease-id', uuid(11), '--outcome', 'complete'];
  await assert.rejects(runActionsControlCommand(reconcile, { openTargetImpl: f.openTargetImpl }), /invalid_actions_control_arguments/);
  const result = await runActionsControlCommand([...reconcile, '--confirm-source-reviewed'], {
    openTargetImpl: f.openTargetImpl, nowMs: START,
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceGuard.paused, true);
  assert.equal(result.sourceGuard.unresolvedAttempt, null);
  assert.equal(result.sourceGuard.breaker.blockedUntil, blockedUntil);
  assert.deepEqual(result.sourceGuard.lastReconciliation, {
    reason: 'operator_source_review', outcome: 'complete', reviewedAtMs: START,
  });
});
