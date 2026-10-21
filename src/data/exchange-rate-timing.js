// Shared freshness policy for green snapshots and orange per-branch quotes.
export const HALF_HOUR_MS = 30 * 60_000;
export const SNAPSHOT_GRACE_MS = 35 * 60_000;

/** @param {number} attemptedAtMs */
export function nextUtcHalfHour(attemptedAtMs) {
  if (!Number.isFinite(attemptedAtMs)) throw new Error('attemptedAtMs must be finite.');
  return Math.floor(attemptedAtMs / HALF_HOUR_MS) * HALF_HOUR_MS + HALF_HOUR_MS;
}

/** @param {number} attemptedAtMs */
export function quoteExpiryMs(attemptedAtMs) {
  return nextUtcHalfHour(attemptedAtMs) + SNAPSHOT_GRACE_MS;
}
