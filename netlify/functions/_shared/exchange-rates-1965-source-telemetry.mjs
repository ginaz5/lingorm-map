/** Private per-request diagnostics. Never placed in headers, bodies or logs by
 * a transport; collectors select the bounded fields they need for diagnostics.
 * @typedef {Record<string, string|number|null>} SourceRequestDiagnostic
 */
/** @type {WeakMap<object, SourceRequestDiagnostic[]>} */
const observations = new WeakMap();

// Fixed classifications only; never include the callback body or token claims.
export const TOKEN_FAILURE_REASONS = Object.freeze([
  'invalid_token_json', 'invalid_token_value', 'expired_token', 'near_expiry_token',
]);

/** @template {object} T @param {T} target @param {SourceRequestDiagnostic[]} diagnostics @returns {T} */
export function recordSourceRequests(target, diagnostics) {
  observations.set(target, diagnostics);
  return target;
}

/** Undefined means an ordinary one-request fetch; an empty array means no
 * upstream request was made (for example a closed transport session).
 * @param {unknown} target @returns {SourceRequestDiagnostic[]|undefined}
 */
export function readSourceRequests(target) {
  return target !== null && (typeof target === 'object' || typeof target === 'function')
    ? observations.get(target) : undefined;
}
