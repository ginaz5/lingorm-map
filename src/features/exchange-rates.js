import BRANCH_MAPPING from '../../data/superrich-branches.json' with { type: 'json' };
import BRANCH_MAPPING_1965 from '../../data/superrich1965-branches.json' with { type: 'json' };

import { state } from '../core/state.js';
import { DENOMS } from '../data/exchange-rates.js';
import { DENOMS_1965 } from '../data/exchange-rates-1965.js';
import { setExchange1965LocationsVisible } from './exchange-rates-1965.js';

export const EXCHANGE_CATEGORY = 'Currency Exchange';
export const EXCHANGE_TOGGLE_STORAGE_KEY = 'showExchangeLocations';
export const EXCHANGE_API = '/api/exchange-rates';
export const EXCHANGE_API_TIMEOUT_MS = 8_000;
export const EXCHANGE_POLL_MS = 60_000;
export const EXCHANGE_RETRY_DELAYS_MS = Object.freeze([10_000, 20_000, 40_000, 60_000]);
export const EXCHANGE_SORT_VALUES = Object.freeze(['default', ...DENOMS, ...DENOMS_1965]);

const BRANCHES = /** @type {Record<string, {officialId:number, branchCode:string}>} */ (BRANCH_MAPPING.branches);
const BRANCH_SLUGS = new Set(Object.keys(BRANCHES));
const BRANCH_SLUGS_1965 = new Set(Object.keys(BRANCH_MAPPING_1965.branches));
const UNAVAILABLE_REASONS = new Set(['timeout', 'invalid', 'missing', 'http_error', 'expired']);

/** @typedef {'default'|'USD_100'|'USD_50'|'TWD'|'USD_1965'|'TWD_1965'} ExchangeSort */
/** @typedef {'green'|'orange'} ExchangeBrand */
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
export function parseExchangeRatesPayload(value) {
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
      !Array.isArray(snapshot.branches) || snapshot.branches.length !== BRANCH_SLUGS.size) return null;

  /** @type {Record<string, any>} */
  const bySlug = {};
  for (const branch of snapshot.branches) {
    if (!isObject(branch) || typeof branch.slug !== 'string' || !BRANCH_SLUGS.has(branch.slug) || bySlug[branch.slug]) return null;
    const expected = BRANCHES[branch.slug];
    if (branch.officialId !== expected.officialId || branch.branchCode !== expected.branchCode || !isObject(branch.rates)) return null;
    /** @type {Record<string, any>} */
    const rates = {};
    for (const denom of DENOMS) {
      const cell = normalizeRateCell(branch.rates[denom], denom);
      if (!cell) return null;
      rates[denom] = cell;
    }
    bySlug[branch.slug] = { slug: branch.slug, officialId: expected.officialId, branchCode: expected.branchCode, rates };
  }
  if (Object.keys(bySlug).length !== BRANCH_SLUGS.size) return null;
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
export function nextExchangeAction(now, schedule) {
  const expiresAt = schedule.hasUsableSnapshot ? schedule.expiresAtMs : null;
  if (expiresAt !== null && expiresAt <= now) return { action: 'expire', delayMs: 0 };
  // Pausing requests must never pause expiration, including while a slow
  // request is in flight or the browser is offline/backgrounded.
  if (!schedule.toggleOn || !schedule.visible || !schedule.online || schedule.requestInFlight) {
    return expiresAt === null
      ? { action: 'idle', delayMs: null }
      : { action: 'expire', delayMs: expiresAt - now };
  }

  const retryIndex = Math.min(Math.max(schedule.retryLevel - 1, 0), EXCHANGE_RETRY_DELAYS_MS.length - 1);
  const retryDelay = schedule.retryLevel > 0 ? EXCHANGE_RETRY_DELAYS_MS[retryIndex] : EXCHANGE_POLL_MS;
  let fetchAt = schedule.lastAttemptAtMs === null ? now : schedule.lastAttemptAtMs + retryDelay;
  if (schedule.updateCheckPending && schedule.retryLevel === 0 && schedule.nextUpdateAtMs !== null) {
    fetchAt = Math.min(fetchAt, schedule.nextUpdateAtMs);
  }

  if (expiresAt !== null && expiresAt <= fetchAt) {
    return { action: 'expire', delayMs: expiresAt - now };
  }
  return { action: 'fetch', delayMs: Math.max(0, fetchAt - now) };
}

/** @param {string|{id?:string}} value @returns {ExchangeBrand|null} */
export function getExchangeBrand(value) {
  const slug = typeof value === 'string' ? value : value?.id;
  if (typeof slug !== 'string') return null;
  if (BRANCH_SLUGS.has(slug)) return /** @type {ExchangeBrand} */ ('green');
  if (BRANCH_SLUGS_1965.has(slug)) return /** @type {ExchangeBrand} */ ('orange');
  return null;
}

/** @param {string|{id?:string}} value */
export function isExchangeLocation(value) {
  return getExchangeBrand(value) !== null;
}

/** @param {string} slug @param {'USD_100'|'USD_50'|'TWD'} denom */
export function getExchangeRateCell(slug, denom) {
  return state.exchangeRatesBySlug[slug]?.rates?.[denom] ?? null;
}

/** @param {ExchangeSort|string} value @returns {value is ExchangeSort} */
export function isExchangeSort(value) {
  return EXCHANGE_SORT_VALUES.includes(/** @type {ExchangeSort} */ (value));
}

/** @returns {ExchangeScheduleState} */
function currentScheduleState() {
  return {
    enabled: state.exchangeRatesEnabled,
    controlVersion: state.exchangeControlVersion,
    runId: state.exchangeRunId,
    nextUpdateAtMs: state.exchangeNextUpdateAtMs,
    expiresAtMs: state.exchangeExpiresAtMs,
    retryLevel: state.exchangeRetryLevel,
    lastAttemptAtMs: state.exchangeLastAttemptAtMs,
    visible: document.visibilityState !== 'hidden',
    online: navigator.onLine !== false,
    toggleOn: state.exchangeLocationsOn,
    hasUsableSnapshot: state.exchangeHasUsableSnapshot,
    updateCheckPending: state.exchangeUpdateCheckPending,
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

function notify(change = {}) {
  syncExchangeControls();
  changeListener?.(change);
}

export function expireExchangeRates() {
  state.exchangeRatesBySlug = {};
  state.exchangeCompletedAt = null;
  state.exchangeExpiresAtMs = null;
  state.exchangeHasUsableSnapshot = false;
  state.exchangeRatesLoading = false;
  notify();
}

/** @param {number} nowMs */
export function recordExchangeFailure(nowMs) {
  state.exchangeRatesLoading = false;
  state.exchangeRetryLevel = Math.min(state.exchangeRetryLevel + 1, EXCHANGE_RETRY_DELAYS_MS.length);
  state.exchangeLastAttemptAtMs = nowMs;
}

/**
 * @param {any} payload normalized by parseExchangeRatesPayload
 * @param {{requestStartedAtMs:number, responseReceivedAtMs:number, waitingForNewRun:boolean}} timing
 */
export function applyExchangeRatesPayload(payload, timing) {
  const previousControlVersion = state.exchangeControlVersion;
  state.exchangeRatesLoading = false;
  state.exchangeRatesEnabled = payload.enabled;
  state.exchangeControlVersion = payload.controlVersion;

  if (!payload.enabled) {
    state.exchangeRunId = null;
    state.exchangeRatesBySlug = {};
    state.exchangeCompletedAt = null;
    state.exchangeNextUpdateAtMs = null;
    state.exchangeExpiresAtMs = null;
    state.exchangeHasUsableSnapshot = false;
    state.exchangeUpdateCheckPending = false;
    state.exchangeRetryLevel = 0;
    state.exchangeLastAttemptAtMs = timing.requestStartedAtMs;
    if (DENOMS.includes(/** @type {any} */ (state.exchangeSort))) state.exchangeSort = 'default';
    return;
  }

  if (!payload.snapshot) {
    state.exchangeRunId = null;
    state.exchangeRatesBySlug = {};
    state.exchangeCompletedAt = null;
    state.exchangeNextUpdateAtMs = null;
    state.exchangeExpiresAtMs = null;
    state.exchangeHasUsableSnapshot = false;
    state.exchangeUpdateCheckPending = false;
    recordExchangeFailure(timing.responseReceivedAtMs);
    return;
  }

  const snapshot = payload.snapshot;
  const isNewRun = state.exchangeRunId !== snapshot.runId || previousControlVersion !== snapshot.controlVersion;
  if (isNewRun) {
    const checkedAtMs = Date.parse(payload.checkedAt);
    const nextDelta = Math.max(0, Date.parse(snapshot.nextUpdateAt) - checkedAtMs);
    const expiryDelta = Math.max(0, Date.parse(snapshot.expiresAt) - checkedAtMs);
    state.exchangeRunId = snapshot.runId;
    state.exchangeControlVersion = snapshot.controlVersion;
    state.exchangeRatesBySlug = snapshot.bySlug;
    state.exchangeCompletedAt = snapshot.completedAt;
    state.exchangeNextUpdateAtMs = timing.requestStartedAtMs + nextDelta + deterministicJitter(snapshot.runId);
    state.exchangeExpiresAtMs = timing.requestStartedAtMs + expiryDelta;
    state.exchangeHasUsableSnapshot = timing.responseReceivedAtMs < state.exchangeExpiresAtMs;
    state.exchangeUpdateCheckPending = true;
    state.exchangeRetryLevel = 0;
    state.exchangeLastAttemptAtMs = timing.requestStartedAtMs;
    if (!state.exchangeHasUsableSnapshot) {
      state.exchangeRatesBySlug = {};
      state.exchangeCompletedAt = null;
      state.exchangeExpiresAtMs = null;
    }
    return;
  }

  if (timing.waitingForNewRun) recordExchangeFailure(timing.responseReceivedAtMs);
  else {
    state.exchangeRetryLevel = 0;
    state.exchangeLastAttemptAtMs = timing.requestStartedAtMs;
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
  state.exchangeRatesLoading = false;
}

async function fetchExchangeRates() {
  cancelTimer();
  const requestStartedAtMs = Date.now();
  const waitingForNewRun = state.exchangeUpdateCheckPending &&
    state.exchangeNextUpdateAtMs !== null && requestStartedAtMs >= state.exchangeNextUpdateAtMs;
  const firstAttempt = state.exchangeLastAttemptAtMs === null;
  state.exchangeLastAttemptAtMs = requestStartedAtMs;
  state.exchangeRatesLoading = firstAttempt && state.exchangeRunId === null && state.exchangeRatesEnabled === null;
  const sequence = ++requestSequence;
  const controller = new AbortController();
  requestController = controller;
  notify();
  scheduleExchangeAction();
  const timeout = setTimeout(() => controller.abort(), EXCHANGE_API_TIMEOUT_MS);
  try {
    const response = await fetch(EXCHANGE_API, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('exchange_api_error');
    const payload = parseExchangeRatesPayload(await response.json());
    if (!payload) throw new Error('exchange_api_invalid');
    if (sequence !== requestSequence) return;
    applyExchangeRatesPayload(payload, {
      requestStartedAtMs,
      responseReceivedAtMs: Date.now(),
      waitingForNewRun,
    });
    notify();
  } catch {
    if (sequence !== requestSequence) return;
    recordExchangeFailure(Date.now());
    notify();
  } finally {
    clearTimeout(timeout);
    if (sequence === requestSequence) requestController = null;
    scheduleExchangeAction();
  }
}

export function scheduleExchangeAction() {
  cancelTimer();
  let decision = nextExchangeAction(Date.now(), currentScheduleState());
  // A suspended tab can resume after both deadlines. Remove old numbers
  // synchronously before scheduling a request or allowing another repaint.
  if (decision.action === 'expire' && decision.delayMs === 0) {
    expireExchangeRates();
    decision = nextExchangeAction(Date.now(), currentScheduleState());
  }
  if (decision.action === 'idle' || decision.delayMs === null) return;
  timer = setTimeout(() => {
    const latest = nextExchangeAction(Date.now(), currentScheduleState());
    if (latest.delayMs !== null && latest.delayMs > 0) {
      scheduleExchangeAction();
      return;
    }
    if (latest.action === 'expire') {
      expireExchangeRates();
      scheduleExchangeAction();
    } else if (latest.action === 'fetch') {
      void fetchExchangeRates();
    }
  }, decision.delayMs);
}

export function syncExchangeControls() {
  const selectedBrand = DENOMS.includes(/** @type {any} */ (state.exchangeSort))
    ? 'green'
    : DENOMS_1965.includes(/** @type {any} */ (state.exchangeSort)) ? 'orange' : null;
  if ((selectedBrand === 'green' && !state.exchangeHasUsableSnapshot) ||
      (selectedBrand === 'orange' && !state.exchange1965.hasUsableSnapshot)) {
    state.exchangeSort = 'default';
  }
  const toggle = /** @type {HTMLInputElement|null} */ (document.getElementById('exchange-toggle'));
  const sort = /** @type {HTMLSelectElement|null} */ (document.getElementById('exchange-sort'));
  if (toggle) toggle.checked = state.exchangeLocationsOn;
  if (!sort) return;
  const hasAnyUsableSnapshot = state.exchangeHasUsableSnapshot || state.exchange1965.hasUsableSnapshot;
  sort.hidden = !state.exchangeLocationsOn || !hasAnyUsableSnapshot;
  sort.value = state.exchangeSort;
  for (const option of sort.options) {
    if (DENOMS.includes(/** @type {any} */ (option.value))) {
      option.disabled = state.exchangeRatesEnabled !== true || !state.exchangeHasUsableSnapshot;
    } else if (DENOMS_1965.includes(/** @type {any} */ (option.value))) {
      option.disabled = state.exchange1965.enabled !== true || !state.exchange1965.hasUsableSnapshot;
    }
  }
}

/** @param {boolean} visible */
export function setExchangeLocationsVisible(visible) {
  state.exchangeLocationsOn = visible;
  localStorage.setItem(EXCHANGE_TOGGLE_STORAGE_KEY, String(visible));
  setExchange1965LocationsVisible(visible);
  if (!visible) {
    cancelTimer();
    cancelRequest();
    state.exchangeSort = 'default';
    notify({ exchangeHidden: true, locationsChanged: true });
    scheduleExchangeAction();
    return;
  }
  notify({ locationsChanged: true });
  scheduleExchangeAction();
}

/** @param {(change:{exchangeHidden?:boolean,locationsChanged?:boolean})=>void} onChange */
export function initExchangeRates(onChange) {
  changeListener = onChange;
  state.exchangeLocationsOn = localStorage.getItem(EXCHANGE_TOGGLE_STORAGE_KEY) === 'true';
  const toggle = /** @type {HTMLInputElement|null} */ (document.getElementById('exchange-toggle'));
  const sort = /** @type {HTMLSelectElement|null} */ (document.getElementById('exchange-sort'));
  toggle?.addEventListener('change', () => setExchangeLocationsVisible(toggle.checked));
  sort?.addEventListener('change', () => {
    state.exchangeSort = isExchangeSort(sort.value) ? sort.value : 'default';
    notify();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cancelRequest();
    scheduleExchangeAction();
  });
  window.addEventListener('offline', () => {
    cancelRequest();
    scheduleExchangeAction();
  });
  window.addEventListener('online', scheduleExchangeAction);
  syncExchangeControls();
  scheduleExchangeAction();
}
