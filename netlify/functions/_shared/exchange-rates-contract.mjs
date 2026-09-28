// Shared, source-string-free contracts for SuperRich snapshots and controls.

import { DENOMS } from '../../../src/data/exchange-rates.js';

export const EXCHANGE_STORE_NAME = 'exchange-rates';
export const EXCHANGE_KEYS = Object.freeze({
  snapshot: 'exchange-rates/snapshot',
  breaker: 'exchange-rates/breaker',
  control: 'exchange-rates/control',
});
export const SNAPSHOT_SCHEMA_VERSION = 1;
export const PUBLIC_SCHEMA_VERSION = 1;
export const HALF_HOUR_MS = 30 * 60 * 1000;
export const SNAPSHOT_GRACE_MS = 90 * 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON_PATTERN = /^[a-z0-9_]{1,64}$/;
const STATUS_VALUES = new Set(['ok', 'partial', 'failed']);
const UNAVAILABLE_VALUES = new Set(['timeout', 'invalid', 'missing', 'http_error', 'expired']);

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

/** Return the next UTC :00 or :30 boundary strictly after `attemptedAtMs`. */
/** @param {number} attemptedAtMs */
export function nextUtcHalfHour(attemptedAtMs) {
  if (!Number.isFinite(attemptedAtMs)) throw new Error('attemptedAtMs must be finite.');
  return Math.floor(attemptedAtMs / HALF_HOUR_MS) * HALF_HOUR_MS + HALF_HOUR_MS;
}

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

/** @param {unknown} cell @param {string} denom */
function isRateCell(cell, denom) {
  if (!isObject(cell) || cell.denom !== denom) return false;
  const hasRate = Number.isSafeInteger(cell.rateScaledE6) && cell.rateScaledE6 > 0;
  if (hasRate) {
    return Number.isSafeInteger(cell.displayDecimals) && cell.displayDecimals >= 0 &&
      cell.displayDecimals <= 6 && cell.unavailableReason === null;
  }
  return cell.rateScaledE6 === null && cell.displayDecimals === null && UNAVAILABLE_VALUES.has(cell.unavailableReason);
}

/** @param {unknown} branch */
function isBranch(branch) {
  if (!isObject(branch) || typeof branch.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branch.slug)) return false;
  if (!Number.isSafeInteger(branch.officialId) || branch.officialId <= 0 || typeof branch.branchCode !== 'string') return false;
  if (!STATUS_VALUES.has(branch.status) || !isObject(branch.rates)) return false;
  if (!DENOMS.every(denom => isRateCell(branch.rates[denom], denom))) return false;
  const available = DENOMS.filter(denom => branch.rates[denom].rateScaledE6 !== null).length;
  return branch.status === (available === DENOMS.length ? 'ok' : available === 0 ? 'failed' : 'partial');
}

/**
 * @param {{runId:string, controlVersion:string, attemptedAtMs:number, completedAtMs:number, sourceBranchIds:number[], branches:any[], unknownBranchCount:number, missingBranchCount:number}} input
 */
export function buildSnapshot({ runId, controlVersion, attemptedAtMs, completedAtMs, sourceBranchIds, branches, unknownBranchCount, missingBranchCount }) {
  if (!isUuid(runId) || !isUuid(controlVersion) || !Number.isFinite(attemptedAtMs) || !Number.isFinite(completedAtMs)) {
    throw new Error('Invalid snapshot identity or time.');
  }
  if (completedAtMs < attemptedAtMs || !Array.isArray(sourceBranchIds) || !Array.isArray(branches)) {
    throw new Error('Invalid snapshot collection.');
  }
  if (!sourceBranchIds.every(id => Number.isSafeInteger(id) && id > 0) || new Set(sourceBranchIds).size !== sourceBranchIds.length) {
    throw new Error('Invalid snapshot source IDs.');
  }
  if (!branches.every(isBranch) || new Set(branches.map(branch => branch.slug)).size !== branches.length) {
    throw new Error('Invalid snapshot branches.');
  }
  if (![unknownBranchCount, missingBranchCount].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('Invalid snapshot inventory counts.');
  }
  const nextUpdateAtMs = nextUtcHalfHour(attemptedAtMs);
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    runId,
    controlVersion,
    attemptedAt: new Date(attemptedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    nextUpdateAt: new Date(nextUpdateAtMs).toISOString(),
    expiresAt: new Date(nextUpdateAtMs + SNAPSHOT_GRACE_MS).toISOString(),
    sourceBranchIds: [...sourceBranchIds].sort((left, right) => left - right),
    sourceBranchCount: sourceBranchIds.length,
    okBranchCount: branches.filter(branch => branch.status === 'ok').length,
    partialBranchCount: branches.filter(branch => branch.status === 'partial').length,
    failedBranchCount: branches.filter(branch => branch.status === 'failed').length,
    unknownBranchCount,
    missingBranchCount,
    branches,
  };
}

/** @param {unknown} value @returns {value is Record<string, any>} */
export function isValidSnapshot(value) {
  if (!isObject(value) || value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || !isUuid(value.runId) || !isUuid(value.controlVersion)) return false;
  if (![value.attemptedAt, value.completedAt, value.nextUpdateAt, value.expiresAt].every(isIso)) return false;
  const attempted = Date.parse(value.attemptedAt);
  const completed = Date.parse(value.completedAt);
  const next = Date.parse(value.nextUpdateAt);
  const expires = Date.parse(value.expiresAt);
  if (completed < attempted || next !== nextUtcHalfHour(attempted) || expires !== next + SNAPSHOT_GRACE_MS) return false;
  if (!Array.isArray(value.sourceBranchIds) || !value.sourceBranchIds.every(id => Number.isSafeInteger(id) && id > 0)) return false;
  if (new Set(value.sourceBranchIds).size !== value.sourceBranchIds.length || value.sourceBranchCount !== value.sourceBranchIds.length) return false;
  if (!value.sourceBranchIds.every((id, index) => index === 0 || value.sourceBranchIds[index - 1] < id)) return false;
  if (!Array.isArray(value.branches) || !value.branches.every(isBranch) || new Set(value.branches.map(branch => branch.slug)).size !== value.branches.length) return false;
  if (new Set(value.branches.map(branch => branch.officialId)).size !== value.branches.length) return false;
  for (const key of ['okBranchCount', 'partialBranchCount', 'failedBranchCount', 'unknownBranchCount', 'missingBranchCount']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) return false;
  }
  return value.okBranchCount === value.branches.filter(branch => branch.status === 'ok').length &&
    value.partialBranchCount === value.branches.filter(branch => branch.status === 'partial').length &&
    value.failedBranchCount === value.branches.filter(branch => branch.status === 'failed').length;
}

/** @param {unknown} value */
export function environmentEnabled(value) {
  if (value === undefined || value === null || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('EXCHANGE_RATES_ENABLED must be true or false.');
}
