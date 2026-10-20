import { BRANCH_API_SCHEMA_VERSION, ORANGE_BRANCHES, isValidBranchQuote, parseBranchQueryPayload } from '../../../src/data/exchange-rates-1965-branch.js';
import { EXCHANGE_KEYS, isValidSnapshot } from './exchange-rates-1965-contract.mjs';
import { readEffectiveControl } from './exchange-rates-1965-control.mjs';
import { readEntry } from './exchange-rates-1965-storage.mjs';
import { quoteExpiryMs } from '../../../src/data/exchange-rate-timing.js';

const BRANCH_READ_RETRY_MS = 60_000;
/** @param {string} slug */
export const branchCacheKey = slug => `exchange-rates-1965/branches/${slug}`;

/** One JSON envelope for success and failure; no source diagnostics are exposed.
 * @param {string} slug @param {number} nowMs @param {any} [options]
 */
export function branchResponse(slug, nowMs, { status = 200, enabled = null, controlVersion = null, quote = null, reason = null, retryAtMs = null } = {}) {
  const retryAfterSeconds = retryAtMs === null ? 0 : Math.min(7 * 24 * 60 * 60, Math.max(1, Math.ceil((retryAtMs - nowMs) / 1000)));
  return new Response(JSON.stringify({ schemaVersion: BRANCH_API_SCHEMA_VERSION, checkedAt: new Date(nowMs).toISOString(),
    enabled, controlVersion, slug, quote, reason, retryAfterSeconds }), {
    status, headers: { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store',
      ...(retryAfterSeconds ? { 'retry-after': String(retryAfterSeconds) } : {}),
      ...(status === 405 ? { allow: 'POST' } : {}),
    },
  });
}

/** Public refreshes only read saved quotes. No control initialization, writes,
 * source requests, breaker checks or lease acquisition happen on this path.
 * @param {{store:any,slug:string,enabledDefault?:unknown,nowImpl?:()=>number}} input
 */
export async function readBranchRates({ store, slug, enabledDefault = process.env.EXCHANGE_RATES_1965_ENABLED,
  nowImpl = Date.now }) {
  if (!Object.hasOwn(ORANGE_BRANCHES, slug)) return branchResponse(slug, nowImpl(), { status: 400, reason: 'invalid_request' });
  /** @type {any} */
  let control = null;
  /** @type {boolean|null} */
  let enabled = null;
  /** @param {string} reason */
  const unavailable = reason => branchResponse(slug, nowImpl(), { status: 503, reason, enabled,
    controlVersion: control?.controlVersion ?? null, retryAtMs: nowImpl() + BRANCH_READ_RETRY_MS });
  try {
    const first = await readEffectiveControl(store, enabledDefault);
    control = first.control;
    enabled = first.enabled;
    if (!enabled) return unavailable('disabled');
    // Readers never create the first control, even when the env default is true.
    if (!control) return unavailable('unavailable');
    const version = control.controlVersion;
    const enabledAtMs = Date.parse(control.enabledAt);
    /** @param {any} candidate */
    const usable = candidate => isValidBranchQuote(candidate) && candidate.slug === slug &&
      candidate.controlVersion === version && Date.parse(candidate.attemptedAt) >= enabledAtMs &&
      Date.parse(candidate.expiresAt) > nowImpl() && Date.parse(candidate.completedAt) <= nowImpl();
    let quote = (await readEntry(store, branchCacheKey(slug)))?.data;
    if (!usable(quote)) {
      // Existing local collectors publish a complete snapshot. Read it without
      // seeding a branch blob or extending the original quote lifetime.
      const full = (await readEntry(store, EXCHANGE_KEYS.snapshot))?.data;
      const branch = isValidSnapshot(full)
        ? full.branches.find((/** @type {any} */ candidate) => candidate.slug === slug) : null;
      quote = branch?.status === 'ok' ? {
        schemaVersion: BRANCH_API_SCHEMA_VERSION, slug, controlVersion: full.controlVersion,
        attemptedAt: full.attemptedAt, completedAt: full.completedAt,
        expiresAt: new Date(Math.min(Date.parse(full.expiresAt), quoteExpiryMs(Date.parse(full.attemptedAt)))).toISOString(), branch,
      } : null;
    }
    const latest = await readEffectiveControl(store, enabledDefault);
    control = latest.control;
    enabled = latest.enabled;
    if (!enabled) return unavailable('disabled');
    if (control?.controlVersion !== version) return unavailable('stale_control');
    if (!usable(quote)) return unavailable('unavailable');
    // Use the public parser to omit fields outside the quote contract.
    const nowMs = nowImpl();
    const parsed = parseBranchQueryPayload({ schemaVersion: BRANCH_API_SCHEMA_VERSION,
      checkedAt: new Date(nowMs).toISOString(), enabled: true, controlVersion: version,
      slug, quote, reason: null, retryAfterSeconds: 0 }, slug);
    if (!parsed?.quote) return unavailable('unavailable');
    return branchResponse(slug, nowMs, { enabled: true, controlVersion: version, quote: parsed.quote });
  } catch {
    return unavailable('storage_unavailable');
  }
}
