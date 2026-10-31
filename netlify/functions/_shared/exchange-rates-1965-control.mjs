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

/** @param {any} store @param {string} controlVersion @param {any|null} previousBreakerEntry @param {string|null} [blockedUntil] */
export async function resetBreakerForControl(store, controlVersion, previousBreakerEntry, blockedUntil = null) {
  const breaker = createBreaker(controlVersion, blockedUntil);
  const result = await conditionalSetJSON(store, EXCHANGE_KEYS.breaker, breaker, previousBreakerEntry);
  return { breaker, modified: result.modified, etag: result.etag };
}

/** @param {any} store @param {any} controlEntry @param {any} control @param {any} breakerEntry @param {number} nowMs @param {()=>string} randomUUIDImpl */
export async function autoDisable(store, controlEntry, control, breakerEntry, nowMs, randomUUIDImpl) {
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

/** Preserve the latest future cooldown across a conflicting breaker write.
 * @param {any|null} entry @param {number} nowMs @param {string|null} [previous]
 */
function laterBlockedUntil(entry, nowMs, previous = null) {
  const candidate = entry?.data?.blockedUntil;
  return typeof candidate === 'string' && Date.parse(candidate) > nowMs &&
    (!previous || Date.parse(candidate) > Date.parse(previous)) ? candidate : previous;
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
  const blockedUntil = laterBlockedUntil(breakerEntry, nowMs);
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
    const retry = await resetBreakerForControl(store, control.controlVersion, retryEntry,
      laterBlockedUntil(retryEntry, nowMs, blockedUntil));
    if (!retry.modified) throw new Error('breaker_write_conflict');
  }
  return control;
}
