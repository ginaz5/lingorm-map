import { createBreaker, isValidBreaker } from './exchange-rates-contract.mjs';

export const BREAKER_BACKOFF_MS = Object.freeze({ first: 6 * 60 * 60 * 1000, second: 24 * 60 * 60 * 1000, failedRuns: 60 * 60 * 1000 });

/** @param {unknown} value @param {number} nowMs */
export function parseRetryAfter(value, nowMs) {
  if (typeof value !== 'string' || !Number.isFinite(nowMs)) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const target = nowMs + Number(trimmed) * 1000;
    return Number.isFinite(target) && target > nowMs ? target : null;
  }
  const date = Date.parse(trimmed);
  return Number.isFinite(date) && date > nowMs ? date : null;
}

/** @param {unknown} breaker @param {string} controlVersion @param {number} nowMs */
export function breakerBlocks(breaker, controlVersion, nowMs) {
  if (!isValidBreaker(breaker) || breaker.controlVersion !== controlVersion) return false;
  return breaker.blockedUntil !== null && Date.parse(breaker.blockedUntil) > nowMs;
}

/** Pure breaker transition. Full success is passed only after snapshot publication. */
/**
 * @param {unknown} current
 * @param {{controlVersion:string, outcome:'complete'|'partial'|'failed'|'blocked', nowMs:number, retryAfterMs?:number|null}} event
 */
export function nextBreakerState(current, { controlVersion, outcome, nowMs, retryAfterMs = null }) {
  if (!Number.isFinite(nowMs) || !['complete', 'partial', 'failed', 'blocked'].includes(outcome)) {
    throw new Error('Invalid breaker transition.');
  }
  const base = isValidBreaker(current) && current.controlVersion === controlVersion
    ? current
    : createBreaker(controlVersion);

  if (outcome === 'complete') return { breaker: createBreaker(controlVersion), autoDisable: false };
  if (outcome === 'partial') {
    return { breaker: { ...base, consecutiveFailedRuns: 0, lastStatus: 'partial', lastError: 'source_partial' }, autoDisable: false };
  }
  if (outcome === 'failed') {
    const failures = base.consecutiveFailedRuns + 1;
    const trip = failures >= 3;
    return {
      breaker: {
        ...base,
        consecutiveFailedRuns: trip ? 0 : failures,
        blockedUntil: trip ? new Date(nowMs + BREAKER_BACKOFF_MS.failedRuns).toISOString() : base.blockedUntil,
        lastStatus: 'failed',
        lastError: 'source_failed',
      },
      autoDisable: false,
    };
  }

  const level = Math.min(3, base.blockLevel + 1);
  const baseUntil = level === 1 ? nowMs + BREAKER_BACKOFF_MS.first
    : level === 2 ? nowMs + BREAKER_BACKOFF_MS.second
      : nowMs;
  const existingUntil = base.blockedUntil ? Date.parse(base.blockedUntil) : nowMs;
  const retryUntil = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) ? retryAfterMs : nowMs;
  const until = Math.max(baseUntil, existingUntil, retryUntil);
  return {
    breaker: {
      ...base,
      consecutiveFailedRuns: 0,
      blockLevel: level,
      blockedUntil: until > nowMs ? new Date(until).toISOString() : null,
      lastStatus: 'blocked',
      lastError: 'source_blocked',
    },
    autoDisable: level >= 3,
  };
}
