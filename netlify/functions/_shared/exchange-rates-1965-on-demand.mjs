import { randomUUID } from 'node:crypto';
import { branchCacheKey, branchResponse } from './exchange-rates-1965-branch-cache.mjs';
export { branchCacheKey, branchResponse } from './exchange-rates-1965-branch-cache.mjs';
import { BRANCH_API_SCHEMA_VERSION, ORANGE_BRANCHES, isValidBranchQuote } from '../../../src/data/exchange-rates-1965-branch.js';
import { EXCHANGE_KEYS, createBreaker, isValidBreaker, sanitizeDiagnostics } from './exchange-rates-1965-contract.mjs';
import { autoDisable, ensureFetchControl, readEffectiveControl } from './exchange-rates-1965-control.mjs';
import { breakerBlocks, clearFailedRuns, nextBreakerState } from './exchange-rates-1965-breaker.mjs';
import { conditionalSetJSON, readEntry } from './exchange-rates-1965-storage.mjs';
import { collectSourceQuotes } from './exchange-rates-1965-source.mjs';
import { nextUtcHalfHour, quoteExpiryMs } from '../../../src/data/exchange-rate-timing.js';
import { beginSourceAttempt, clearSourceFailedRuns, finishSourceAttempt, releaseSourceAttempt, validateSourceAttemptLease } from './exchange-rates-1965-source-guard.mjs';

export const BRANCH_GATE_KEY = 'exchange-rates-1965/on-demand-gate';
export const BRANCH_LEASE_MS = 15_000;
export const BRANCH_MIN_GAP_MS = 1_500;
export const BRANCH_FAILURE_DELAY_MS = 60_000;
const PROFILE = Object.freeze({ name: 'on-demand', concurrency: 1, minStartGapMs: 0, requestTimeoutMs: 5_000, deadlineMs: 6_000 });

/** @param {any} gate */
function validGate(gate) {
  return gate && (gate.leaseId === null || typeof gate.leaseId === 'string') &&
    Number.isSafeInteger(gate.leaseUntilMs) && gate.leaseUntilMs >= 0 &&
    Number.isSafeInteger(gate.nextRequestAtMs) && gate.nextRequestAtMs >= 0;
}

/** Clear only the breaker revision observed before this source attempt. A CAS
 * conflict belongs to a newer writer and must never be retried with its ETag.
 * This best-effort cleanup never changes the published response.
 * @param {any} store @param {string} version @param {any|null} previousEntry
 */
async function clearBreakerFailedRuns(store, version, previousEntry) {
  if (!previousEntry || !isValidBreaker(previousEntry.data) || previousEntry.data.controlVersion !== version) return;
  const breaker = clearFailedRuns(previousEntry.data);
  if (breaker === previousEntry.data) return;
  try { await conditionalSetJSON(store, EXCHANGE_KEYS.breaker, breaker, previousEntry); }
  catch { /* Keep newer failures or an unavailable breaker without failing publication. */ }
}

/** An authorized collector can fetch one whitelisted branch. A persistent CAS lease
 * serializes cold requests across server instances; warm cache hits bypass it.
 * @param {{store:any, slug:string, enabledDefault?:unknown, fetchImpl?:typeof fetch, nowImpl?:()=>number, randomUUIDImpl?:()=>string, refreshDue?:boolean, expectedControlVersion?:string, sourceProfile?:import('./exchange-rates-1965-source.mjs').SourceProfile, requireExistingControl?:boolean, publishQuote?:boolean, sourceGuardStore?:any, operationId?:string, ownerId?:string, signal?:AbortSignal, prepareSource?:()=>Promise<{reason:string,retryAtMs?:number|null}|null>, beforeSource?:()=>Promise<boolean>, beforePublish?:()=>Promise<boolean>, canContinue?:()=>boolean, onResult?:(result:any)=>void}} input
 */
export async function queryBranchRates({ store, slug, enabledDefault = process.env.EXCHANGE_RATES_1965_ENABLED,
  fetchImpl = fetch, nowImpl = Date.now, randomUUIDImpl = randomUUID, refreshDue = false, expectedControlVersion, sourceProfile = PROFILE,
  requireExistingControl = false, publishQuote = true, sourceGuardStore, operationId, ownerId, signal, prepareSource, beforeSource, beforePublish, canContinue, onResult }) {
  if (!Object.hasOwn(ORANGE_BRANCHES, slug)) return branchResponse(slug, nowImpl(), { status: 400, reason: 'invalid_request' });
  /** @type {any|null} */
  let lease = null;
  let releaseDelay = BRANCH_MIN_GAP_MS;
  /** @type {any} */
  let control = null;
  /** @type {any|null} */
  let sourceLease = null;
  let sourceSettled = false, collectionStarted = false, sourceSucceeded = false, quotePublished = false, sourceUnknown = false;
  let sourcePaused = false;
  /** @type {number|null} */
  let sourceRetryAtMs = null;
  // Private Function logs only. Never attach source details to public envelopes.
  const startedAtMs = nowImpl();
  /** @type {any} */
  const diagnostic = { event: 'exchange_rates_1965_branch', trigger: refreshDue ? 'background' : 'manual',
    slug, attemptedAt: new Date(startedAtMs).toISOString(), httpStatus: null, reason: null,
    sourceOutcome: null, sourceRequestCount: 0, blockedStatus: null, diagnostics: [],
    cooldownSource: null, retryAt: null, sourceProfile: sourceProfile.name };
  /** @param {any} options */
  const respond = options => {
    diagnostic.httpStatus = options.status ?? 200;
    diagnostic.reason = options.reason ?? null;
    diagnostic.retryAt = options.retryAtMs == null ? null : new Date(options.retryAtMs).toISOString();
    return branchResponse(slug, nowImpl(), options);
  };
  /** @param {string} reason @param {number} status @param {number|null} [retryAtMs] */
  const reply = (reason, status, retryAtMs = null) => respond({
    reason, status, retryAtMs: ['paused', 'unknown_outcome'].includes(reason) ? null : retryAtMs,
    enabled: control?.enabled ?? null, controlVersion: control?.controlVersion ?? null,
  });
  try {
    if (signal?.aborted) return reply('cancelled', 503);
    const effective = requireExistingControl ? await readEffectiveControl(store, 'false')
      : await ensureFetchControl(store, { enabledDefault, nowMs: nowImpl(), randomUUIDImpl });
    control = effective.control;
    if (!effective.enabled || !control) return reply('disabled', 503, nowImpl() + BRANCH_FAILURE_DELAY_MS);
    if (requireExistingControl && (!sourceGuardStore || !operationId || !ownerId || !expectedControlVersion)) {
      return reply('invalid_configuration', 503);
    }
    const version = control.controlVersion;
    if (expectedControlVersion && version !== expectedControlVersion) return reply('stale_control', 503);
    const cached = await readEntry(store, branchCacheKey(slug));
    let quote = cached?.data;
    const usable = (/** @type {any} */ candidate) => isValidBranchQuote(candidate) && candidate.slug === slug &&
      candidate.controlVersion === version && Date.parse(candidate.attemptedAt) >= Date.parse(control.enabledAt) &&
      Date.parse(candidate.expiresAt) > nowImpl();
    const reusable = (/** @type {any} */ candidate) => usable(candidate) &&
      (!refreshDue || nowImpl() < nextUtcHalfHour(Date.parse(candidate.attemptedAt)));
    if (reusable(quote)) {
      const latest = await readEffectiveControl(store, enabledDefault);
      if (!latest.enabled || latest.control?.controlVersion !== version) {
        control = latest.control;
        return reply(latest.enabled ? 'stale_control' : 'disabled', 503, nowImpl() + BRANCH_FAILURE_DELAY_MS);
      }
      if (!usable(quote)) return reply('unavailable', 503);
      return respond({ enabled: true, controlVersion: version, quote });
    }

    let breakerEntry = await readEntry(store, EXCHANGE_KEYS.breaker);
    if (breakerEntry && (!isValidBreaker(breakerEntry.data) || breakerEntry.data.controlVersion !== version)) return reply('invalid_control', 503);
    if (breakerBlocks(breakerEntry?.data, version, nowImpl())) {
      diagnostic.cooldownSource = 'breaker';
      return reply('cooldown', 429, Date.parse(breakerEntry.data.blockedUntil));
    }
    const gateEntry = await readEntry(store, BRANCH_GATE_KEY);
    if (gateEntry && !validGate(gateEntry.data)) return reply('storage_unavailable', 503);
    const gate = gateEntry?.data;
    if (gate?.leaseUntilMs > nowImpl()) return reply('busy', 202, gate.leaseUntilMs);
    if (gate?.nextRequestAtMs > nowImpl()) {
      diagnostic.cooldownSource = 'gate';
      return reply('cooldown', 429, gate.nextRequestAtMs);
    }
    // Token rotation waits happen only on a cold quote, before either lease
    // or the source deadline starts. A concurrent gate change loses the CAS.
    if (prepareSource) {
      const preparation = await prepareSource();
      if (preparation) return reply(preparation.reason, preparation.reason === 'busy' ? 202 : 503, preparation.retryAtMs ?? null);
    }
    if (signal?.aborted) return reply('cancelled', 503);
    const leaseMs = Math.max(BRANCH_LEASE_MS, sourceProfile.deadlineMs + 9_000);
    const gateValue = { leaseId: randomUUIDImpl(), leaseUntilMs: nowImpl() + leaseMs, nextRequestAtMs: nowImpl() + BRANCH_MIN_GAP_MS };
    const acquired = await conditionalSetJSON(store, BRANCH_GATE_KEY, gateValue, gateEntry);
    if (!acquired.modified) return reply('busy', 202, nowImpl() + 2_000);
    lease = { data: gateValue, etag: acquired.etag };

    // A disable, re-enable or breaker update during lease acquisition must
    // prevent a new upstream request, not just prevent cache publication.
    const before = await readEffectiveControl(store, enabledDefault);
    control = before.control;
    if (!before.enabled || control?.controlVersion !== version) return reply('stale_control', 503);
    breakerEntry = await readEntry(store, EXCHANGE_KEYS.breaker);
    if (breakerEntry && (!isValidBreaker(breakerEntry.data) || breakerEntry.data.controlVersion !== version)) return reply('invalid_control', 503);
    if (breakerBlocks(breakerEntry?.data, version, nowImpl())) {
      diagnostic.cooldownSource = 'breaker';
      return reply('cooldown', 429, Date.parse(breakerEntry.data.blockedUntil));
    }
    if (nowImpl() + sourceProfile.deadlineMs >= gateValue.leaseUntilMs) return reply('busy', 202, nowImpl() + 2_000);
    const refreshedCache = (await readEntry(store, branchCacheKey(slug)))?.data;
    if (reusable(refreshedCache)) return respond({ enabled: true, controlVersion: version, quote: refreshedCache });
    if (signal?.aborted || (canContinue && !canContinue()) || (beforeSource && !await beforeSource())) return reply(signal?.aborted ? 'cancelled' : 'lease_lost', 503);
    if (sourceGuardStore) {
      if (!operationId || !ownerId) return reply('invalid_configuration', 503);
      const begun = await beginSourceAttempt({ store: sourceGuardStore, operationId, ownerId, slug,
        nowMs: nowImpl(), leaseMs: Math.max(24_000, leaseMs), randomUUIDImpl });
      if (!begun.ok) return reply(begun.reason ?? 'source_guard_unavailable', begun.reason === 'busy' ? 202 : 503, begun.retryAtMs);
      sourceLease = begun.lease;
      const ownership = await validateSourceAttemptLease({ store: sourceGuardStore, lease: sourceLease, nowMs: nowImpl() });
      if (!ownership.ok) return reply(ownership.reason ?? 'lease_lost', 503, ownership.retryAtMs);
      const guardedControl = await readEffectiveControl(store, 'false');
      if (!guardedControl.enabled || guardedControl.control?.controlVersion !== version || signal?.aborted ||
          (beforeSource && !await beforeSource())) return reply(signal?.aborted ? 'cancelled' : 'stale_control', 503);
      const targetGate = (await readEntry(store, BRANCH_GATE_KEY))?.data;
      if (targetGate?.leaseId !== lease.data.leaseId || nowImpl() + sourceProfile.deadlineMs >= targetGate.leaseUntilMs ||
          nowImpl() + sourceProfile.deadlineMs >= sourceLease.leaseUntilMs) return reply('lease_lost', 503);
    }
    if (signal?.aborted || (canContinue && !canContinue())) return reply(signal?.aborted ? 'cancelled' : 'deadline', 503);
    const attemptedAtMs = nowImpl();
    collectionStarted = true;
    const collection = await collectSourceQuotes({
      mapping: { schemaVersion: 1, branches: { [slug]: ORANGE_BRANCHES[slug] } },
      fetchImpl, nowImpl, functionStartedAtMs: attemptedAtMs, profile: sourceProfile, allowRetry: false, signal,
    });
    diagnostic.sourceOutcome = collection.outcome;
    diagnostic.sourceRequestCount = collection.requestCount;
    diagnostic.blockedStatus = collection.blockedStatus;
    diagnostic.diagnostics = sanitizeDiagnostics(collection.diagnostics);
    sourceSucceeded = collection.outcome === 'complete';
    if (sourceGuardStore) {
      const guardOutcome = collection.outcome === 'blocked' ? 'blocked' : collection.requestCount === 0 ? 'complete' : signal?.aborted ? 'unknown'
        : collection.outcome === 'complete' ? 'complete' : 'failed';
      const finished = await finishSourceAttempt({ store: sourceGuardStore, lease: sourceLease,
        outcome: guardOutcome,
        nowMs: nowImpl(), retryAfterMs: collection.retryAfterMs });
      sourcePaused = finished.state?.paused === true;
      sourceRetryAtMs = finished.retryAtMs ?? null;
      sourceSettled = finished.ok;
      if (!finished.ok || signal?.aborted) {
        sourceUnknown = !finished.ok || guardOutcome === 'unknown';
        return reply(signal?.aborted ? 'cancelled' : 'source_guard_unavailable', 503, finished.retryAtMs);
      }
    }
    if (collection.outcome === 'blocked') diagnostic.cooldownSource = 'source_blocked';
    const latest = await readEffectiveControl(store, enabledDefault);
    control = latest.control;
    if (!latest.enabled || control?.controlVersion !== version || Date.parse(control.enabledAt) > attemptedAtMs) {
      return reply(latest.enabled ? 'stale_control' : 'disabled', 503);
    }
    if (collection.outcome !== 'complete') {
      releaseDelay = BRANCH_FAILURE_DELAY_MS;
      // Bounded CAS retries preserve a concurrent collector's or admin's newer
      // breaker state. Storage errors fail closed and leave the lease to expire.
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await readEntry(store, EXCHANGE_KEYS.breaker);
        if (current && (!isValidBreaker(current.data) || current.data.controlVersion !== version)) return reply('stale_control', 503);
        const transition = nextBreakerState(current?.data ?? createBreaker(version), {
          controlVersion: version, outcome: collection.outcome === 'blocked' ? 'blocked' : 'failed',
          nowMs: nowImpl(), retryAfterMs: collection.retryAfterMs,
        });
        const write = await conditionalSetJSON(store, EXCHANGE_KEYS.breaker, transition.breaker, current);
        if (!write.modified) continue;
        if (transition.autoDisable) {
          await autoDisable(store, latest.entry, control, { data: transition.breaker, etag: write.etag }, nowImpl(), randomUUIDImpl);
          control = (await readEffectiveControl(store, enabledDefault)).control;
        }
        // A target can be at its first block while the shared source is already
        // at its second. Report the actual longer restriction, or an explicit
        // pause with no automatic retry time when global protection trips.
        return reply(sourcePaused ? 'paused' : collection.outcome === 'blocked' ? 'cooldown' : 'unavailable',
          sourcePaused ? 503 : collection.outcome === 'blocked' ? 429 : 503,
          sourcePaused ? null : Math.max(nowImpl() + releaseDelay, Date.parse(transition.breaker.blockedUntil ?? '') || 0, sourceRetryAtMs ?? 0));
      }
      return reply('storage_unavailable', 503, nowImpl() + releaseDelay);
    }
    const result = collection.quotes[0];
    quote = { schemaVersion: BRANCH_API_SCHEMA_VERSION, slug, controlVersion: version,
      attemptedAt: new Date(attemptedAtMs).toISOString(), completedAt: new Date(nowImpl()).toISOString(),
      expiresAt: new Date(quoteExpiryMs(attemptedAtMs)).toISOString(),
      branch: { slug, ...ORANGE_BRANCHES[slug], status: 'ok', rates: result.quote.rates },
    };
    if (!isValidBranchQuote(quote) || Date.parse(quote.expiresAt) <= nowImpl()) return reply('unavailable', 503);
    if (signal?.aborted || (beforePublish && !await beforePublish())) return reply(signal?.aborted ? 'cancelled' : 'lease_lost', 503);
    const targetLease = await readEntry(store, BRANCH_GATE_KEY);
    if (targetLease?.data.leaseId !== lease.data.leaseId || targetLease.data.leaseUntilMs <= nowImpl()) return reply('lease_lost', 503);
    if (sourceGuardStore) {
      const owned = await validateSourceAttemptLease({ store: sourceGuardStore, lease: sourceLease, nowMs: nowImpl() });
      if (!owned.ok) return reply(owned.reason ?? 'lease_lost', 503, owned.retryAtMs);
    }
    const publishControl = await readEffectiveControl(store, 'false');
    if (!publishControl.enabled || publishControl.control?.controlVersion !== version || Date.parse(publishControl.control.enabledAt) > attemptedAtMs) {
      control = publishControl.control;
      return reply(publishControl.enabled ? 'stale_control' : 'disabled', 503);
    }
    // No await may intervene between these local deadline checks and the CAS.
    if (signal?.aborted || (canContinue && !canContinue()) || Date.parse(quote.expiresAt) <= nowImpl() ||
        lease.data.leaseUntilMs <= nowImpl() || (sourceLease && sourceLease.leaseUntilMs <= nowImpl())) {
      return reply(signal?.aborted ? 'cancelled' : 'deadline', 503);
    }
    if (!publishQuote) return respond({ enabled: true, controlVersion: version, quote });
    const write = await conditionalSetJSON(store, branchCacheKey(slug), quote, cached);
    if (!write.modified) return reply('busy', 202, nowImpl() + 2_000);
    const finalControl = await readEffectiveControl(store, enabledDefault);
    control = finalControl.control;
    if (!finalControl.enabled || control?.controlVersion !== version) return reply(finalControl.enabled ? 'stale_control' : 'disabled', 503);
    // A published quote clears consecutive failures in both breakers, but
    // keeps block escalation and active block time so challenges still escalate.
    quotePublished = true;
    await clearBreakerFailedRuns(store, version, breakerEntry);
    if (sourceLease) {
      try { await clearSourceFailedRuns({ store: sourceGuardStore, lease: sourceLease, nowMs: nowImpl() }); } catch { /* Best effort. */ }
    }
    return respond({ enabled: true, controlVersion: version, quote });
  } catch {
    releaseDelay = BRANCH_FAILURE_DELAY_MS;
    return reply('storage_unavailable', 503, nowImpl() + releaseDelay);
  } finally {
    if (sourceLease) {
      try {
        if (!sourceSettled) {
          const reconciled = await finishSourceAttempt({ store: sourceGuardStore, lease: sourceLease,
            outcome: collectionStarted ? 'unknown' : 'complete', nowMs: nowImpl() });
          sourceUnknown ||= collectionStarted;
          sourceSettled = reconciled.ok;
        }
        if (sourceSettled) await releaseSourceAttempt({ store: sourceGuardStore, lease: sourceLease, nowMs: nowImpl(), minGapMs: releaseDelay });
      } catch { sourceUnknown ||= collectionStarted; }
    }
    if (lease) {
      try {
        await conditionalSetJSON(store, BRANCH_GATE_KEY, { leaseId: null, leaseUntilMs: 0,
          nextRequestAtMs: nowImpl() + releaseDelay }, lease);
      } catch { /* The original lease expires; never retry a source request. */ }
    }
    try {
      console.info(JSON.stringify({ ...diagnostic, completedAt: new Date(nowImpl()).toISOString() }));
    } catch { /* Logging must not change a quote, lease or breaker result. */ }
    try {
      onResult?.({ status: sourceUnknown ? 'source_unknown' : sourceSucceeded
        ? (quotePublished ? 'published' : diagnostic.httpStatus === 200 && !publishQuote ? 'probe_succeeded' : 'publication_failed')
        : diagnostic.httpStatus === 200 ? 'cache_hit' : diagnostic.sourceRequestCount > 0 ? 'source_failed' : 'not_attempted',
        sourceSucceeded, sourceRequestCount: diagnostic.sourceRequestCount, reason: diagnostic.reason,
        retryAt: diagnostic.retryAt, diagnostics: diagnostic.diagnostics, sourceOutcome: diagnostic.sourceOutcome });
    } catch { /* Summary consumers do not change source or publication outcomes. */ }
  }
}
