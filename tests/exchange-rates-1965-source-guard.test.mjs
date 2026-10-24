import assert from 'node:assert/strict';
import test from 'node:test';
import { createBreaker } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { BREAKER_BACKOFF_MS } from '../netlify/functions/_shared/exchange-rates-1965-breaker.mjs';
import { SOURCE_GUARD_KEY, SOURCE_RECONCILE_REASON, isValidSourceGuard, readSourceGuard,
  bootstrapSourceGuard, setSourceGuardPaused, beginSourceAttempt, validateSourceAttemptLease,
  finishSourceAttempt, releaseSourceAttempt, reconcileSourceAttempt, clearSourceFailedRuns,
} from '../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-20T01:00:00.000Z');
const EPOCH = uuid(100);
const slug = 'superrich1965-58';
const stateOf = store => store.entries.get(SOURCE_GUARD_KEY).data;

async function ready(legacyBreakers = [null]) {
  const store = new FakeBlobStore();
  assert.equal((await bootstrapSourceGuard({ store, legacyBreakers, legacyReviewed: true,
    sourceEpoch: EPOCH, nowMs: START })).ok, true);
  assert.equal((await setSourceGuardPaused({ store, paused: false, nowMs: START })).ok, true);
  let sequence = 200;
  const begin = (options = {}) => beginSourceAttempt({ store, operationId: 'ginaz5/lingorm-map:123', ownerId: uuid(2),
    slug, nowMs: START, leaseMs: 24_000, randomUUIDImpl: () => uuid(sequence++), ...options });
  return { store, begin };
}

test('guard reads fail closed without initialization for missing, malformed, epoch-mismatched or unavailable storage', async () => {
  const store = new FakeBlobStore();
  assert.equal((await readSourceGuard({ store, nowMs: START })).reason, 'source_guard_missing');
  assert.equal(store.calls.filter(call => call.operation === 'set').length, 0);
  store.seed(SOURCE_GUARD_KEY, { paused: false });
  assert.equal((await readSourceGuard({ store, nowMs: START })).reason, 'source_guard_invalid');
  const h = await ready();
  assert.equal((await readSourceGuard({ store: h.store, nowMs: START, expectedEpoch: uuid(999) })).reason, 'source_epoch_mismatch');
  h.store.getWithMetadata = async () => { throw new Error('PRIVATE_CREDENTIAL'); };
  const result = await readSourceGuard({ store: h.store, nowMs: START });
  assert.equal(result.reason, 'source_guard_unavailable');
  assert.equal(JSON.stringify(result).includes('PRIVATE_CREDENTIAL'), false);
});

test('bootstrap requires explicit complete legacy review, stays paused, and merges strictest history across control versions', async () => {
  for (const options of [{ legacyBreakers: [null], legacyReviewed: false }, { legacyBreakers: [], legacyReviewed: true },
    { legacyBreakers: [undefined], legacyReviewed: true }, { legacyBreakers: [{ blockLevel: 2 }], legacyReviewed: true }]) {
    const store = new FakeBlobStore();
    const result = await bootstrapSourceGuard({ store, sourceEpoch: EPOCH, nowMs: START, ...options });
    assert.equal(result.ok, false);
    assert.equal(store.entries.size, 0);
  }
  const store = new FakeBlobStore();
  const first = { ...createBreaker(uuid(1), new Date(START + 10_000).toISOString()), blockLevel: 2 };
  const second = { ...createBreaker(uuid(2), new Date(START + 90_000).toISOString()), blockLevel: 1, consecutiveFailedRuns: 2 };
  const result = await bootstrapSourceGuard({ store, sourceEpoch: EPOCH, nowMs: START,
    legacyBreakers: [first, null, second], legacyReviewed: true });
  assert.equal(result.ok, true);
  assert.ok(isValidSourceGuard(result.state));
  assert.equal(result.state.paused, true);
  assert.equal(result.state.sourceEpoch, EPOCH);
  assert.equal(result.state.breaker.controlVersion, EPOCH);
  assert.equal(result.state.breaker.blockLevel, 2);
  assert.equal(result.state.breaker.consecutiveFailedRuns, 2);
  assert.equal(result.state.breaker.blockedUntil, second.blockedUntil);
  const before = structuredClone(stateOf(store));
  assert.equal((await bootstrapSourceGuard({ store, legacyBreakers: [null], legacyReviewed: true,
    sourceEpoch: uuid(3), nowMs: START })).reason, 'source_guard_exists');
  assert.deepEqual(stateOf(store), before);
});

test('guard schema rejects unexpected state or attempt metadata and unsafe identities', async () => {
  const h = await ready();
  assert.equal(isValidSourceGuard({ ...stateOf(h.store), accessToken: 'PRIVATE' }), false);
  const begun = await h.begin();
  const state = stateOf(h.store);
  assert.equal(isValidSourceGuard({ ...state, unresolvedAttempt: { ...state.unresolvedAttempt, authorization: 'PRIVATE' } }), false);
  assert.equal(isValidSourceGuard({ ...state, sourceEpoch: uuid(1) }), false);
  assert.equal(isValidSourceGuard({ ...state, breaker: { ...state.breaker, rawBody: 'PRIVATE' } }), false);
  assert.equal(isValidSourceGuard({ ...state, leaseId: null }), false);
  assert.ok(begun.ok);
});

test('pause and resume retain epoch, expiry and failure history instead of resetting protection', async () => {
  const old = { ...createBreaker(uuid(9), new Date(START + 100_000).toISOString()), blockLevel: 2, consecutiveFailedRuns: 2 };
  const h = await ready([old]);
  assert.equal((await readSourceGuard({ store: h.store, nowMs: START })).reason, 'cooldown');
  await setSourceGuardPaused({ store: h.store, paused: true, nowMs: START });
  assert.equal((await h.begin()).reason, 'paused');
  await setSourceGuardPaused({ store: h.store, paused: false, nowMs: START });
  assert.equal((await h.begin()).reason, 'cooldown');
  assert.equal(stateOf(h.store).sourceEpoch, EPOCH);
  assert.equal(stateOf(h.store).breaker.blockedUntil, old.blockedUntil);
  assert.equal(stateOf(h.store).breaker.blockLevel, 2);
  assert.equal(stateOf(h.store).breaker.consecutiveFailedRuns, 2);
});

test('source acquisition persists lease and unresolved marker together, with only one concurrent winner', async () => {
  const h = await ready();
  const results = await Promise.all([h.begin(), h.begin({ ownerId: uuid(3), operationId: 'ginaz5/lingorm-map:124' })]);
  assert.equal(results.filter(result => result.ok).length, 1);
  const winner = results.find(result => result.ok);
  const state = stateOf(h.store);
  assert.equal(state.leaseId, winner.lease.leaseId);
  assert.equal(state.unresolvedAttempt.ownerId, winner.lease.ownerId);
  assert.equal(state.unresolvedAttempt.operationId, winner.lease.operationId);
  assert.equal(state.unresolvedAttempt.startedAtMs, START);
  assert.equal((await validateSourceAttemptLease({ store: h.store, lease: winner.lease, nowMs: START })).ok, true);
  assert.equal((await h.begin({ slug: 'superrich1965-56' })).reason, 'busy');
});

test('missing guards, invalid inputs, active gate and competing CAS never grant source permission', async () => {
  const store = new FakeBlobStore();
  assert.equal((await beginSourceAttempt({ store, operationId: 'repo:1', ownerId: uuid(2), slug, nowMs: START })).ok, false);
  const h = await ready();
  for (const options of [{ slug: 'unknown' }, { ownerId: 'PRIVATE\nTOKEN' }, { leaseMs: 100 }, { expectedEpoch: uuid(999) }]) {
    assert.equal((await h.begin(options)).ok, false);
    assert.equal(stateOf(h.store).unresolvedAttempt, null);
  }
  h.store.seed(SOURCE_GUARD_KEY, { ...stateOf(h.store), nextRequestAtMs: START + 1_000 });
  assert.equal((await h.begin()).reason, 'cooldown');
  h.store.seed(SOURCE_GUARD_KEY, { ...stateOf(h.store), nextRequestAtMs: 0 });
  let raced = false;
  h.store.beforeSet = ({ key, store: current }) => {
    if (key === SOURCE_GUARD_KEY && !raced) {
      raced = true;
      current.seed(key, { ...stateOf(current), paused: true });
    }
  };
  assert.equal((await h.begin()).ok, false);
  assert.equal(stateOf(h.store).paused, true);
  assert.equal(stateOf(h.store).unresolvedAttempt, null);
});

test('one successful branch clears only its unresolved result, retaining lease and escalation until owned release', async () => {
  const previous = { ...createBreaker(uuid(9), new Date(START - 1).toISOString()), blockLevel: 2, consecutiveFailedRuns: 2 };
  const h = await ready([previous]);
  const { lease } = await h.begin();
  const complete = await finishSourceAttempt({ store: h.store, lease, outcome: 'complete', nowMs: START + 500 });
  assert.equal(complete.ok, true);
  assert.equal(stateOf(h.store).unresolvedAttempt, null);
  assert.equal(stateOf(h.store).leaseId, lease.leaseId);
  assert.equal(stateOf(h.store).breaker.blockLevel, 2);
  assert.equal(stateOf(h.store).breaker.consecutiveFailedRuns, 2);
  assert.equal((await validateSourceAttemptLease({ store: h.store, lease, nowMs: START + 501 })).ok, true);
  assert.equal((await finishSourceAttempt({ store: h.store, lease, outcome: 'blocked', nowMs: START + 502 })).reason, 'attempt_already_recorded');
  assert.equal((await releaseSourceAttempt({ store: h.store, lease: { ...lease, leaseId: uuid(999) }, nowMs: START + 600 })).ok, false);
  assert.equal((await releaseSourceAttempt({ store: h.store, lease, nowMs: START + 600 })).ok, true);
  assert.equal(stateOf(h.store).leaseId, null);
  assert.equal((await h.begin({ nowMs: START + 2_099 })).reason, 'cooldown');
  assert.equal((await h.begin({ nowMs: START + 2_100 })).ok, true);
});

for (const level of [0, 1, 2]) {
  test(`challenge after source blockLevel ${level} follows existing ladder and globally pauses at level 3`, async () => {
    const h = await ready([{ ...createBreaker(uuid(9)), blockLevel: level }]);
    const { lease } = await h.begin();
    const result = await finishSourceAttempt({ store: h.store, lease, outcome: 'blocked', nowMs: START + 500 });
    assert.equal(result.ok, true);
    assert.equal(result.state.breaker.blockLevel, level + 1);
    assert.equal(result.state.paused, level === 2);
    assert.equal(result.state.unresolvedAttempt, null);
    if (level < 2) assert.equal(Date.parse(result.state.breaker.blockedUntil), START + 500 +
      (level === 0 ? BREAKER_BACKOFF_MS.first : BREAKER_BACKOFF_MS.second));
    await releaseSourceAttempt({ store: h.store, lease, nowMs: START + 600 });
    assert.equal((await h.begin({ slug: 'superrich1965-56', nowMs: START + 10_000 })).ok, false);
  });
}

test('Retry-After and concurrent longer cooldown are never shortened by source outcome recording', async () => {
  const h = await ready();
  const { lease } = await h.begin();
  const later = START + 48 * 60 * 60_000;
  const blocked = await finishSourceAttempt({ store: h.store, lease, outcome: 'blocked', nowMs: START + 1,
    retryAfterMs: later });
  assert.equal(Date.parse(blocked.state.breaker.blockedUntil), later);
  const other = await ready();
  const current = await other.begin();
  other.store.seed(SOURCE_GUARD_KEY, { ...stateOf(other.store), breaker: {
    ...stateOf(other.store).breaker, consecutiveFailedRuns: 2, blockedUntil: new Date(later).toISOString(),
  } });
  const failed = await finishSourceAttempt({ store: other.store, lease: current.lease, outcome: 'failed', nowMs: START + 1 });
  assert.equal(Date.parse(failed.state.breaker.blockedUntil), later);
});

test('ordinary source failure shares the 60 second gate across targets and trips the existing third-failure breaker', async () => {
  const h = await ready();
  for (let index = 0; index < 3; index++) {
    const nowMs = START + index * 60_001;
    const { lease } = await h.begin({ nowMs, operationId: `repo:${index}`, slug: index === 1 ? 'superrich1965-56' : slug });
    assert.ok(lease);
    const result = await finishSourceAttempt({ store: h.store, lease, outcome: 'failed', nowMs });
    assert.equal(result.ok, true);
    assert.equal(result.state.nextRequestAtMs, nowMs + 60_000);
    await releaseSourceAttempt({ store: h.store, lease, nowMs });
    assert.equal((await h.begin({ nowMs: nowMs + 1_500, ownerId: uuid(999) })).reason, 'cooldown');
    if (index === 2) assert.equal(Date.parse(stateOf(h.store).breaker.blockedUntil), nowMs + BREAKER_BACKOFF_MS.failedRuns);
  }
});

test('hard kill leaves durable unknown outcome after expiry and neither another target nor resume clears it', async () => {
  const h = await ready();
  const { lease } = await h.begin();
  assert.equal((await releaseSourceAttempt({ store: h.store, lease, nowMs: START + 1 })).reason, 'unknown_outcome');
  const before = structuredClone(stateOf(h.store));
  assert.equal((await readSourceGuard({ store: h.store, nowMs: START + 24_001 })).reason, 'unknown_outcome');
  assert.deepEqual(stateOf(h.store), before, 'inspect is read-only');
  const again = await h.begin({ operationId: 'repo:next-target', ownerId: uuid(3), nowMs: START + 24_001 });
  assert.equal(again.reason, 'unknown_outcome');
  assert.equal(stateOf(h.store).paused, true);
  assert.equal((await setSourceGuardPaused({ store: h.store, paused: false, nowMs: START + 24_002 })).reason, 'unknown_outcome');
  assert.equal((await validateSourceAttemptLease({ store: h.store, lease, nowMs: START + 24_002 })).ok, false);
});

test('failed 403 persistence cannot be followed by release or expiry-based retry', async () => {
  const h = await ready();
  const { lease } = await h.begin();
  h.store.beforeSet = () => { throw new Error('PRIVATE_STORAGE_ERROR'); };
  const result = await finishSourceAttempt({ store: h.store, lease, outcome: 'blocked', nowMs: START + 500 });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_STORAGE_ERROR'), false);
  assert.ok(stateOf(h.store).unresolvedAttempt);
  assert.equal((await releaseSourceAttempt({ store: h.store, lease, nowMs: START + 501 })).ok, false);
  h.store.beforeSet = null;
  assert.equal((await h.begin({ ownerId: uuid(3), nowMs: START + 24_001 })).reason, 'unknown_outcome');
  assert.equal(stateOf(h.store).paused, true);
});

test('outcome CAS retries preserve concurrent manual pause and update the latest breaker history once', async () => {
  const h = await ready();
  const { lease } = await h.begin();
  let raced = false;
  h.store.beforeSet = ({ key, store }) => {
    if (key === SOURCE_GUARD_KEY && !raced) {
      raced = true;
      store.seed(key, { ...stateOf(store), paused: true, breaker: { ...stateOf(store).breaker, blockLevel: 1 } });
    }
  };
  const result = await finishSourceAttempt({ store: h.store, lease, outcome: 'blocked', nowMs: START + 500 });
  assert.equal(result.ok, true);
  assert.equal(result.state.paused, true);
  assert.equal(result.state.breaker.blockLevel, 2);
  assert.equal(result.state.unresolvedAttempt, null);
  assert.equal((await validateSourceAttemptLease({ store: h.store, lease, nowMs: START + 501 })).ok, false);
});

test('old or forged owners cannot reconcile, publish under or release another source lease', async () => {
  const h = await ready();
  const { lease } = await h.begin();
  const forged = { ...lease, ownerId: uuid(999) };
  assert.equal((await finishSourceAttempt({ store: h.store, lease: forged, outcome: 'complete', nowMs: START + 1 })).ok, false);
  assert.equal((await validateSourceAttemptLease({ store: h.store, lease: forged, nowMs: START + 1 })).ok, false);
  assert.equal((await releaseSourceAttempt({ store: h.store, lease: forged, nowMs: START + 1 })).ok, false);
  assert.ok(stateOf(h.store).unresolvedAttempt);
});

test('explicit unknown outcome remains unresolved and paused until a reviewed expired-lease reconciliation', async () => {
  const h = await ready();
  const { lease } = await h.begin();
  const unknown = await finishSourceAttempt({ store: h.store, lease, outcome: 'unknown', nowMs: START + 1 });
  assert.equal(unknown.reason, 'unknown_outcome');
  assert.equal(unknown.state.paused, true);
  assert.ok(unknown.state.unresolvedAttempt);
  const input = { store: h.store, expectedEpoch: EPOCH, expectedLeaseId: lease.leaseId,
    outcome: 'blocked', reason: SOURCE_RECONCILE_REASON, nowMs: START + 24_001 };
  for (const options of [{ nowMs: START + 1 }, { expectedEpoch: uuid(999) }, { expectedLeaseId: uuid(999) }, { reason: 'PRIVATE_FREE_TEXT' }]) {
    assert.equal((await reconcileSourceAttempt({ ...input, ...options })).ok, false);
    assert.ok(stateOf(h.store).unresolvedAttempt);
  }
  const reconciled = await reconcileSourceAttempt(input);
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.state.paused, true);
  assert.equal(reconciled.state.unresolvedAttempt, null);
  assert.equal(reconciled.state.leaseId, null);
  assert.equal(reconciled.state.breaker.blockLevel, 1);
  assert.deepEqual(reconciled.state.lastReconciliation, { reason: SOURCE_RECONCILE_REASON,
    outcome: 'blocked', reviewedAtMs: START + 24_001 });
  assert.equal((await setSourceGuardPaused({ store: h.store, paused: false, nowMs: START + 24_002 })).ok, true);
  assert.equal((await h.begin({ nowMs: START + 24_003 })).reason, 'cooldown');
});

test('operator complete reconciliation retains existing history, stays paused and writes no quote', async () => {
  const h = await ready([{ ...createBreaker(uuid(9)), blockLevel: 2, consecutiveFailedRuns: 2 }]);
  const { lease } = await h.begin();
  await finishSourceAttempt({ store: h.store, lease, outcome: 'unknown', nowMs: START + 1 });
  const result = await reconcileSourceAttempt({ store: h.store, expectedEpoch: EPOCH,
    expectedLeaseId: lease.leaseId, outcome: 'complete', reason: SOURCE_RECONCILE_REASON, nowMs: START + 24_001 });
  assert.equal(result.ok, true);
  assert.equal(result.state.breaker.blockLevel, 2);
  assert.equal(result.state.breaker.consecutiveFailedRuns, 2);
  assert.equal(result.state.paused, true);
  assert.deepEqual([...h.store.entries.keys()], [SOURCE_GUARD_KEY]);
});

test('clearing source failures after publication keeps block level, block time and the held lease', async () => {
  const blockedUntil = new Date(START - 1000).toISOString();
  const h = await ready([{ ...createBreaker(uuid(9), blockedUntil), blockLevel: 2, consecutiveFailedRuns: 2 }]);
  const { lease } = await h.begin();
  assert.equal((await finishSourceAttempt({ store: h.store, lease, outcome: 'complete', nowMs: START + 1 })).ok, true);
  assert.equal(stateOf(h.store).breaker.consecutiveFailedRuns, 2);
  assert.equal((await clearSourceFailedRuns({ store: h.store, lease: { ...lease, leaseId: uuid(999) }, nowMs: START + 2 })).reason, 'lease_lost');
  const before = stateOf(h.store);
  const result = await clearSourceFailedRuns({ store: h.store, lease, nowMs: START + 2 });
  assert.equal(result.ok, true);
  assert.deepEqual(stateOf(h.store), { ...before, breaker: { ...before.breaker, consecutiveFailedRuns: 0 } });
  assert.equal(stateOf(h.store).breaker.blockLevel, 2);
  assert.equal(stateOf(h.store).breaker.blockedUntil, blockedUntil);
  assert.equal(stateOf(h.store).leaseId, lease.leaseId);
});
