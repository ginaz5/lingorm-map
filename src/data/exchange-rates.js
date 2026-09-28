// ═══════════════════════════════════════════════════
// SUPERRICH EXCHANGE — SOURCE CONTRACT (Phase A)
// Pure data parsing for the SuperRich Thailand public endpoints.
// No network, no DOM, no storage: this module is imported by both the
// scheduled Netlify Function and the browser bundle.
//
// Contract reference: docs/superrich-exchange-map-plan.zh-TW.md §2.2, §4.3.
// Quotes contain numbers, fixed enums and validated branch codes. Branch
// details additionally contain validated Google Maps URLs. Raw display strings never escape, because
// src/ui/render.js builds markup with innerHTML and performs no escaping.
// ═══════════════════════════════════════════════════

/** @typedef {'USD_100'|'USD_50'|'TWD'} Denom */
/** @typedef {'timeout'|'invalid'|'missing'|'http_error'|'expired'} UnavailableReason */
/** @typedef {'ok'|'partial'|'failed'} BranchQuoteStatus */
/**
 * @typedef {Object} RateCell
 * @property {Denom} denom
 * @property {number|null} rateScaledE6
 * @property {number|null} displayDecimals
 * @property {UnavailableReason|null} unavailableReason
 */
/**
 * @typedef {Object} BranchQuote
 * @property {number} officialId
 * @property {string|null} branchCode
 * @property {BranchQuoteStatus} status
 * @property {Record<Denom, RateCell>} rates
 */
/**
 * @typedef {Object} BranchDetail
 * @property {number} officialId
 * @property {number} lat
 * @property {number} lng
 * @property {string|null} googleLink
 */
/**
 * @typedef {Object} ParsedRate
 * @property {number} rateScaledE6
 * @property {number} displayDecimals
 */

/**
 * Single global scale for every currency and every branch. Per-row scales
 * would break cross-row integer comparison (8912e-4 vs 89120e-5).
 */
export const RATE_SCALE_EXPONENT = 6;
export const RATE_SCALE = 1_000_000;

/** @type {readonly Denom[]} */
export const DENOMS = Object.freeze(['USD_100', 'USD_50', 'TWD']);

/**
 * Exact source `unit` + `denomRem` strings, verified 2026-09-09.
 * Matching is exact (whitespace included); the source's other USD
 * denominations ("20 - 10", "5", "1") are ignored, and a changed string is
 * reported as `missing` rather than guessed.
 * @type {Readonly<Record<Denom, { unit: string, denomRem: string }>>}
 */
export const SOURCE_DENOMS = Object.freeze({
  USD_100: Object.freeze({ unit: 'USD', denomRem: '100' }),
  USD_50: Object.freeze({ unit: 'USD', denomRem: '50' }),
  TWD: Object.freeze({ unit: 'TWD', denomRem: '2000 - 100' }),
});

/** Both forms observed in live data; anything else is dropped. */
export const GOOGLE_MAPS_HOSTS = Object.freeze([
  'maps.app.goo.gl',
  'goo.gl',
  'www.google.com',
  'google.com',
  'maps.google.com',
]);

/**
 * Verified against all 26 branches on 2026-09-09 (plan §2.2).
 * Branch 10 → H01, branch 11 → B01; mall/airport branches use M codes.
 */
export const BRANCH_CODE_PATTERN = /^[A-Z]{1,3}\d{1,3}$/;

const RATE_TEXT_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isSuccessfulResponse(value) {
  return isPlainObject(value) && value.statusCode === 200 && value.code === 'SUCCESS';
}

/**
 * Parse a source `buyText` into a single-scale integer.
 *
 * Integer string arithmetic is used deliberately: scaling through floating
 * point would reintroduce the error this contract exists to avoid. Values
 * carrying more than RATE_SCALE_EXPONENT decimals are rounded half-up rather
 * than rejected, so a future extra decimal from the source degrades the last
 * digit instead of blanking the branch.
 *
 * @param {unknown} text
 * @returns {ParsedRate|null} null when the value is unusable
 */
export function parseRateText(text) {
  if (typeof text !== 'string') return null;
  const match = RATE_TEXT_PATTERN.exec(text.trim());
  if (!match) return null;

  const whole = match[1];
  const frac = match[2] ?? '';

  let digits;
  if (frac.length <= RATE_SCALE_EXPONENT) {
    digits = BigInt(whole + frac.padEnd(RATE_SCALE_EXPONENT, '0'));
  } else {
    const kept = BigInt(whole + frac.slice(0, RATE_SCALE_EXPONENT));
    const nextDigit = Number(frac[RATE_SCALE_EXPONENT]);
    digits = nextDigit >= 5 ? kept + 1n : kept;
  }

  if (digits <= 0n) return null;
  if (digits > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  return {
    rateScaledE6: Number(digits),
    displayDecimals: Math.min(frac.length, RATE_SCALE_EXPONENT),
  };
}

/**
 * @param {unknown} value
 * @returns {string|null} the trimmed original when it is an https Google Maps URL
 */
export function normalizeGoogleLink(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!GOOGLE_MAPS_HOSTS.includes(url.hostname)) return null;
  return trimmed;
}

/** @param {unknown} value @returns {string|null} */
export function normalizeBranchCode(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return BRANCH_CODE_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Strict numeric coordinate. `Number('')` is 0, which would silently place a
 * branch off the coast of Africa, so blank and non-numeric input is rejected
 * rather than coerced.
 * @param {unknown} value
 * @param {number} limit
 * @returns {number|null}
 */
function toCoordinate(value, limit) {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < -limit || parsed > limit) return null;
  return parsed;
}

/** @param {unknown} value @returns {number|null} */
function toOfficialId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * `GET /branch-client/options`. Only the official ids are returned: the
 * source `label` is a display string and must not reach the snapshot.
 * @param {unknown} payload
 * @returns {number[]|null} null when the payload does not match the contract
 */
export function parseBranchOptions(payload) {
  if (!isSuccessfulResponse(payload) || !Array.isArray(payload.data)) return null;
  /** @type {number[]} */
  const ids = [];
  for (const entry of payload.data) {
    if (!isPlainObject(entry)) return null;
    const officialId = toOfficialId(entry.value);
    if (officialId === null) return null;
    if (ids.includes(officialId)) return null;
    ids.push(officialId);
  }
  return ids.length > 0 ? ids : null;
}

/**
 * `GET /branch-client/{id}` returns a success envelope with details in `data`.
 * `address` is a source display string and is
 * intentionally dropped; branch names and addresses come from Notion.
 * @param {unknown} payload
 * @returns {BranchDetail|null}
 */
export function parseBranchDetail(payload) {
  if (!isSuccessfulResponse(payload) || !isPlainObject(payload.data)) return null;
  const detail = payload.data;
  const officialId = toOfficialId(detail.id);
  if (officialId === null) return null;

  const lat = toCoordinate(detail.latitude, 90);
  const lng = toCoordinate(detail.longitude, 180);
  if (lat === null || lng === null) return null;

  return { officialId, lat, lng, googleLink: normalizeGoogleLink(detail.googleLink) };
}

/**
 * @param {Denom} denom
 * @param {UnavailableReason} reason
 * @returns {RateCell}
 */
function unavailableCell(denom, reason) {
  return { denom, rateScaledE6: null, displayDecimals: null, unavailableReason: reason };
}

/**
 * @param {UnavailableReason} reason
 * @param {number} officialId
 * @returns {BranchQuote}
 */
function failedQuote(reason, officialId) {
  return {
    officialId,
    branchCode: null,
    status: 'failed',
    rates: {
      USD_100: unavailableCell('USD_100', reason),
      USD_50: unavailableCell('USD_50', reason),
      TWD: unavailableCell('TWD', reason),
    },
  };
}

/**
 * Build a whole-branch failure result without a source payload, for
 * transport-level outcomes (timeout, HTTP error, breaker cut-off).
 * @param {number} officialId
 * @param {UnavailableReason} reason
 * @returns {BranchQuote}
 */
export function branchQuoteFailure(officialId, reason) {
  return failedQuote(reason, officialId);
}

/**
 * `GET /exchange-client/list?branchId={id}&type=exchange`.
 *
 * Only `buyText` is read; `sellText` never enters public exchange data.
 * A missing, malformed, inconsistent or unexpected `branchCode` fails the
 * whole branch, so one branch's numbers can never be shown under another's
 * name.
 *
 * @param {unknown} payload
 * @param {{ officialId: number, expectedBranchCode?: string|null }} options
 * @returns {BranchQuote}
 */
export function parseBranchExchange(payload, options) {
  const { officialId, expectedBranchCode = null } = options;

  if (!isSuccessfulResponse(payload) || !isPlainObject(payload.data)) {
    return failedQuote('invalid', officialId);
  }
  const exchange = payload.data.exchange;
  if (!isPlainObject(exchange)) return failedQuote('invalid', officialId);

  /** @type {Record<string, unknown>[]} */
  const entries = [];
  for (const rows of Object.values(exchange)) {
    if (!Array.isArray(rows)) return failedQuote('invalid', officialId);
    for (const row of rows) if (isPlainObject(row)) entries.push(row);
  }

  /** @type {Partial<Record<Denom, RateCell>>} */
  const rates = {};
  /** @type {Set<string>} */
  const seenCodes = new Set();
  let codeProblem = false;

  for (const denom of DENOMS) {
    const wanted = SOURCE_DENOMS[denom];
    const match = entries.find(
      (row) => row.unit === wanted.unit && row.denomRem === wanted.denomRem
    );
    if (!match) {
      rates[denom] = unavailableCell(denom, 'missing');
      continue;
    }

    const code = normalizeBranchCode(match.branchCode);
    if (code === null) codeProblem = true;
    else seenCodes.add(code);

    const parsed = parseRateText(match.buyText);
    rates[denom] = parsed
      ? { denom, rateScaledE6: parsed.rateScaledE6, displayDecimals: parsed.displayDecimals, unavailableReason: null }
      : unavailableCell(denom, 'invalid');
  }

  const branchCode = seenCodes.size === 1 ? [...seenCodes][0] : null;
  const identityBroken =
    codeProblem ||
    seenCodes.size > 1 ||
    (seenCodes.size === 0 && entries.length > 0) ||
    (expectedBranchCode !== null && branchCode !== expectedBranchCode);
  if (identityBroken) return failedQuote('invalid', officialId);

  const complete = DENOMS.filter((denom) => rates[denom]?.rateScaledE6 !== null).length;
  /** @type {BranchQuoteStatus} */
  const status = complete === DENOMS.length ? 'ok' : complete === 0 ? 'failed' : 'partial';

  return {
    officialId,
    branchCode,
    status,
    rates: {
      USD_100: rates.USD_100 ?? unavailableCell('USD_100', 'missing'),
      USD_50: rates.USD_50 ?? unavailableCell('USD_50', 'missing'),
      TWD: rates.TWD ?? unavailableCell('TWD', 'missing'),
    },
  };
}
