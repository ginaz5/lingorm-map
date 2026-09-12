import { randomUUID } from 'node:crypto';
import DEFAULT_BRANCH_MAPPING from '../../../data/superrich1965-branches.json' with { type: 'json' };

import { nextBreakerState, breakerBlocks } from './exchange-rates-1965-breaker.mjs';
import {
  buildSnapshot,
  createBreaker,
  createControl,
  createLastAttempt,
  EXCHANGE_KEYS,
  isValidBreaker,
  isValidLastAttempt,
} from './exchange-rates-1965-contract.mjs';
import { ensureFetchControl, readEffectiveControl, resetBreakerForControl } from './exchange-rates-1965-control.mjs';
import { collectSourceQuotes, LOCAL_SOURCE_PROFILE } from './exchange-rates-1965-source.mjs';
import { conditionalSetJSON, readEntry } from './exchange-rates-1965-storage.mjs';

/** @param {unknown} [candidate] */
export async function loadBranchMapping(candidate = DEFAULT_BRANCH_MAPPING) {
  const mapping = /** @type {any} */ (structuredClone(candidate));
  if (mapping?.schemaVersion !== 1 || !mapping.branches || typeof mapping.branches !== 'object') {
    throw new Error('invalid_branch_mapping');
  }
  const entries = Object.entries(mapping.branches);
  if (Array.isArray(mapping.branches) || entries.length === 0 || entries.length > 38 || entries.some(([slug, branch]) =>
    !branch || !Number.isSafeInteger(branch.officialId) || branch.officialId <= 0 ||
    slug !== `superrich1965-${branch.officialId}` || branch.companyCode !== 'A04' ||
    typeof branch.branchNo !== 'string' || !/^\d{2}$/.test(branch.branchNo))) {
    throw new Error('invalid_branch_mapping');
  }
  if (new Set(entries.map(([, b]) => b.officialId)).size !== entries.length ||
      new Set(entries.map(([, b]) => b.branchNo)).size !== entries.length) throw new Error('invalid_branch_mapping');
  return mapping;
}

/** @param {any} collection */
function snapshotBranches(collection) {
  return collection.quotes.map((/** @type {any} */ branch) => ({
    slug: branch.slug,
    officialId: branch.officialId,
    branchNo: branch.quote.branchNo,
    companyCode: branch.companyCode,
    sourceUpdatedAtMs: branch.quote.sourceUpdatedAtMs,
    status: branch.quote.status,
    rates: branch.quote.rates,
  }));
}

/** @param {any} store @param {any} controlEntry @param {any} control @param {any} breakerEntry @param {number} nowMs @param {()=>string} randomUUIDImpl */
async function autoDisable(store, controlEntry, control, breakerEntry, nowMs, randomUUIDImpl) {
  const disabled = createControl({
    enabled: false,
    nowMs,
    controlVersion: randomUUIDImpl(),
    updatedBy: 'breaker',
    previous: control,
    disabledReason: 'source_blocked',
  });
  const result = await conditionalSetJSON(store, EXCHANGE_KEYS.control, disabled, controlEntry);
  if (!result.modified) return false;
  const blockedUntil = breakerEntry?.data?.blockedUntil && Date.parse(breakerEntry.data.blockedUntil) > nowMs
    ? breakerEntry.data.blockedUntil
    : null;
  // Keep the ETag of this run's breaker write. Re-reading here could adopt
  // a newer manual enable's ETag and overwrite its breaker with our version.
  await resetBreakerForControl(store, disabled.controlVersion, breakerEntry, blockedUntil);
  return true;
}

/**
 * @param {{store:any, mapping:any, fetchImpl?:typeof fetch, nowImpl?:()=>number, sleepImpl?:(ms:number)=>Promise<void>, randomUUIDImpl?:()=>string, enabledDefault?:unknown, functionStartedAtMs?:number, sourceDeadlineMs?:number, requestTimeoutMs?:number}} input
 */
export async function runExchangeRateFetch({
  store,
  mapping,
  fetchImpl = fetch,
  nowImpl = Date.now,
  sleepImpl,
  randomUUIDImpl = randomUUID,
  enabledDefault = process.env.EXCHANGE_RATES_1965_ENABLED,
  functionStartedAtMs = nowImpl(),
  sourceDeadlineMs,
  requestTimeoutMs,
}) {
  mapping = await loadBranchMapping(mapping);
  const effective = await ensureFetchControl(store, { enabledDefault, nowMs: functionStartedAtMs, randomUUIDImpl });
  if (!effective.enabled || !effective.control) return { status: 'disabled', sourceRequestCount: 0 };
  const control = effective.control;

  const snapshotEntry = await readEntry(store, EXCHANGE_KEYS.snapshot);
  const breakerEntry = await readEntry(store, EXCHANGE_KEYS.breaker);
  if (breakerEntry !== null && !isValidBreaker(breakerEntry.data)) throw new Error('invalid_breaker');
  if (breakerEntry !== null && breakerEntry.data.controlVersion !== control.controlVersion) {
    throw new Error('breaker_version_mismatch');
  }
  const breaker = breakerEntry?.data ?? createBreaker(control.controlVersion);
  if (breakerBlocks(breaker, control.controlVersion, nowImpl())) {
    return { status: 'blocked', sourceRequestCount: 0, blockedUntil: breaker.blockedUntil };
  }

  const attemptedAtMs = nowImpl();
  const collection = await collectSourceQuotes({
    mapping,
    fetchImpl,
    nowImpl,
    ...(sleepImpl ? { sleepImpl } : {}),
    functionStartedAtMs,
    ...(sourceDeadlineMs ? { sourceDeadlineMs } : {}),
    ...(requestTimeoutMs ? { requestTimeoutMs } : {}),
  });
  const completedAtMs = nowImpl();
  const snapshot = buildSnapshot({
    runId: randomUUIDImpl(),
    controlVersion: control.controlVersion,
    attemptedAtMs,
    completedAtMs,
    sourceBranchIds: collection.sourceBranchIds,
    branches: snapshotBranches(collection),
    unknownBranchCount: collection.unknownIds.length,
    missingBranchCount: collection.missingIds.length,
  });

  const latest = await readEffectiveControl(store, enabledDefault);
  if (!latest.control || !latest.control.enabled || latest.control.controlVersion !== control.controlVersion) {
    return { status: 'stale_control', sourceRequestCount: collection.requestCount };
  }
  if (Date.parse(latest.control.enabledAt) > attemptedAtMs) {
    return { status: 'stale_control', sourceRequestCount: collection.requestCount };
  }

  const snapshotWrite = await conditionalSetJSON(store, EXCHANGE_KEYS.snapshot, snapshot, snapshotEntry);
  const shouldUpdateBreaker = collection.outcome !== 'complete' || snapshotWrite.modified;
  let breakerModified = false;
  let autoDisabled = false;
  if (shouldUpdateBreaker) {
    const outcome = /** @type {'complete'|'partial'|'failed'|'blocked'} */ (collection.outcome);
    const transition = nextBreakerState(breaker, {
      controlVersion: control.controlVersion,
      outcome,
      nowMs: completedAtMs,
      retryAfterMs: collection.retryAfterMs,
    });
    const breakerWrite = await conditionalSetJSON(store, EXCHANGE_KEYS.breaker, transition.breaker, breakerEntry);
    breakerModified = breakerWrite.modified;
    if (!breakerModified) {
      const currentBreaker = await readEntry(store, EXCHANGE_KEYS.breaker);
      if (currentBreaker !== null && !isValidBreaker(currentBreaker.data)) throw new Error('invalid_breaker');
    }
    if (breakerModified && transition.autoDisable) {
      const breakerAfterWrite = { data: transition.breaker, etag: breakerWrite.etag, metadata: {} };
      autoDisabled = await autoDisable(store, latest.entry, latest.control, breakerAfterWrite, completedAtMs, randomUUIDImpl);
    }
  }

  return {
    status: snapshotWrite.modified ? 'published' : 'snapshot_conflict',
    runId: snapshotWrite.modified ? snapshot.runId : null,
    sourceOutcome: collection.outcome,
    sourceRequestCount: collection.requestCount,
    retryUsed: collection.retryUsed,
    diagnostics: collection.diagnostics,
    snapshotModified: snapshotWrite.modified,
    breakerModified,
    autoDisabled,
  };
}

/**
 * Persist a bounded run summary. An older run must never overwrite a newer
 * one, so the stored `attemptedAt` wins on conflict.
 * @param {any} store @param {any} attempt
 */
export async function writeLastAttempt(store, attempt) {
  const entry = await readEntry(store, EXCHANGE_KEYS.lastAttempt);
  if (entry !== null && isValidLastAttempt(entry.data) &&
      Date.parse(entry.data.attemptedAt) > Date.parse(attempt.attemptedAt)) {
    return { modified: false, skipped: 'newer_attempt_recorded' };
  }
  const write = await conditionalSetJSON(store, EXCHANGE_KEYS.lastAttempt, attempt, entry);
  return { modified: write.modified, skipped: write.modified ? null : 'attempt_write_conflict' };
}

/** @param {any} collection */
function branchCounts(collection) {
  const ok = collection.quotes.filter((/** @type {any} */ branch) => branch.quote.status === 'ok').length;
  return { okBranchCount: ok, failedBranchCount: collection.quotes.length - ok };
}

/**
 * Local collector run. Shares the source parser, snapshot contract, control
 * and breaker semantics with the scheduled function; differs only in pacing
 * profile and in requiring an explicit `publish` to write anything remote.
 *
 * Dry runs make REAL source requests but never write to the remote store.
 *
 * @param {{store:any, mapping:any, publish?:boolean, fetchImpl?:typeof fetch, nowImpl?:()=>number, sleepImpl?:(ms:number)=>Promise<void>, randomUUIDImpl?:()=>string, functionStartedAtMs?:number, profile?:any}} input
 */
export async function runLocalExchangeRateFetch({
  store,
  mapping,
  publish = false,
  fetchImpl = fetch,
  nowImpl = Date.now,
  sleepImpl,
  randomUUIDImpl = randomUUID,
  functionStartedAtMs = nowImpl(),
  profile = LOCAL_SOURCE_PROFILE,
}) {
  mapping = await loadBranchMapping(mapping);
  const mode = publish ? 'publish' : 'dry_run';

  // Never auto-create and never auto-enable: PUBLISHING requires a control a
  // human already enabled. A diagnostic run does not — probe and dry-run write
  // nothing, and must stay usable while the public card is off. Gating them on
  // control.enabled would make the source impossible to diagnose exactly when
  // it most needs diagnosing.
  const controlState = await readEffectiveControl(store, 'false');
  const control = controlState.control;
  if (publish) {
    if (!control) return { status: 'skipped', mode, reason: 'control_missing', sourceRequestCount: 0 };
    if (!control.enabled) {
      return { status: 'skipped', mode, reason: control.disabledReason ?? 'control_disabled', sourceRequestCount: 0 };
    }
  }

  const breakerEntry = control === null ? null : await readEntry(store, EXCHANGE_KEYS.breaker);
  if (breakerEntry !== null && !isValidBreaker(breakerEntry.data)) throw new Error('invalid_breaker');
  if (publish && control !== null && breakerEntry !== null &&
      breakerEntry.data.controlVersion !== control.controlVersion) {
    // Only the write path treats a version mismatch as corruption. A read-only
    // run simply ignores a breaker belonging to an older control version.
    throw new Error('breaker_version_mismatch');
  }
  const breaker = control === null ? null : breakerEntry?.data ?? createBreaker(control.controlVersion);
  // The remote cooldown still applies to diagnostic runs: it exists to stop us
  // hammering a source that is already refusing.
  if (control !== null && breaker !== null && breakerBlocks(breaker, control.controlVersion, nowImpl())) {
    return {
      status: 'skipped',
      mode,
      reason: 'remote_cooldown',
      blockedUntil: breaker.blockedUntil,
      sourceRequestCount: 0,
    };
  }

  const snapshotEntry = publish ? await readEntry(store, EXCHANGE_KEYS.snapshot) : null;
  const attemptedAtMs = nowImpl();
  const collection = await collectSourceQuotes({
    mapping,
    fetchImpl,
    nowImpl,
    ...(sleepImpl ? { sleepImpl } : {}),
    functionStartedAtMs,
    profile,
  });
  const completedAtMs = nowImpl();
  const snapshot = buildSnapshot({
    runId: randomUUIDImpl(),
    controlVersion: control?.controlVersion ?? randomUUIDImpl(),
    attemptedAtMs,
    completedAtMs,
    sourceBranchIds: collection.sourceBranchIds,
    branches: snapshotBranches(collection),
    unknownBranchCount: collection.unknownIds.length,
    missingBranchCount: collection.missingIds.length,
  });
  const counts = branchCounts(collection);
  const base = {
    mode,
    sourceOutcome: collection.outcome,
    sourceRequestCount: collection.requestCount,
    retryUsed: collection.retryUsed,
    retryAfterMs: collection.retryAfterMs ?? null,
    profile: collection.profile?.name ?? null,
    diagnostics: collection.diagnostics,
    attemptedAt: snapshot.attemptedAt,
    completedAt: snapshot.completedAt,
    nextUpdateAt: snapshot.nextUpdateAt,
    expiresAt: snapshot.expiresAt,
    remainingValidityMs: Date.parse(snapshot.expiresAt) - completedAtMs,
    controlVersion: control?.controlVersion ?? null,
    ...counts,
  };

  if (!publish) {
    // A dry run reports what the SOURCE did. Only a complete round is a
    // success: a partial or fully failed round must never read as `collected`,
    // or an operator would switch over on the strength of a round that
    // produced no usable rates.
    const dryRunStatus = collection.outcome === 'blocked' ? 'blocked'
      : collection.outcome === 'complete' ? 'collected'
        : 'not_published';
    return {
      ...base,
      status: dryRunStatus,
      reason: dryRunStatus === 'collected' ? null
        : collection.outcome === 'blocked' ? 'source_blocked' : `source_${collection.outcome}`,
      snapshotModified: false,
      breakerModified: false,
    };
  }

  // A control change during the round invalidates this run entirely: writing a
  // breaker or snapshot under a newer control version would corrupt it.
  const latest = await readEffectiveControl(store, 'false');
  if (!control || !breaker || !latest.control || !latest.control.enabled ||
      latest.control.controlVersion !== control.controlVersion ||
      Date.parse(latest.control.enabledAt) > attemptedAtMs) {
    return { ...base, status: 'skipped', reason: 'stale_control', snapshotModified: false, breakerModified: false };
  }

  let status = 'published';
  /** @type {string|null} */
  let reason = null;
  let snapshotModified = false;
  let snapshotWrite = { modified: false, etag: undefined };
  const publishDecisionAtMs = nowImpl();

  if (collection.outcome !== 'complete') {
    status = collection.outcome === 'blocked' ? 'blocked' : 'not_published';
    reason = collection.outcome === 'blocked' ? 'source_blocked' : `source_${collection.outcome}`;
  } else if (Date.parse(snapshot.expiresAt) <= publishDecisionAtMs) {
    // A full round that finished too late is not usable new data. Read the
    // clock HERE: collection ended before the control re-read above, and that
    // round trip can be the difference between valid and expired.
    status = 'not_published';
    reason = 'snapshot_expired';
  } else {
    snapshotWrite = await conditionalSetJSON(store, EXCHANGE_KEYS.snapshot, snapshot, snapshotEntry);
    snapshotModified = snapshotWrite.modified;
    if (!snapshotModified) {
      status = 'not_published';
      reason = 'snapshot_conflict';
    }
  }

  // Same rule as the scheduled runner: a full success clears the breaker only
  // once the snapshot is actually published.
  const shouldUpdateBreaker = collection.outcome !== 'complete' || snapshotModified;
  let breakerModified = false;
  let autoDisabled = false;
  if (shouldUpdateBreaker) {
    const outcome = /** @type {'complete'|'partial'|'failed'|'blocked'} */ (collection.outcome);
    const transition = nextBreakerState(breaker, {
      controlVersion: control.controlVersion,
      outcome,
      nowMs: completedAtMs,
      retryAfterMs: collection.retryAfterMs,
    });
    const breakerWrite = await conditionalSetJSON(store, EXCHANGE_KEYS.breaker, transition.breaker, breakerEntry);
    breakerModified = breakerWrite.modified;
    if (!breakerModified) {
      const currentBreaker = await readEntry(store, EXCHANGE_KEYS.breaker);
      if (currentBreaker !== null && !isValidBreaker(currentBreaker.data)) throw new Error('invalid_breaker');
    }
    if (breakerModified && transition.autoDisable) {
      const breakerAfterWrite = { data: transition.breaker, etag: breakerWrite.etag, metadata: {} };
      autoDisabled = await autoDisable(store, latest.entry, latest.control, breakerAfterWrite, completedAtMs, randomUUIDImpl);
    }
  }

  const attemptWrite = await writeLastAttempt(store, createLastAttempt({
    mode: 'publish',
    result: /** @type {any} */ (status),
    attemptedAtMs,
    completedAtMs,
    controlVersion: control.controlVersion,
    runId: snapshotModified ? snapshot.runId : null,
    sourceOutcome: collection.outcome,
    sourceRequestCount: collection.requestCount,
    okBranchCount: counts.okBranchCount,
    failedBranchCount: counts.failedBranchCount,
    reason,
    diagnostics: collection.diagnostics,
  }));

  return {
    ...base,
    remainingValidityMs: Date.parse(snapshot.expiresAt) - publishDecisionAtMs,
    status,
    reason,
    runId: snapshotModified ? snapshot.runId : null,
    snapshotModified,
    breakerModified,
    autoDisabled,
    lastAttemptModified: attemptWrite.modified,
  };
}
