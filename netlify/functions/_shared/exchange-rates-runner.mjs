import { randomUUID } from 'node:crypto';
import DEFAULT_BRANCH_MAPPING from '../../../data/superrich-branches.json' with { type: 'json' };

import { nextBreakerState, breakerBlocks } from './exchange-rates-breaker.mjs';
import {
  buildSnapshot,
  createBreaker,
  createControl,
  EXCHANGE_KEYS,
  isValidBreaker,
} from './exchange-rates-contract.mjs';
import { ensureFetchControl, readEffectiveControl, resetBreakerForControl } from './exchange-rates-control.mjs';
import { collectSourceQuotes } from './exchange-rates-source.mjs';
import { conditionalSetJSON, readEntry } from './exchange-rates-storage.mjs';

/** @param {unknown} [candidate] */
export async function loadBranchMapping(candidate = DEFAULT_BRANCH_MAPPING) {
  const mapping = /** @type {any} */ (structuredClone(candidate));
  if (mapping?.schemaVersion !== 1 || !mapping.branches || typeof mapping.branches !== 'object') {
    throw new Error('invalid_branch_mapping');
  }
  const entries = Object.entries(mapping.branches);
  const ids = entries.map(([, branch]) => branch.officialId);
  const codes = entries.map(([, branch]) => branch.branchCode);
  if (entries.length === 0 || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new Error('invalid_branch_mapping');
  }
  if (codes.some(code => typeof code !== 'string' || !/^[A-Z]{1,3}\d{1,3}$/.test(code)) || new Set(codes).size !== codes.length) {
    throw new Error('invalid_branch_mapping');
  }
  return mapping;
}

/** @param {any} collection */
function snapshotBranches(collection) {
  return collection.quotes.map((/** @type {any} */ branch) => ({
    slug: branch.slug,
    officialId: branch.quote.officialId,
    branchCode: branch.expectedBranchCode,
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
  const currentBreaker = await readEntry(store, EXCHANGE_KEYS.breaker);
  await resetBreakerForControl(store, disabled.controlVersion, currentBreaker, blockedUntil);
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
  enabledDefault = process.env.EXCHANGE_RATES_ENABLED,
  functionStartedAtMs = nowImpl(),
  sourceDeadlineMs,
  requestTimeoutMs,
}) {
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
    snapshotModified: snapshotWrite.modified,
    breakerModified,
    autoDisabled,
  };
}
