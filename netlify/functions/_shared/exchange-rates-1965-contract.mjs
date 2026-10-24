// Shared control, breaker and bounded diagnostic contracts for SuperRich 1965.

export const EXCHANGE_STORE_NAME = 'exchange-rates-1965';
export const EXCHANGE_KEYS = Object.freeze({
  breaker: 'exchange-rates-1965/breaker',
  control: 'exchange-rates-1965/control',
});
// Inspect immutable deployments' old jobs before adopting their source state.
export const LEGACY_BATCH_JOB_KEY = 'exchange-rates-1965/background-job';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON_PATTERN = /^[a-z0-9_]{1,64}$/;

/** @typedef {'manual'|'breaker'} ControlActor */
/** @typedef {{enabled:boolean, controlVersion:string, enabledAt:string|null, changedAt:string, disabledReason:string|null, disabledAt:string|null, updatedBy:ControlActor}} ExchangeControl */
/** @typedef {{controlVersion:string, consecutiveFailedRuns:number, blockLevel:number, blockedUntil:string|null, lastStatus:string|null, lastError:string|null}} ExchangeBreaker */

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value */
const isIso = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};
/** @param {unknown} value */
const isUuid = value => typeof value === 'string' && UUID_PATTERN.test(value);

/**
 * @param {{enabled:boolean, nowMs:number, controlVersion:string, updatedBy:ControlActor, previous?:ExchangeControl|null, disabledReason?:string|null}} input
 * @returns {ExchangeControl}
 */
export function createControl({ enabled, nowMs, controlVersion, updatedBy, previous = null, disabledReason = null }) {
  if (typeof enabled !== 'boolean' || !Number.isFinite(nowMs) || !isUuid(controlVersion)) {
    throw new Error('Invalid control creation input.');
  }
  if (!['manual', 'breaker'].includes(updatedBy)) throw new Error('Invalid control actor.');
  if (!enabled && (typeof disabledReason !== 'string' || !REASON_PATTERN.test(disabledReason))) {
    throw new Error('Disabled controls require a fixed reason code.');
  }
  const now = new Date(nowMs).toISOString();
  return {
    enabled,
    controlVersion,
    enabledAt: enabled ? now : previous?.enabledAt ?? null,
    changedAt: now,
    disabledReason: enabled ? null : disabledReason,
    disabledAt: enabled ? null : now,
    updatedBy,
  };
}

/** @param {unknown} value @returns {value is ExchangeControl} */
export function isValidControl(value) {
  if (!isObject(value) || typeof value.enabled !== 'boolean' || !isUuid(value.controlVersion)) return false;
  if (!isIso(value.changedAt) || !['manual', 'breaker'].includes(value.updatedBy)) return false;
  if (value.enabled) {
    return isIso(value.enabledAt) && value.disabledReason === null && value.disabledAt === null;
  }
  return (value.enabledAt === null || isIso(value.enabledAt)) &&
    typeof value.disabledReason === 'string' && REASON_PATTERN.test(value.disabledReason) && isIso(value.disabledAt);
}

/** @param {string} controlVersion @param {string|null} [blockedUntil] @returns {ExchangeBreaker} */
export function createBreaker(controlVersion, blockedUntil = null) {
  if (!isUuid(controlVersion) || (blockedUntil !== null && !isIso(blockedUntil))) {
    throw new Error('Invalid breaker creation input.');
  }
  return {
    controlVersion,
    consecutiveFailedRuns: 0,
    blockLevel: 0,
    blockedUntil,
    lastStatus: null,
    lastError: null,
  };
}

/** @param {unknown} value @returns {value is ExchangeBreaker} */
export function isValidBreaker(value) {
  return isObject(value) && isUuid(value.controlVersion) &&
    Number.isSafeInteger(value.consecutiveFailedRuns) && value.consecutiveFailedRuns >= 0 &&
    Number.isSafeInteger(value.blockLevel) && value.blockLevel >= 0 && value.blockLevel <= 3 &&
    (value.blockedUntil === null || isIso(value.blockedUntil)) &&
    (value.lastStatus === null || ['complete', 'partial', 'failed', 'blocked'].includes(value.lastStatus)) &&
    (value.lastError === null || (typeof value.lastError === 'string' && REASON_PATTERN.test(value.lastError)));
}

/** @param {unknown} value */
export function environmentEnabled(value) {
  if (value === undefined || value === null || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('EXCHANGE_RATES_1965_ENABLED must be true or false.');
}

const MAX_SOURCE_DIAGNOSTICS = 8;
const DIAGNOSTIC_STRING_KEYS = ['cfMitigated', 'contentType', 'retryAfter', 'rayId', 'reason'];

/** Keep only known keys, bounded lengths and a bounded entry count. */
/** @param {unknown} value @returns {Array<Record<string, string|number|null>>} */
export function sanitizeDiagnostics(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_SOURCE_DIAGNOSTICS).map(entry => {
    /** @type {Record<string, string|number|null>} */
    const clean = {};
    if (!isObject(entry)) return clean;
    if (Number.isSafeInteger(entry.officialId) && entry.officialId > 0) clean.officialId = entry.officialId;
    if (entry.stage === 'token' || entry.stage === 'rate') clean.stage = entry.stage;
    clean.status = Number.isSafeInteger(entry.status) ? entry.status : null;
    for (const key of DIAGNOSTIC_STRING_KEYS) {
      const raw = entry[key];
      clean[key] = typeof raw === 'string' ? raw.replace(/[^\x20-\x7e]/g, '').slice(0, 100) : null;
    }
    if (entry.stage === 'token') {
      if (Number.isSafeInteger(entry.tokenRemainingSeconds) && Math.abs(entry.tokenRemainingSeconds) <= 86_400) clean.tokenRemainingSeconds = entry.tokenRemainingSeconds;
      if (entry.tokenReissued === 0 || entry.tokenReissued === 1) clean.tokenReissued = entry.tokenReissued;
    }
    return clean;
  });
}
