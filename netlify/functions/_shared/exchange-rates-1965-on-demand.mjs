import { randomUUID } from 'node:crypto';
import { BRANCH_API_SCHEMA_VERSION, ORANGE_BRANCHES, isValidBranchQuote } from '../../../src/data/exchange-rates-1965-branch.js';
import { EXCHANGE_KEYS, createBreaker, isValidBreaker, isValidSnapshot, sanitizeDiagnostics } from './exchange-rates-1965-contract.mjs';
import { ensureFetchControl, readEffectiveControl } from './exchange-rates-1965-control.mjs';
import { breakerBlocks, nextBreakerState } from './exchange-rates-1965-breaker.mjs';
import { autoDisable } from './exchange-rates-1965-runner.mjs';
import { conditionalSetJSON, readEntry } from './exchange-rates-1965-storage.mjs';
import { collectSourceQuotes } from './exchange-rates-1965-source.mjs';
import { nextUtcHalfHour, quoteExpiryMs } from '../../../src/data/exchange-rate-timing.js';

export const BRANCH_GATE_KEY = 'exchange-rates-1965/on-demand-gate';
export const BRANCH_LEASE_MS = 15_000;
export const BRANCH_MIN_GAP_MS = 1_500;
export const BRANCH_FAILURE_DELAY_MS = 60_000;
/** @param {string} slug */
export const branchCacheKey = slug => `exchange-rates-1965/branches/${slug}`;
const PROFILE = Object.freeze({ name: 'on-demand', concurrency: 1, minStartGapMs: 0, requestTimeoutMs: 5_000, deadlineMs: 6_000 });

/** @param {any} gate */
function validGate(gate) {
  return gate && (gate.leaseId === null || typeof gate.leaseId === 'string') &&
    Number.isSafeInteger(gate.leaseUntilMs) && gate.leaseUntilMs >= 0 &&
    Number.isSafeInteger(gate.nextRequestAtMs) && gate.nextRequestAtMs >= 0;
}

/** One JSON envelope for success and failure; no source diagnostics are exposed.
 * @param {string} slug @param {number} nowMs @param {any} [options]
 */
export function branchResponse(slug, nowMs, { status = 200, enabled = null, controlVersion = null, quote = null, reason = null, retryAtMs = null } = {}) {
  const retryAfterSeconds = retryAtMs === null ? 0 : Math.min(7 * 24 * 60 * 60, Math.max(1, Math.ceil((retryAtMs - nowMs) / 1000)));
  return new Response(JSON.stringify({ schemaVersion: BRANCH_API_SCHEMA_VERSION, checkedAt: new Date(nowMs).toISOString(),
    enabled, controlVersion, slug, quote, reason, retryAfterSeconds }), {
    status, headers: { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store',
      ...(retryAfterSeconds ? { 'retry-after': String(retryAfterSeconds) } : {}),
      ...(status === 405 ? { allow: 'POST' } : {}),
    },
  });
}

/** A public click can only fetch one whitelisted branch. A persistent CAS lease
 * serializes cold requests across server instances; warm cache hits bypass it.
 * @param {{store:any, slug:string, enabledDefault?:unknown, fetchImpl?:typeof fetch, nowImpl?:()=>number, randomUUIDImpl?:()=>string, refreshDue?:boolean, expectedControlVersion?:string, sourceProfile?:import('./exchange-rates-1965-source.mjs').SourceProfile}} input
 */
export async function queryBranchRates({ store, slug, enabledDefault = process.env.EXCHANGE_RATES_1965_ENABLED,
  fetchImpl = fetch, nowImpl = Date.now, randomUUIDImpl = randomUUID, refreshDue = false, expectedControlVersion, sourceProfile = PROFILE }) {
  if (!Object.hasOwn(ORANGE_BRANCHES, slug)) return branchResponse(slug, nowImpl(), { status: 400, reason: 'invalid_request' });
  /** @type {any|null} */
  let lease = null;
  let releaseDelay = BRANCH_MIN_GAP_MS;
  /** @type {any} */
  let control = null;
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
    reason, status, retryAtMs, enabled: control?.enabled ?? null, controlVersion: control?.controlVersion ?? null,
  });
  try {
    const effective = await ensureFetchControl(store, { enabledDefault, nowMs: nowImpl(), randomUUIDImpl });
    control = effective.control;
    if (!effective.enabled || !control) return reply('disabled', 503, nowImpl() + BRANCH_FAILURE_DELAY_MS);
    const version = control.controlVersion;
    if (expectedControlVersion && version !== expectedControlVersion) return reply('stale_control', 503);
    const cached = await readEntry(store, branchCacheKey(slug));
    let quote = cached?.data;
    const usable = (/** @type {any} */ candidate) => isValidBranchQuote(candidate) && candidate.slug === slug &&
      candidate.controlVersion === version && Date.parse(candidate.attemptedAt) >= Date.parse(control.enabledAt) &&
      Date.parse(candidate.expiresAt) > nowImpl();
    const reusable = (/** @type {any} */ candidate) => usable(candidate) &&
      (!refreshDue || nowImpl() < nextUtcHalfHour(Date.parse(candidate.attemptedAt)));
    if (!reusable(quote)) {
      // Legacy snapshots can seed a branch, without extending their lifetime.
      const full = (await readEntry(store, EXCHANGE_KEYS.snapshot))?.data;
      const branch = full?.branches?.find((/** @type {any} */ b) => b.slug === slug);
      quote = isValidSnapshot(full) && branch?.status === 'ok' ? {
        schemaVersion: BRANCH_API_SCHEMA_VERSION, slug, controlVersion: full.controlVersion,
        attemptedAt: full.attemptedAt, completedAt: full.completedAt,
        expiresAt: new Date(Math.min(Date.parse(full.expiresAt), quoteExpiryMs(Date.parse(full.attemptedAt)))).toISOString(), branch,
      } : null;
    }
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
    const attemptedAtMs = nowImpl();
    const collection = await collectSourceQuotes({
      mapping: { schemaVersion: 1, branches: { [slug]: ORANGE_BRANCHES[slug] } },
      fetchImpl, nowImpl, functionStartedAtMs: attemptedAtMs, profile: sourceProfile, allowRetry: false,
    });
    diagnostic.sourceOutcome = collection.outcome;
    diagnostic.sourceRequestCount = collection.requestCount;
    diagnostic.blockedStatus = collection.blockedStatus;
    diagnostic.diagnostics = sanitizeDiagnostics(collection.diagnostics);
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
        return reply(collection.outcome === 'blocked' ? 'cooldown' : 'unavailable', collection.outcome === 'blocked' ? 429 : 503,
          Math.max(nowImpl() + releaseDelay, Date.parse(transition.breaker.blockedUntil ?? '') || 0));
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
    const write = await conditionalSetJSON(store, branchCacheKey(slug), quote, cached);
    if (!write.modified) return reply('busy', 202, nowImpl() + 2_000);
    const finalControl = await readEffectiveControl(store, enabledDefault);
    control = finalControl.control;
    if (!finalControl.enabled || control?.controlVersion !== version) return reply(finalControl.enabled ? 'stale_control' : 'disabled', 503);
    // A single successful branch intentionally does not reset the full-round
    // breaker's escalation history, or consecutive challenge blocks could vanish.
    return respond({ enabled: true, controlVersion: version, quote });
  } catch {
    releaseDelay = BRANCH_FAILURE_DELAY_MS;
    return reply('storage_unavailable', 503, nowImpl() + releaseDelay);
  } finally {
    if (lease) {
      try {
        await conditionalSetJSON(store, BRANCH_GATE_KEY, { leaseId: null, leaseUntilMs: 0,
          nextRequestAtMs: nowImpl() + releaseDelay }, lease);
      } catch { /* The original lease expires; never retry a source request. */ }
    }
    try {
      console.info(JSON.stringify({ ...diagnostic, completedAt: new Date(nowImpl()).toISOString() }));
    } catch { /* Logging must not change a quote, lease or breaker result. */ }
  }
}
