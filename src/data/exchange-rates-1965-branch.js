// Shared public contract for one reviewed orange branch. Independent of the
// all-38-branches snapshot contract used by the legacy collector.
import MAPPING from '../../data/superrich1965-branches.json' with { type: 'json' };
import { DENOMS_1965 } from './exchange-rates-1965.js';
import { HALF_HOUR_MS, SNAPSHOT_GRACE_MS, quoteExpiryMs } from './exchange-rate-timing.js';

// Maximum lifetime; actual expiry follows the same half-hour boundary as green.
export const BRANCH_QUOTE_TTL_MS = HALF_HOUR_MS + SNAPSHOT_GRACE_MS;
export const BRANCH_API_SCHEMA_VERSION = 1;
export const ORANGE_BRANCHES = /** @type {Record<string,{officialId:number,branchNo:string,companyCode:string}>} */ (MAPPING.branches);
export const BRANCH_QUERY_REASONS = Object.freeze([
  'busy', 'cooldown', 'unavailable', 'disabled', 'stale_control',
  'storage_unavailable', 'invalid_request', 'method_not_allowed', 'invalid_control',
]);

/** @param {unknown} value @returns {value is Record<string,any>} */
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value @returns {value is string} */
const isIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Validate identity against the fixed mapping, never a client-supplied branch number.
 * @param {unknown} value @returns {value is Record<string,any>}
 */
export function isValidBranchQuote(value) {
  if (!isObject(value) || value.schemaVersion !== BRANCH_API_SCHEMA_VERSION ||
      typeof value.slug !== 'string' || !Object.hasOwn(ORANGE_BRANCHES, value.slug) ||
      typeof value.controlVersion !== 'string' || !value.controlVersion ||
      ![value.attemptedAt, value.completedAt, value.expiresAt].every(isIso) || !isObject(value.branch)) return false;
  const expected = ORANGE_BRANCHES[value.slug];
  const branch = value.branch;
  const start = Date.parse(value.attemptedAt), end = Date.parse(value.completedAt), expires = Date.parse(value.expiresAt);
  if (end < start || expires <= end || expires > quoteExpiryMs(start) ||
      branch.slug !== value.slug || branch.officialId !== expected.officialId ||
      branch.branchNo !== expected.branchNo || branch.companyCode !== expected.companyCode ||
      branch.status !== 'ok' || !isObject(branch.rates)) return false;
  return DENOMS_1965.every(denom => {
    const cell = branch.rates[denom];
    return isObject(cell) && cell.denom === denom && Number.isSafeInteger(cell.rateScaledE6) &&
      cell.rateScaledE6 > 0 && Number.isInteger(cell.displayDecimals) &&
      cell.displayDecimals >= 0 && cell.displayDecimals <= 6 && cell.unavailableReason === null;
  });
}

/** Copy only the public fields; upstream headers and extra fields never enter UI state.
 * @param {unknown} value @param {string} slug @returns {any|null}
 */
export function parseBranchQueryPayload(value, slug) {
  if (!isObject(value) || value.schemaVersion !== BRANCH_API_SCHEMA_VERSION || value.slug !== slug ||
      !Object.hasOwn(ORANGE_BRANCHES, slug) || !isIso(value.checkedAt) ||
      ![true, false, null].includes(value.enabled) ||
      !(value.controlVersion === null || typeof value.controlVersion === 'string') ||
      !(value.reason === null || BRANCH_QUERY_REASONS.includes(value.reason)) ||
      !Number.isInteger(value.retryAfterSeconds) || value.retryAfterSeconds < 0 || value.retryAfterSeconds > 7 * 24 * 60 * 60) return null;
  let quote = null;
  if (value.quote !== null) {
    if (value.enabled !== true || value.reason !== null || !isValidBranchQuote(value.quote) ||
        value.quote.slug !== slug || value.quote.controlVersion !== value.controlVersion ||
        Date.parse(value.quote.completedAt) > Date.parse(value.checkedAt) ||
        Date.parse(value.quote.expiresAt) <= Date.parse(value.checkedAt)) return null;
    const source = value.quote;
    quote = {
      schemaVersion: BRANCH_API_SCHEMA_VERSION, slug, controlVersion: source.controlVersion,
      attemptedAt: source.attemptedAt, completedAt: source.completedAt, expiresAt: source.expiresAt,
      branch: { slug, ...ORANGE_BRANCHES[slug], status: 'ok', rates: Object.fromEntries(DENOMS_1965.map(denom => {
        const cell = source.branch.rates[denom];
        return [denom, { denom, rateScaledE6: cell.rateScaledE6, displayDecimals: cell.displayDecimals, unavailableReason: null }];
      })) },
    };
  } else if (value.reason === null) return null;
  return { schemaVersion: BRANCH_API_SCHEMA_VERSION, slug, checkedAt: value.checkedAt,
    enabled: value.enabled, controlVersion: value.controlVersion, quote,
    reason: value.reason, retryAfterSeconds: value.retryAfterSeconds };
}

/** Read-only cache envelopes may contain any subset of reviewed branches.
 * @param {unknown} value @returns {any|null}
 */
export function parseBranchCachePayload(value) {
  if (!isObject(value) || value.schemaVersion !== BRANCH_API_SCHEMA_VERSION || !isIso(value.checkedAt) ||
      typeof value.enabled !== 'boolean' || !(value.controlVersion === null || typeof value.controlVersion === 'string') ||
      !Array.isArray(value.quotes) || value.quotes.length > Object.keys(ORANGE_BRANCHES).length ||
      (!value.enabled && value.quotes.length)) return null;
  const seen = new Set();
  const quotes = [];
  for (const quote of value.quotes) {
    if (!isObject(quote) || seen.has(quote.slug)) return null;
    const parsed = parseBranchQueryPayload({ ...value, slug: quote.slug, quote, reason: null, retryAfterSeconds: 0 }, quote.slug);
    if (!parsed) return null;
    seen.add(quote.slug);
    quotes.push(parsed.quote);
  }
  return { schemaVersion: BRANCH_API_SCHEMA_VERSION, checkedAt: value.checkedAt,
    enabled: value.enabled, controlVersion: value.controlVersion, quotes };
}
