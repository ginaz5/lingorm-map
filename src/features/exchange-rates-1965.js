// SuperRich 1965 browser state and polling. This remains separate from the
// green service so either brand can be disabled, retried or expired without
// changing the other brand's quotes.
import BRANCH_MAPPING from '../../data/superrich1965-branches.json' with { type: 'json' };

import { state } from '../core/state.js';
import { DENOMS_1965 } from '../data/exchange-rates-1965.js';

export const EXCHANGE_API_1965 = '/api/exchange-rates-1965';
export const EXCHANGE_API_TIMEOUT_MS_1965 = 8_000;
export const EXCHANGE_POLL_MS_1965 = 60_000;
export const EXCHANGE_RETRY_DELAYS_MS_1965 = Object.freeze([10_000, 20_000, 40_000, 60_000]);

const BRANCHES = /** @type {Record<string, {officialId:number, branchNo:string, companyCode:string}>} */ (BRANCH_MAPPING.branches);
export const BRANCH_SLUGS_1965 = new Set(Object.keys(BRANCHES));
const UNAVAILABLE_REASONS = new Set(['timeout', 'invalid', 'missing', 'http_error', 'expired']);

/** @typedef {'fetch'|'expire'|'idle'} ExchangeAction */
/**
 * @typedef {Object} ExchangeScheduleState
 * @property {boolean|null} enabled
 * @property {string|null} controlVersion
 * @property {string|null} runId
 * @property {number|null} nextUpdateAtMs
 * @property {number|null} expiresAtMs
 * @property {number} retryLevel
 * @property {number|null} lastAttemptAtMs
 * @property {boolean} visible
 * @property {boolean} online
 * @property {boolean} toggleOn
 * @property {boolean} hasUsableSnapshot
 * @property {boolean} updateCheckPending
 * @property {boolean} [requestInFlight]
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value */
function isIso(value) {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** @param {unknown} cell @param {string} denom */
function normalizeRateCell(cell, denom) {
  if (!isObject(cell) || cell.denom !== denom) return null;
  if (Number.isSafeInteger(cell.rateScaledE6) && cell.rateScaledE6 > 0 &&
      Number.isSafeInteger(cell.displayDecimals) && cell.displayDecimals >= 0 && cell.displayDecimals <= 6 &&
      cell.unavailableReason === null) {
    return {
      denom,
      rateScaledE6: cell.rateScaledE6,
      displayDecimals: cell.displayDecimals,
      unavailableReason: null,
    };
  }
  if (cell.rateScaledE6 === null && cell.displayDecimals === null && UNAVAILABLE_REASONS.has(cell.unavailableReason)) {
    return { denom, rateScaledE6: null, displayDecimals: null, unavailableReason: cell.unavailableReason };
  }
  return null;
}

/**
 * Validate and copy the public API response so untrusted extra fields never
 * enter UI state.
 * @param {unknown} value
 * @returns {any|null}
 */
export function parseExchangeRates1965Payload(value) {
  if (!isObject(value) || value.schemaVersion !== 1 || !isIso(value.checkedAt) || typeof value.enabled !== 'boolean') return null;
  if (value.controlVersion !== null && typeof value.controlVersion !== 'string') return null;
  if (value.snapshot === null) {
    return {
      schemaVersion: 1,
      checkedAt: value.checkedAt,
      enabled: value.enabled,
      controlVersion: value.controlVersion,
      snapshot: null,
    };
  }
  const snapshot = value.snapshot;
  if (!value.enabled || !isObject(snapshot) || typeof snapshot.runId !== 'string' ||
      typeof snapshot.controlVersion !== 'string' || snapshot.controlVersion !== value.controlVersion ||
      !isIso(snapshot.completedAt) || !isIso(snapshot.nextUpdateAt) || !isIso(snapshot.expiresAt) ||
      !Array.isArray(snapshot.branches) || snapshot.branches.length !== BRANCH_SLUGS_1965.size) return null;

  /** @type {Record<string, any>} */
  const bySlug = {};
  for (const branch of snapshot.branches) {
    if (!isObject(branch) || typeof branch.slug !== 'string' || !BRANCH_SLUGS_1965.has(branch.slug) || bySlug[branch.slug]) return null;
    const expected = BRANCHES[branch.slug];
    if (branch.officialId !== expected.officialId || branch.branchNo !== expected.branchNo ||
        branch.companyCode !== expected.companyCode || !isObject(branch.rates)) return null;
    /** @type {Record<string, any>} */
    const rates = {};
    for (const denom of DENOMS_1965) {
      const cell = normalizeRateCell(branch.rates[denom], denom);
      if (!cell) return null;
      rates[denom] = cell;
    }
    bySlug[branch.slug] = {
      slug: branch.slug,
      officialId: expected.officialId,
      branchNo: expected.branchNo,
      companyCode: expected.companyCode,
      rates,
    };
  }
  if (Object.keys(bySlug).length !== BRANCH_SLUGS_1965.size) return null;
  const checkedAtMs = Date.parse(value.checkedAt);
  const completedAtMs = Date.parse(snapshot.completedAt);
  const nextUpdateAtMs = Date.parse(snapshot.nextUpdateAt);
  const expiresAtMs = Date.parse(snapshot.expiresAt);
  if (!(completedAtMs <= checkedAtMs && checkedAtMs < expiresAtMs && nextUpdateAtMs < expiresAtMs)) return null;
  return {
    schemaVersion: 1,
    checkedAt: value.checkedAt,
    enabled: true,
    controlVersion: value.controlVersion,
    snapshot: {
      runId: snapshot.runId,
      controlVersion: snapshot.controlVersion,
      completedAt: snapshot.completedAt,
      nextUpdateAt: snapshot.nextUpdateAt,
      expiresAt: snapshot.expiresAt,
      bySlug,
    },
  };
}

/** @param {string} text */
function deterministicJitter(text) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 30_001;
}

/**
 * Decide the next single timer action. `nextUpdateAtMs` and `expiresAtMs` are
 * local deadlines derived from server time, so device clock skew cannot make
 * a quote live longer.
 * @param {number} now
 * @param {ExchangeScheduleState} schedule
 * @returns {{action:ExchangeAction, delayMs:number|null}}
 */
export function nextExchangeAction1965(now, schedule) {
  const expiresAt = schedule.hasUsableSnapshot ? schedule.expiresAtMs : null;
  if (expiresAt !== null && expiresAt <= now) return { action: 'expire', delayMs: 0 };
  // Pausing requests must never pause expiration, including while a slow
  // request is in flight or the browser is offline/backgrounded.
  if (!schedule.toggleOn || !schedule.visible || !schedule.online || schedule.requestInFlight) {
    return expiresAt === null
      ? { action: 'idle', delayMs: null }
      : { action: 'expire', delayMs: expiresAt - now };
  }

  const retryIndex = Math.min(Math.max(schedule.retryLevel - 1, 0), EXCHANGE_RETRY_DELAYS_MS_1965.length - 1);
  const retryDelay = schedule.retryLevel > 0 ? EXCHANGE_RETRY_DELAYS_MS_1965[retryIndex] : EXCHANGE_POLL_MS_1965;
  let fetchAt = schedule.lastAttemptAtMs === null ? now : schedule.lastAttemptAtMs + retryDelay;
  if (schedule.updateCheckPending && schedule.retryLevel === 0 && schedule.nextUpdateAtMs !== null) {
    fetchAt = Math.min(fetchAt, schedule.nextUpdateAtMs);
  }

  if (expiresAt !== null && expiresAt <= fetchAt) {
    return { action: 'expire', delayMs: expiresAt - now };
  }
  return { action: 'fetch', delayMs: Math.max(0, fetchAt - now) };
}

/** @param {string|{id?:string}} value */
export function isExchange1965Location(value) {
  const slug = typeof value === 'string' ? value : value?.id;
  return typeof slug === 'string' && BRANCH_SLUGS_1965.has(slug);
}

/** @param {string} slug @param {'USD_1965'|'TWD_1965'} denom */
export function getExchangeRateCell1965(slug, denom) {
  return state.exchange1965.ratesBySlug[slug]?.rates?.[denom] ?? null;
}

/** @returns {ExchangeScheduleState} */
function currentScheduleState() {
  return {
    enabled: state.exchange1965.enabled,
    controlVersion: state.exchange1965.controlVersion,
    runId: state.exchange1965.runId,
    nextUpdateAtMs: state.exchange1965.nextUpdateAtMs,
    expiresAtMs: state.exchange1965.expiresAtMs,
    retryLevel: state.exchange1965.retryLevel,
    lastAttemptAtMs: state.exchange1965.lastAttemptAtMs,
    visible: document.visibilityState !== 'hidden',
    online: navigator.onLine !== false,
    toggleOn: state.exchangeLocationsOn,
    hasUsableSnapshot: state.exchange1965.hasUsableSnapshot,
    updateCheckPending: state.exchange1965.updateCheckPending,
    requestInFlight: requestController !== null,
  };
}

/** @type {ReturnType<typeof setTimeout>|null} */
let timer = null;
/** @type {AbortController|null} */
let requestController = null;
let requestSequence = 0;
/** @type {((change:{exchangeHidden?:boolean,locationsChanged?:boolean})=>void)|null} */
let changeListener = null;
/** @type {(()=>void)|null} */
let controlsListener = null;

function notify(change = {}) {
  controlsListener?.();
  changeListener?.(change);
}

export function expireExchangeRates1965() {
  state.exchange1965 = {
    ...state.exchange1965,
    ratesBySlug: {},
    completedAt: null,
    expiresAtMs: null,
    ratesLoading: false,
    hasUsableSnapshot: false,
  };
  notify();
}

/** @param {number} nowMs */
export function recordExchangeFailure1965(nowMs) {
  state.exchange1965.ratesLoading = false;
  state.exchange1965.retryLevel = Math.min(state.exchange1965.retryLevel + 1, EXCHANGE_RETRY_DELAYS_MS_1965.length);
  state.exchange1965.lastAttemptAtMs = nowMs;
}

/**
 * @param {any} payload normalized by parseExchangeRates1965Payload
 * @param {{requestStartedAtMs:number, responseReceivedAtMs:number, waitingForNewRun:boolean}} timing
 */
export function applyExchangeRates1965Payload(payload, timing) {
  const previousControlVersion = state.exchange1965.controlVersion;
  state.exchange1965.ratesLoading = false;
  state.exchange1965.enabled = payload.enabled;
  state.exchange1965.controlVersion = payload.controlVersion;

  if (!payload.enabled) {
    state.exchange1965 = {
      ratesBySlug: {}, runId: null, controlVersion: payload.controlVersion,
      enabled: false, completedAt: null, nextUpdateAtMs: null, expiresAtMs: null,
      retryLevel: 0, lastAttemptAtMs: timing.requestStartedAtMs,
      updateCheckPending: false, ratesLoading: false, hasUsableSnapshot: false,
    };
    if (state.exchangeSort === 'USD_1965' || state.exchangeSort === 'TWD_1965') {
      state.exchangeSort = 'default';
    }
    return;
  }

  if (!payload.snapshot) {
    state.exchange1965 = {
      ...state.exchange1965,
      ratesBySlug: {}, runId: null, completedAt: null,
      nextUpdateAtMs: null, expiresAtMs: null,
      updateCheckPending: false, hasUsableSnapshot: false,
    };
    recordExchangeFailure1965(timing.responseReceivedAtMs);
    return;
  }

  const snapshot = payload.snapshot;
  const isNewRun = state.exchange1965.runId !== snapshot.runId || previousControlVersion !== snapshot.controlVersion;
  if (isNewRun) {
    const checkedAtMs = Date.parse(payload.checkedAt);
    const nextDelta = Math.max(0, Date.parse(snapshot.nextUpdateAt) - checkedAtMs);
    const expiryDelta = Math.max(0, Date.parse(snapshot.expiresAt) - checkedAtMs);
    state.exchange1965.runId = snapshot.runId;
    state.exchange1965.controlVersion = snapshot.controlVersion;
    state.exchange1965.ratesBySlug = snapshot.bySlug;
    state.exchange1965.completedAt = snapshot.completedAt;
    state.exchange1965.nextUpdateAtMs = timing.requestStartedAtMs + nextDelta + deterministicJitter(snapshot.runId);
    state.exchange1965.expiresAtMs = timing.requestStartedAtMs + expiryDelta;
    state.exchange1965.hasUsableSnapshot = timing.responseReceivedAtMs < state.exchange1965.expiresAtMs;
    state.exchange1965.updateCheckPending = true;
    state.exchange1965.retryLevel = 0;
    state.exchange1965.lastAttemptAtMs = timing.requestStartedAtMs;
    if (!state.exchange1965.hasUsableSnapshot) {
      state.exchange1965 = {
        ...state.exchange1965,
        ratesBySlug: {}, completedAt: null, expiresAtMs: null,
      };
    }
    return;
  }

  if (timing.waitingForNewRun) recordExchangeFailure1965(timing.responseReceivedAtMs);
  else {
    state.exchange1965.retryLevel = 0;
    state.exchange1965.lastAttemptAtMs = timing.requestStartedAtMs;
  }
}

function cancelTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function cancelRequest() {
  requestSequence++;
  requestController?.abort();
  requestController = null;
  state.exchange1965.ratesLoading = false;
}

async function fetchExchangeRates1965() {
  cancelTimer();
  const requestStartedAtMs = Date.now();
  const waitingForNewRun = state.exchange1965.updateCheckPending &&
    state.exchange1965.nextUpdateAtMs !== null && requestStartedAtMs >= state.exchange1965.nextUpdateAtMs;
  const firstAttempt = state.exchange1965.lastAttemptAtMs === null;
  state.exchange1965.lastAttemptAtMs = requestStartedAtMs;
  state.exchange1965.ratesLoading = firstAttempt && state.exchange1965.runId === null && state.exchange1965.enabled === null;
  const sequence = ++requestSequence;
  const controller = new AbortController();
  requestController = controller;
  notify();
  scheduleExchangeAction1965();
  const timeout = setTimeout(() => controller.abort(), EXCHANGE_API_TIMEOUT_MS_1965);
  try {
    const response = await fetch(EXCHANGE_API_1965, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('exchange_api_error');
    const payload = parseExchangeRates1965Payload(await response.json());
    if (!payload) throw new Error('exchange_api_invalid');
    if (sequence !== requestSequence) return;
    applyExchangeRates1965Payload(payload, {
      requestStartedAtMs,
      responseReceivedAtMs: Date.now(),
      waitingForNewRun,
    });
    notify();
  } catch {
    if (sequence !== requestSequence) return;
    recordExchangeFailure1965(Date.now());
    notify();
  } finally {
    clearTimeout(timeout);
    if (sequence === requestSequence) requestController = null;
    scheduleExchangeAction1965();
  }
}

export function scheduleExchangeAction1965() {
  cancelTimer();
  let decision = nextExchangeAction1965(Date.now(), currentScheduleState());
  // A suspended tab can resume after both deadlines. Remove old numbers
  // synchronously before scheduling a request or allowing another repaint.
  if (decision.action === 'expire' && decision.delayMs === 0) {
    expireExchangeRates1965();
    decision = nextExchangeAction1965(Date.now(), currentScheduleState());
  }
  if (decision.action === 'idle' || decision.delayMs === null) return;
  timer = setTimeout(() => {
    const latest = nextExchangeAction1965(Date.now(), currentScheduleState());
    if (latest.delayMs !== null && latest.delayMs > 0) {
      scheduleExchangeAction1965();
      return;
    }
    if (latest.action === 'expire') {
      expireExchangeRates1965();
      scheduleExchangeAction1965();
    } else if (latest.action === 'fetch') {
      void fetchExchangeRates1965();
    }
  }, decision.delayMs);
}

/** Called by the shared exchange toggle owner. @param {boolean} visible */
export function setExchange1965LocationsVisible(visible) {
  if (!visible) {
    cancelTimer();
    cancelRequest();
    scheduleExchangeAction1965();
    return;
  }
  scheduleExchangeAction1965();
}

/**
 * Initialize the orange service. The green module owns the one shared toggle
 * and select; this module owns only its timer, request and nested state.
 * @param {(change:{exchangeHidden?:boolean,locationsChanged?:boolean})=>void} onChange
 * @param {()=>void} onControlsChange
 */
export function initExchangeRates1965(onChange, onControlsChange) {
  changeListener = onChange;
  controlsListener = onControlsChange;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cancelRequest();
    scheduleExchangeAction1965();
  });
  window.addEventListener('offline', () => {
    cancelRequest();
    scheduleExchangeAction1965();
  });
  window.addEventListener('online', scheduleExchangeAction1965);
  scheduleExchangeAction1965();
}
