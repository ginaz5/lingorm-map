import { randomUUID } from 'node:crypto';

import {
  createBreaker,
  createControl,
  environmentEnabled,
  EXCHANGE_KEYS,
  isValidBreaker,
  isValidControl,
} from './exchange-rates-1965-contract.mjs';
import { conditionalSetJSON, readEntry } from './exchange-rates-1965-storage.mjs';

/** @param {any} store @param {unknown} [enabledDefault] */
export async function readEffectiveControl(store, enabledDefault = process.env.EXCHANGE_RATES_1965_ENABLED) {
  const entry = await readEntry(store, EXCHANGE_KEYS.control);
  if (entry === null) {
    return { entry: null, control: null, enabled: environmentEnabled(enabledDefault) };
  }
  if (!isValidControl(entry.data)) throw new Error('invalid_control');
  return { entry, control: entry.data, enabled: entry.data.enabled };
}

/** Initialize a true default exactly once; false defaults remain storage-free. */
/**
 * @param {any} store
 * @param {{enabledDefault?:unknown, nowMs?:number, randomUUIDImpl?:()=>string}} [input]
 */
export async function ensureFetchControl(store, {
  enabledDefault = process.env.EXCHANGE_RATES_1965_ENABLED,
  nowMs = Date.now(),
  randomUUIDImpl = randomUUID,
} = {}) {
  let current = await readEffectiveControl(store, enabledDefault);
  if (current.control || !current.enabled) return current;
  const control = createControl({ enabled: true, nowMs, controlVersion: randomUUIDImpl(), updatedBy: 'manual' });
  const created = await conditionalSetJSON(store, EXCHANGE_KEYS.control, control, null);
  // Re-read even after a successful first write. The fetch must use the
  // strongly-consistent stored version, never an assumed in-memory version.
  current = await readEffectiveControl(store, enabledDefault);
  if (!current.control) throw new Error('control_initialization_conflict');
  if (created.modified && current.control.controlVersion !== control.controlVersion) {
    throw new Error('control_initialization_conflict');
  }
  return current;
}

/** @param {any} store @param {string} controlVersion @param {any|null} previousBreakerEntry @param {string|null} [blockedUntil] */
export async function resetBreakerForControl(store, controlVersion, previousBreakerEntry, blockedUntil = null) {
  const breaker = createBreaker(controlVersion, blockedUntil);
  const result = await conditionalSetJSON(store, EXCHANGE_KEYS.breaker, breaker, previousBreakerEntry);
  return { breaker, modified: result.modified, etag: result.etag };
}

/**
 * @param {any} store
 * @param {{enabled:boolean, reason?:string, updatedBy?:'manual'|'breaker', nowMs?:number, randomUUIDImpl?:()=>string}} input
 */
export async function changeControl(store, {
  enabled,
  reason = 'manual',
  updatedBy = 'manual',
  nowMs = Date.now(),
  randomUUIDImpl = randomUUID,
}) {
  const current = await readEffectiveControl(store, 'false');
  const previous = current.control;
  const breakerEntry = await readEntry(store, EXCHANGE_KEYS.breaker);
  if (breakerEntry !== null && !isValidBreaker(breakerEntry.data)) throw new Error('invalid_breaker');
  const blockedUntil = breakerEntry?.data?.blockedUntil && Date.parse(breakerEntry.data.blockedUntil) > nowMs
    ? breakerEntry.data.blockedUntil
    : null;
  const control = createControl({
    enabled,
    nowMs,
    controlVersion: randomUUIDImpl(),
    updatedBy,
    previous,
    disabledReason: enabled ? null : reason,
  });
  const write = await conditionalSetJSON(store, EXCHANGE_KEYS.control, control, current.entry);
  if (!write.modified) throw new Error('control_write_conflict');

  const breakerWrite = await resetBreakerForControl(store, control.controlVersion, breakerEntry, blockedUntil);
  if (!breakerWrite.modified) {
    const latest = await readEffectiveControl(store, 'false');
    if (latest.control?.controlVersion !== control.controlVersion) throw new Error('breaker_write_conflict');
    const retryEntry = await readEntry(store, EXCHANGE_KEYS.breaker);
    if (retryEntry !== null && !isValidBreaker(retryEntry.data)) throw new Error('invalid_breaker');
    const retry = await resetBreakerForControl(store, control.controlVersion, retryEntry, blockedUntil);
    if (!retry.modified) throw new Error('breaker_write_conflict');
  }
  return control;
}
