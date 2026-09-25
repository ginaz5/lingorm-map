// ═══════════════════════════════════════════════════
// SUPERRICH 1965 (ORANGE) EXCHANGE — SOURCE CONTRACT (Phase A1)
// Pure data parsing for the SuperRich 1965 public endpoints.
// No network, no DOM, no storage: this module is imported by both the
// scheduled Netlify Function and the browser bundle.
//
// Contract reference: docs/superrich1965-exchange-map-plan.zh-TW.md §2, §2.3, §3.3.
//
// This file is a DELIBERATE PARALLEL COPY of src/data/exchange-rates.js, not a
// shared multi-provider abstraction (plan §1). The two modules must never
// import each other: SuperRich Thailand (green) and SuperRich 1965 (orange)
// are different companies with different APIs, and coupling them would let a
// change to one break the other. Where behaviour MUST stay identical — the
// rate scaling — the duplication is guarded by a cross-module equivalence
// test in tests/exchange-rates-1965-source.test.mjs.
//
// Quotes contain numbers, fixed enums and validated branch numbers. Raw
// display strings never escape, because src/ui/render.js builds markup with
// innerHTML and performs no escaping.
// ═══════════════════════════════════════════════════

/** @typedef {'USD_1965'|'TWD_1965'} Denom1965 */
/** @typedef {'timeout'|'invalid'|'missing'|'http_error'|'expired'} UnavailableReason */
/** @typedef {'ok'|'partial'|'failed'} BranchQuoteStatus */
/**
 * @typedef {Object} RateCell1965
 * @property {Denom1965} denom
 * @property {number|null} rateScaledE6
 * @property {number|null} displayDecimals
 * @property {UnavailableReason|null} unavailableReason
 */
/**
 * @typedef {Object} BranchQuote1965
 * @property {string} branchNo caller-supplied; the source response carries no branch identity
 * @property {BranchQuoteStatus} status
 * @property {Record<Denom1965, RateCell1965>} rates
 * @property {number|null} sourceUpdatedAtMs raw `data.update_time`; semantics UNVERIFIED (plan §7.2)
 */
/**
 * @typedef {Object} BranchListEntry1965
 * @property {string} code the `branch_no` used by exchange-rate/get
 * @property {string} name source display string, for human cross-checking only
 * @property {string} companyCode
 * @property {boolean} isDefault
 */
/**
 * @typedef {Object} ParsedRate1965
 * @property {number} rateScaledE6
 * @property {number} displayDecimals
 */

/**
 * Single global scale for every currency and every branch, matching the green
 * module's value so both brands round and display identically. Per-row scales
 * would break integer comparison within a brand (8912e-4 vs 89120e-5).
 */
export const RATE_SCALE_EXPONENT_1965 = 6;
export const RATE_SCALE_1965 = 1_000_000;

/**
 * Sort keys are brand-scoped on purpose (plan §3.3): the orange source merges
 * denominations into single buckets ("100-50", "1000-100") that cannot be
 * split back into the green module's separate USD_100 / USD_50 / TWD rows, so
 * the two brands are never compared inside one ranking.
 * @type {readonly Denom1965[]}
 */
export const DENOMS_1965 = Object.freeze(['USD_1965', 'TWD_1965']);

/**
 * Exact source `currency_code` + `show_denom` strings, verified 2026-09-09.
 * Matching is exact (whitespace included); the source's other USD buckets
 * ("20-10", "5", "1") and its other 31 currencies are ignored, and a changed
 * string is reported as `missing` rather than guessed.
 * @type {Readonly<Record<Denom1965, { currencyCode: string, showDenom: string }>>}
 */
export const SOURCE_DENOMS_1965 = Object.freeze({
  USD_1965: Object.freeze({ currencyCode: 'USD', showDenom: '100-50' }),
  TWD_1965: Object.freeze({ currencyCode: 'TWD', showDenom: '1000-100' }),
});

/**
 * Tenant code for SuperRich 1965 inside the shared `/spr/*` backend. 38 of the
 * 39 branch-list entries carry this; `E52-01` (Terminal 21 Pattaya) carries
 * `E52` and its inclusion is a Phase A1 decision, not an assumption.
 */
export const COMPANY_CODE_1965 = 'A04';

/**
 * `branch_no` shapes observed 2026-09-09: two digits ("00", "51", "64") plus
 * one prefixed form ("E52-01"). Anything else is rejected rather than guessed.
 */
export const BRANCH_NO_PATTERN_1965 = /^(?:\d{2}|[A-Z]\d{2}-\d{2})$/;

const RATE_TEXT_PATTERN_1965 = /^(\d+)(?:\.(\d+))?$/;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `exchange-rate/get` answers with `code: "SUCCESS"`.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isSuccessfulRateResponse(value) {
  return isPlainObject(value) && value.status_code === 200 && value.code === 'SUCCESS';
}

/**
 * `exchange-rate/branch-list` answers with `code: "200"`, NOT `"SUCCESS"`.
 * The two endpoints of the same API disagree on the envelope, so they get
 * separate checks instead of one shared helper that would have to accept both
 * and therefore accept the wrong one.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isSuccessfulBranchListResponse(value) {
  return isPlainObject(value) && value.status_code === 200 && (value.code === '200' || value.code === 'SUCCESS');
}

/**
 * Parse a source `buy_rate_amount` into a single-scale integer.
 *
 * Integer string arithmetic is used deliberately: scaling through floating
 * point would reintroduce the error this contract exists to avoid. Values
 * carrying more than RATE_SCALE_EXPONENT_1965 decimals are rounded half-up
 * rather than rejected, so a future extra decimal from the source degrades the
 * last digit instead of blanking the branch.
 *
 * Behaviourally identical to parseRateText() in src/data/exchange-rates.js by
 * design; tests/exchange-rates-1965-source.test.mjs asserts the two never
 * diverge.
 *
 * @param {unknown} text
 * @returns {ParsedRate1965|null} null when the value is unusable
 */
export function parseRateText1965(text) {
  if (typeof text !== 'string') return null;
  const match = RATE_TEXT_PATTERN_1965.exec(text.trim());
  if (!match) return null;

  const whole = match[1];
  const frac = match[2] ?? '';

  let digits;
  if (frac.length <= RATE_SCALE_EXPONENT_1965) {
    digits = BigInt(whole + frac.padEnd(RATE_SCALE_EXPONENT_1965, '0'));
  } else {
    const kept = BigInt(whole + frac.slice(0, RATE_SCALE_EXPONENT_1965));
    const nextDigit = Number(frac[RATE_SCALE_EXPONENT_1965]);
    digits = nextDigit >= 5 ? kept + 1n : kept;
  }

  if (digits <= 0n) return null;
  if (digits > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  return {
    rateScaledE6: Number(digits),
    displayDecimals: Math.min(frac.length, RATE_SCALE_EXPONENT_1965),
  };
}

/** @param {unknown} value @returns {string|null} */
export function normalizeBranchNo(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return BRANCH_NO_PATTERN_1965.test(trimmed) ? trimmed : null;
}

/**
 * `data.update_time` is a Unix millisecond timestamp the green source does not
 * have. Its SEMANTICS ARE UNVERIFIED (plan §2, §7.2): it may be the quote time
 * or merely the time the response was generated. It is parsed and carried so a
 * later verification can use it, but callers must NOT present it to users as
 * 官網報價時間 until that verification lands; the card shows only 本次查詢時間.
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseSourceUpdateTime(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

/**
 * @param {Denom1965} denom
 * @param {UnavailableReason} reason
 * @returns {RateCell1965}
 */
function unavailableCell(denom, reason) {
  return { denom, rateScaledE6: null, displayDecimals: null, unavailableReason: reason };
}

/**
 * @param {UnavailableReason} reason
 * @param {string} branchNo
 * @returns {BranchQuote1965}
 */
function failedQuote(reason, branchNo) {
  return {
    branchNo,
    status: 'failed',
    sourceUpdatedAtMs: null,
    rates: {
      USD_1965: unavailableCell('USD_1965', reason),
      TWD_1965: unavailableCell('TWD_1965', reason),
    },
  };
}

/**
 * Build a whole-branch failure result without a source payload, for
 * transport-level outcomes (timeout, HTTP error, breaker cut-off).
 * @param {string} branchNo
 * @param {UnavailableReason} reason
 * @returns {BranchQuote1965}
 */
export function branchQuoteFailure1965(branchNo, reason) {
  return failedQuote(reason, branchNo);
}

/**
 * `POST /spr/front/exchange-rate/get`.
 *
 * Only `buy_rate_amount` is read; `sell_rate_amount` never enters public
 * exchange data (this feature only covers 換出泰銖).
 *
 * IDENTITY WARNING: unlike the green source — whose rows carry a `branchCode`
 * that is cross-checked so one branch's numbers can never appear under
 * another's name — this response contains NO branch identifier at all. The
 * returned `branchNo` is simply echoed back from the caller. The only defence
 * against mislabelling is that the caller looked the code up in
 * data/superrich1965-branches.json before the request, so that mapping file
 * must be correct and stable (plan §2).
 *
 * @param {unknown} payload
 * @param {{ branchNo: string }} options
 * @returns {BranchQuote1965}
 */
export function parseBranchExchange1965(payload, options) {
  const branchNo = normalizeBranchNo(options?.branchNo);
  if (branchNo === null) return failedQuote('invalid', String(options?.branchNo ?? ''));

  if (!isSuccessfulRateResponse(payload) || !isPlainObject(payload.data)) {
    return failedQuote('invalid', branchNo);
  }
  const datas = payload.data.datas;
  if (!Array.isArray(datas)) return failedQuote('invalid', branchNo);

  const sourceUpdatedAtMs = parseSourceUpdateTime(payload.data.update_time);

  /** @type {Partial<Record<Denom1965, RateCell1965>>} */
  const rates = {};

  for (const denom of DENOMS_1965) {
    const wanted = SOURCE_DENOMS_1965[denom];
    // Array order is NOT stable across responses (plan §2): match by string,
    // never by index.
    const currency = datas.find(
      (entry) => isPlainObject(entry) && entry.currency_code === wanted.currencyCode
    );
    if (!isPlainObject(currency) || !Array.isArray(currency.denom_list)) {
      rates[denom] = unavailableCell(denom, 'missing');
      continue;
    }
    const bucket = currency.denom_list.find(
      (row) => isPlainObject(row) && row.show_denom === wanted.showDenom
    );
    if (!isPlainObject(bucket)) {
      rates[denom] = unavailableCell(denom, 'missing');
      continue;
    }
    const parsed = parseRateText1965(bucket.buy_rate_amount);
    rates[denom] = parsed
      ? { denom, rateScaledE6: parsed.rateScaledE6, displayDecimals: parsed.displayDecimals, unavailableReason: null }
      : unavailableCell(denom, 'invalid');
  }

  const complete = DENOMS_1965.filter((denom) => rates[denom]?.rateScaledE6 !== null).length;
  /** @type {BranchQuoteStatus} */
  const status = complete === DENOMS_1965.length ? 'ok' : complete === 0 ? 'failed' : 'partial';

  return {
    branchNo,
    status,
    sourceUpdatedAtMs,
    rates: {
      USD_1965: rates.USD_1965 ?? unavailableCell('USD_1965', 'missing'),
      TWD_1965: rates.TWD_1965 ?? unavailableCell('TWD_1965', 'missing'),
    },
  };
}

/**
 * `POST /spr/front/exchange-rate/branch-list` — the branch picker behind the
 * official page, and the only place `branch_no` values exist.
 *
 * `branch_group_no` is blank on every observed entry, so this response cannot
 * distinguish Our Branch from Partner Branch; that split has to come from
 * `/spr/front/branches`'s `groups[]` (plan §2.3). `name` is kept only so a
 * human can cross-check against that other endpoint — it is a source display
 * string and must never be rendered.
 *
 * @param {unknown} payload
 * @returns {BranchListEntry1965[]|null} null when the payload breaks the contract
 */
export function parseBranchList1965(payload) {
  if (!isSuccessfulBranchListResponse(payload) || !isPlainObject(payload.data)) return null;
  const datas = payload.data.datas;
  if (!Array.isArray(datas) || datas.length === 0) return null;

  /** @type {BranchListEntry1965[]} */
  const entries = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (const entry of datas) {
    if (!isPlainObject(entry)) return null;
    const code = normalizeBranchNo(entry.code);
    if (code === null || seen.has(code)) return null;
    if (typeof entry.name !== 'string' || entry.name.trim() === '') return null;
    if (typeof entry.company_code !== 'string' || entry.company_code.trim() === '') return null;
    seen.add(code);
    entries.push({
      code,
      name: entry.name.trim(),
      companyCode: entry.company_code.trim(),
      isDefault: entry.is_default === true,
    });
  }

  // `total` is advisory, but a mismatch means the caller silently paginated.
  if (typeof payload.data.total === 'number' && payload.data.total !== entries.length) return null;

  return entries;
}
