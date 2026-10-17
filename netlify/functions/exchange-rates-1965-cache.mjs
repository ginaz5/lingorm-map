import { BRANCH_API_SCHEMA_VERSION, ORANGE_BRANCHES, isValidBranchQuote, parseBranchQueryPayload } from '../../src/data/exchange-rates-1965-branch.js';
import { readEffectiveControl } from './_shared/exchange-rates-1965-control.mjs';
import { branchCacheKey } from './_shared/exchange-rates-1965-on-demand.mjs';
import { createRuntimeStore, readEntry } from './_shared/exchange-rates-1965-storage.mjs';

/** @param {any} body @param {number} [status] */
const json = (body, status = 200) => Response.json(body, { status, headers: {
  'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store',
} });

/** Cache reads never initialize control, write blobs or request upstream rates.
 * @param {{store:any,enabledDefault?:unknown,nowImpl?:()=>number}} input
 */
export async function serveBranchCache({ store, enabledDefault = process.env.EXCHANGE_RATES_1965_ENABLED, nowImpl = Date.now }) {
  const envelope = (/** @type {any} */ control, /** @type {any[]} */ quotes = []) => ({
    schemaVersion: BRANCH_API_SCHEMA_VERSION, checkedAt: new Date(nowImpl()).toISOString(),
    enabled: control.enabled, controlVersion: control.control?.controlVersion ?? null, quotes,
  });
  try {
    const first = await readEffectiveControl(store, enabledDefault);
    if (!first.enabled || !first.control) return json(envelope(first));
    const entries = await Promise.all(Object.keys(ORANGE_BRANCHES).map(async slug => ({ slug,
      quote: (await readEntry(store, branchCacheKey(slug)))?.data,
    })));
    const latest = await readEffectiveControl(store, enabledDefault);
    if (!latest.enabled || latest.control?.controlVersion !== first.control.controlVersion) return json(envelope(latest));
    const body = envelope(latest);
    for (const { slug, quote } of entries) {
      if (!isValidBranchQuote(quote) || quote.slug !== slug ||
          Date.parse(quote.attemptedAt) < Date.parse(first.control.enabledAt ?? '')) continue;
      const parsed = parseBranchQueryPayload({ ...body, slug, quote, reason: null, retryAfterSeconds: 0 }, slug);
      if (parsed) body.quotes.push(parsed.quote);
    }
    return json(body);
  } catch {
    return json({ schemaVersion: BRANCH_API_SCHEMA_VERSION, checkedAt: new Date(nowImpl()).toISOString(),
      enabled: null, controlVersion: null, quotes: [], reason: 'storage_unavailable' }, 503);
  }
}

/** @param {Request} request @param {{deploy?:{context?:string}}} [context] */
export default async function branchCache(request, context) {
  if (request.method !== 'GET') return json({ reason: 'method_not_allowed' }, 405);
  try { return await serveBranchCache({ store: createRuntimeStore({ context: context?.deploy?.context }) }); }
  catch { return json({ reason: 'storage_unavailable' }, 503); }
}

export const config = { path: '/api/exchange-rates-1965-cache' };
