import { randomUUID } from 'node:crypto';
import { ORANGE_BRANCHES } from '../../../src/data/exchange-rates-1965-branch.js';
import { breakerBlocks, clearFailedRuns, nextBreakerState } from './exchange-rates-1965-breaker.mjs';
import { createBreaker, isValidBreaker } from './exchange-rates-1965-contract.mjs';
import { conditionalSetJSON, readEntry } from './exchange-rates-1965-storage.mjs';

export const SOURCE_GUARD_KEY = 'exchange-rates-1965/source-guard';
export const SOURCE_GUARD_SCHEMA_VERSION = 1;
export const SOURCE_RECONCILE_REASON = 'operator_source_review';
export const SOURCE_FAILURE_DELAY_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/;
const STATE_KEYS = ['schemaVersion', 'sourceEpoch', 'paused', 'breaker', 'leaseId', 'leaseUntilMs', 'nextRequestAtMs', 'unresolvedAttempt'];
const ATTEMPT_KEYS = ['operationId', 'ownerId', 'slug', 'startedAtMs'];
const BREAKER_KEYS = ['controlVersion', 'consecutiveFailedRuns', 'blockLevel', 'blockedUntil', 'lastStatus', 'lastError'];

/** @param {unknown} value @param {string[]} keys @returns {value is Record<string, any>} */
function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
/** @param {unknown} value @returns {value is number} */
const timestamp = value => Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
/** @param {unknown} value @returns {value is string} */
const validID = value => typeof value === 'string' && ID.test(value);
/** @param {unknown} value @returns {value is string} */
const validUUID = value => typeof value === 'string' && UUID.test(value);

/** Tokens and arbitrary metadata are deliberately absent from this bounded state.
 * @param {unknown} value @returns {value is Record<string, any>}
 */
export function isValidSourceGuard(value) {
  const keys = value !== null && typeof value === 'object' && Object.hasOwn(value, 'lastReconciliation')
    ? [...STATE_KEYS, 'lastReconciliation'] : STATE_KEYS;
  if (!exactKeys(value, keys) || value.schemaVersion !== SOURCE_GUARD_SCHEMA_VERSION ||
      !validUUID(value.sourceEpoch) || typeof value.paused !== 'boolean' ||
      !exactKeys(value.breaker, BREAKER_KEYS) || !isValidBreaker(value.breaker) || value.breaker.controlVersion !== value.sourceEpoch ||
      !(value.leaseId === null || validUUID(value.leaseId)) || !timestamp(value.leaseUntilMs) ||
      !timestamp(value.nextRequestAtMs) || (value.leaseId === null && value.leaseUntilMs !== 0)) return false;
  const audit = value.lastReconciliation;
  if (audit !== undefined && audit !== null && (!exactKeys(audit, ['reason', 'outcome', 'reviewedAtMs']) ||
      audit.reason !== SOURCE_RECONCILE_REASON || !['blocked', 'failed', 'complete'].includes(audit.outcome) ||
      !timestamp(audit.reviewedAtMs))) return false;
  const attempt = value.unresolvedAttempt;
  return attempt === null || (exactKeys(attempt, ATTEMPT_KEYS) && value.leaseId !== null &&
    validID(attempt.operationId) && validID(attempt.ownerId) && typeof attempt.slug === 'string' &&
    Object.hasOwn(ORANGE_BRANCHES, attempt.slug) && timestamp(attempt.startedAtMs) &&
    value.leaseUntilMs > attempt.startedAtMs);
}

/** @param {any} state @returns {number|null} */
function retryAt(state) {
  const blockedUntil = Date.parse(state?.breaker?.blockedUntil ?? '');
  const value = Math.max(Number.isFinite(blockedUntil) ? blockedUntil : 0,
    state?.leaseUntilMs ?? 0, state?.nextRequestAtMs ?? 0);
  return value > 0 ? value : null;
}

/** Read without initializing or mutating anything, including an abandoned lease.
 * @param {{store:any,nowMs?:number,expectedEpoch?:string}} input
 */
export async function readSourceGuard({ store, nowMs = Date.now(), expectedEpoch }) {
  try {
    if (!timestamp(nowMs)) return { ok: false, reason: 'invalid_guard_input', state: null, entry: null, retryAtMs: null };
    const entry = await readEntry(store, SOURCE_GUARD_KEY);
    if (!entry) return { ok: false, reason: 'source_guard_missing', state: null, entry: null, retryAtMs: null };
    if (!isValidSourceGuard(entry.data)) return { ok: false, reason: 'source_guard_invalid', state: null, entry: null, retryAtMs: null };
    const state = entry.data;
    if (expectedEpoch !== undefined && state.sourceEpoch !== expectedEpoch) return { ok: false, reason: 'source_epoch_mismatch', state, entry, retryAtMs: retryAt(state) };
    let reason = null;
    if (state.unresolvedAttempt && (state.paused || state.leaseUntilMs <= nowMs)) reason = 'unknown_outcome';
    else if (state.paused) reason = 'paused';
    else if (breakerBlocks(state.breaker, state.sourceEpoch, nowMs)) reason = 'cooldown';
    else if (state.leaseUntilMs > nowMs) reason = 'busy';
    else if (state.nextRequestAtMs > nowMs) reason = 'cooldown';
    return { ok: reason === null, reason, state, entry, retryAtMs: reason ? retryAt(state) : null };
  } catch {
    return { ok: false, reason: 'source_guard_unavailable', state: null, entry: null, retryAtMs: null };
  }
}

/** Explicit bootstrap only: callers must have reviewed every relevant legacy
 * store. Null means a verified absence; undefined or invalid data is unknown.
 * @param {{store:any,legacyBreakers:unknown[],legacyReviewed:boolean,sourceEpoch?:string,nowMs?:number,randomUUIDImpl?:()=>string}} input
 */
export async function bootstrapSourceGuard({ store, legacyBreakers, legacyReviewed, sourceEpoch,
  nowMs = Date.now(), randomUUIDImpl = randomUUID }) {
  if (legacyReviewed !== true || !Array.isArray(legacyBreakers) || legacyBreakers.length === 0 ||
      legacyBreakers.length > 100 || legacyBreakers.some(value => value !== null && !isValidBreaker(value)) ||
      !timestamp(nowMs)) return { ok: false, reason: 'legacy_state_unknown', state: null };
  const epoch = sourceEpoch ?? randomUUIDImpl();
  if (!validUUID(epoch)) return { ok: false, reason: 'invalid_guard_input', state: null };
  try {
    const existing = await readEntry(store, SOURCE_GUARD_KEY);
    if (existing) return { ok: false, reason: isValidSourceGuard(existing.data) ? 'source_guard_exists' : 'source_guard_invalid', state: null };
    const breaker = createBreaker(epoch);
    for (const candidate of legacyBreakers) {
      if (!isValidBreaker(candidate)) continue;
      breaker.blockLevel = Math.max(breaker.blockLevel, candidate.blockLevel);
      breaker.consecutiveFailedRuns = Math.max(breaker.consecutiveFailedRuns, candidate.consecutiveFailedRuns);
      if (Date.parse(candidate.blockedUntil ?? '') > Date.parse(breaker.blockedUntil ?? '1970-01-01T00:00:00.000Z')) breaker.blockedUntil = candidate.blockedUntil;
    }
    if (breaker.blockLevel > 0) { breaker.lastStatus = 'blocked'; breaker.lastError = 'source_blocked'; }
    else if (breaker.consecutiveFailedRuns > 0) { breaker.lastStatus = 'failed'; breaker.lastError = 'source_failed'; }
    const state = { schemaVersion: SOURCE_GUARD_SCHEMA_VERSION, sourceEpoch: epoch, paused: true, breaker,
      leaseId: null, leaseUntilMs: 0, nextRequestAtMs: 0, unresolvedAttempt: null, lastReconciliation: null };
    const write = await conditionalSetJSON(store, SOURCE_GUARD_KEY, state, null);
    return { ok: write.modified, reason: write.modified ? null : 'source_guard_conflict', state: write.modified ? state : null };
  } catch { return { ok: false, reason: 'source_guard_unavailable', state: null }; }
}

/** A pause/resume never replaces the epoch, clears a breaker or resolves an
 * unknown attempt. A concurrent pause must survive every collector mutation.
 * @param {{store:any,paused:boolean,nowMs?:number,expectedEpoch?:string}} input
 */
export async function setSourceGuardPaused({ store, paused, nowMs = Date.now(), expectedEpoch }) {
  if (typeof paused !== 'boolean') return { ok: false, reason: 'invalid_guard_input', state: null };
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readSourceGuard({ store, nowMs, expectedEpoch });
    if (!current.state || !current.entry || current.reason === 'source_epoch_mismatch') return current;
    if (!paused && current.state.unresolvedAttempt) return { ...current, ok: false, reason: 'unknown_outcome' };
    const state = { ...current.state, paused };
    try {
      const write = await conditionalSetJSON(store, SOURCE_GUARD_KEY, state, current.entry);
      if (write.modified) return { ok: true, reason: null, state, retryAtMs: retryAt(state) };
    } catch { return { ok: false, reason: 'source_guard_unavailable', state: current.state, retryAtMs: retryAt(current.state) }; }
  }
  return { ok: false, reason: 'source_guard_conflict', state: null };
}

/** Atomically reserve the source and pre-record an unresolved outcome BEFORE
 * token GET. Missing guard/control data can never be initialized here.
 * @param {{store:any,operationId:string,ownerId:string,slug:string,nowMs?:number,leaseMs?:number,expectedEpoch?:string,randomUUIDImpl?:()=>string}} input
 */
export async function beginSourceAttempt({ store, operationId, ownerId, slug, nowMs = Date.now(),
  leaseMs = 24_000, expectedEpoch, randomUUIDImpl = randomUUID }) {
  if (!validID(operationId) || !validID(ownerId) || !Object.hasOwn(ORANGE_BRANCHES, slug) ||
      !timestamp(nowMs) || !Number.isSafeInteger(leaseMs) || leaseMs < 24_000 || leaseMs > 12 * 60_000 ||
      !timestamp(nowMs + leaseMs)) return { ok: false, reason: 'invalid_guard_input', lease: null, retryAtMs: null };
  const current = await readSourceGuard({ store, nowMs, expectedEpoch });
  if (!current.ok || !current.state || !current.entry) {
    if (current.reason === 'unknown_outcome' && current.state && current.entry && !current.state.paused) {
      try { await conditionalSetJSON(store, SOURCE_GUARD_KEY, { ...current.state, paused: true }, current.entry); }
      catch { /* The durable unresolved marker still prevents another request. */ }
    }
    return { ...current, lease: null };
  }
  const leaseId = randomUUIDImpl();
  if (!validUUID(leaseId)) return { ok: false, reason: 'invalid_guard_input', lease: null, retryAtMs: null };
  const leaseUntilMs = nowMs + leaseMs;
  const state = { ...current.state, leaseId, leaseUntilMs,
    unresolvedAttempt: { operationId, ownerId, slug, startedAtMs: nowMs } };
  try {
    const write = await conditionalSetJSON(store, SOURCE_GUARD_KEY, state, current.entry);
    if (!write.modified) return { ok: false, reason: 'busy', lease: null, retryAtMs: retryAt(state) };
    return { ok: true, reason: null, lease: { sourceEpoch: state.sourceEpoch, leaseId,
      leaseUntilMs, operationId, ownerId, slug }, state, retryAtMs: null };
  } catch { return { ok: false, reason: 'source_guard_unavailable', lease: null, retryAtMs: retryAt(state) }; }
}

/** @param {any} state @param {any} lease */
function owns(state, lease) {
  const pending = state?.unresolvedAttempt;
  return lease && validUUID(lease.leaseId) && state?.sourceEpoch === lease.sourceEpoch &&
    state.leaseId === lease.leaseId && state.leaseUntilMs === lease.leaseUntilMs &&
    (!pending || (pending.operationId === lease.operationId && pending.ownerId === lease.ownerId && pending.slug === lease.slug));
}

/** Publication and source start both require a live owned lease; completed
 * source attempts retain it until the caller's finally block releases it.
 * @param {{store:any,lease:any,nowMs?:number}} input
 */
export async function validateSourceAttemptLease({ store, lease, nowMs = Date.now() }) {
  const current = await readSourceGuard({ store, nowMs, expectedEpoch: lease?.sourceEpoch });
  if (!current.state || !owns(current.state, lease)) return { ...current, ok: false, reason: current.reason === 'source_epoch_mismatch' ? current.reason : 'lease_lost' };
  if (current.state.leaseUntilMs <= nowMs) return { ...current, ok: false, reason: 'lease_expired' };
  if (current.state.paused) return { ...current, ok: false, reason: 'paused' };
  if (breakerBlocks(current.state.breaker, current.state.sourceEpoch, nowMs)) return { ...current, ok: false, reason: 'cooldown' };
  return { ...current, ok: true, reason: null };
}

/** Persist the actual outcome before any target mutation. Late owners may
 * still reconcile their result: an unresolved attempt cannot be re-leased.
 * Complete SINGLE branches never reset source escalation or failure history here;
 * only a published quote clears the failure count, via clearSourceFailedRuns.
 * @param {{store:any,lease:any,outcome:'complete'|'failed'|'blocked'|'unknown',nowMs?:number,retryAfterMs?:number|null}} input
 */
export async function finishSourceAttempt({ store, lease, outcome, nowMs = Date.now(), retryAfterMs = null }) {
  if (!['complete', 'failed', 'blocked', 'unknown'].includes(outcome) || !timestamp(nowMs)) return { ok: false, reason: 'invalid_guard_input', state: null, retryAtMs: null };
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readSourceGuard({ store, nowMs, expectedEpoch: lease?.sourceEpoch });
    if (!current.state || !current.entry || !owns(current.state, lease)) return { ...current, ok: false, reason: 'lease_lost' };
    if (!current.state.unresolvedAttempt) return { ...current, ok: false, reason: 'attempt_already_recorded' };
    let breaker = current.state.breaker;
    let paused = current.state.paused;
    if (outcome === 'blocked' || outcome === 'failed') {
      const transition = nextBreakerState(breaker, { controlVersion: current.state.sourceEpoch,
        outcome, nowMs, retryAfterMs });
      const previousUntil = Date.parse(breaker.blockedUntil ?? '');
      breaker = transition.breaker;
      if (Number.isFinite(previousUntil) && previousUntil > Date.parse(breaker.blockedUntil ?? '')) breaker = { ...breaker, blockedUntil: current.state.breaker.blockedUntil };
      paused ||= transition.autoDisable;
    }
    if (outcome === 'unknown') paused = true;
    const state = { ...current.state, breaker, paused,
      nextRequestAtMs: outcome === 'failed' ? Math.max(current.state.nextRequestAtMs, nowMs + SOURCE_FAILURE_DELAY_MS) : current.state.nextRequestAtMs,
      unresolvedAttempt: outcome === 'unknown' ? current.state.unresolvedAttempt : null };
    try {
      const write = await conditionalSetJSON(store, SOURCE_GUARD_KEY, state, current.entry);
      if (write.modified) return { ok: true, reason: outcome === 'unknown' ? 'unknown_outcome' : null, state, retryAtMs: retryAt(state) };
    } catch { return { ok: false, reason: 'source_guard_unavailable', state: current.state, retryAtMs: retryAt(current.state) }; }
  }
  return { ok: false, reason: 'source_guard_conflict', state: null, retryAtMs: null };
}

/** After a published quote, clear consecutive failures while the caller still
 * owns the lease. Block escalation and any active block time are kept.
 * @param {{store:any,lease:any,nowMs?:number}} input
 */
export async function clearSourceFailedRuns({ store, lease, nowMs = Date.now() }) {
  if (!timestamp(nowMs)) return { ok: false, reason: 'invalid_guard_input', state: null };
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readSourceGuard({ store, nowMs, expectedEpoch: lease?.sourceEpoch });
    if (!current.state || !current.entry || !owns(current.state, lease)) return { ...current, ok: false, reason: 'lease_lost' };
    if (current.state.unresolvedAttempt) return { ...current, ok: false, reason: 'unknown_outcome' };
    const breaker = clearFailedRuns(current.state.breaker);
    if (breaker === current.state.breaker) return { ok: true, reason: null, state: current.state };
    const state = { ...current.state, breaker };
    try {
      const write = await conditionalSetJSON(store, SOURCE_GUARD_KEY, state, current.entry);
      if (write.modified) return { ok: true, reason: null, state };
    } catch { return { ok: false, reason: 'source_guard_unavailable', state: current.state }; }
  }
  return { ok: false, reason: 'source_guard_conflict', state: null };
}

/** Never clears an unresolved result, even on cancellation or lease expiry.
 * @param {{store:any,lease:any,nowMs?:number,minGapMs?:number}} input
 */
export async function releaseSourceAttempt({ store, lease, nowMs = Date.now(), minGapMs = 1_500 }) {
  if (!timestamp(nowMs) || !timestamp(minGapMs) || minGapMs > 60_000 || !timestamp(nowMs + minGapMs)) return { ok: false, reason: 'invalid_guard_input', state: null };
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readSourceGuard({ store, nowMs, expectedEpoch: lease?.sourceEpoch });
    if (!current.state || !current.entry || !owns(current.state, lease)) return { ...current, ok: false, reason: 'lease_lost' };
    if (current.state.unresolvedAttempt) return { ...current, ok: false, reason: 'unknown_outcome' };
    const state = { ...current.state, leaseId: null, leaseUntilMs: 0,
      nextRequestAtMs: Math.max(current.state.nextRequestAtMs, nowMs + minGapMs) };
    try {
      const write = await conditionalSetJSON(store, SOURCE_GUARD_KEY, state, current.entry);
      if (write.modified) return { ok: true, reason: null, state, retryAtMs: retryAt(state) };
    } catch { return { ok: false, reason: 'source_guard_unavailable', state: current.state, retryAtMs: retryAt(current.state) }; }
  }
  return { ok: false, reason: 'source_guard_conflict', state: null };
}

/** Explicit operator reconciliation is separate from normal resume. It never
 * publishes quotes, resumes the source, rotates epochs or clears old cooldown.
 * @param {{store:any,expectedEpoch:string,expectedLeaseId:string,outcome:'complete'|'failed'|'blocked',nowMs?:number,reason:string}} input
 */
export async function reconcileSourceAttempt({ store, expectedEpoch, expectedLeaseId, outcome,
  nowMs = Date.now(), reason }) {
  if (!validUUID(expectedEpoch) || !validUUID(expectedLeaseId) || !timestamp(nowMs) ||
      !['complete', 'failed', 'blocked'].includes(outcome) || reason !== SOURCE_RECONCILE_REASON) {
    return { ok: false, reason: 'invalid_guard_input', state: null, retryAtMs: null };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readSourceGuard({ store, nowMs, expectedEpoch });
    if (!current.state || !current.entry || current.reason === 'source_epoch_mismatch') return current;
    if (!current.state.paused || !current.state.unresolvedAttempt || current.state.leaseId !== expectedLeaseId ||
        current.state.leaseUntilMs > nowMs) return { ...current, ok: false, reason: 'reconciliation_not_allowed' };
    let breaker = current.state.breaker;
    if (outcome !== 'complete') {
      breaker = nextBreakerState(breaker, { controlVersion: expectedEpoch, outcome, nowMs }).breaker;
      const previousUntil = Date.parse(current.state.breaker.blockedUntil ?? '');
      if (Number.isFinite(previousUntil) && previousUntil > (Date.parse(breaker.blockedUntil ?? '') || 0)) {
        breaker = { ...breaker, blockedUntil: current.state.breaker.blockedUntil };
      }
    }
    const state = { ...current.state, paused: true, breaker, unresolvedAttempt: null,
      leaseId: null, leaseUntilMs: 0, nextRequestAtMs: Math.max(current.state.nextRequestAtMs,
        nowMs + (outcome === 'failed' ? SOURCE_FAILURE_DELAY_MS : 1_500)),
      lastReconciliation: { reason: SOURCE_RECONCILE_REASON, outcome, reviewedAtMs: nowMs } };
    try {
      const write = await conditionalSetJSON(store, SOURCE_GUARD_KEY, state, current.entry);
      if (write.modified) return { ok: true, reason: null, state, retryAtMs: retryAt(state) };
    } catch { return { ok: false, reason: 'source_guard_unavailable', state: current.state, retryAtMs: retryAt(current.state) }; }
  }
  return { ok: false, reason: 'source_guard_conflict', state: null, retryAtMs: null };
}
