import { runSlowBatch } from './_shared/exchange-rates-1965-background.mjs';
import { resolveFetchMode } from './_shared/exchange-rates-1965-contract.mjs';
import { createRuntimeStore } from './_shared/exchange-rates-1965-storage.mjs';

/** Only a server-created, unclaimed job token can start source requests.
 * @param {Request} request @param {{deploy?:{context?:string}}} [context]
 */
export default async function refresh(request, context) {
  try {
    if (request.method !== 'POST' || !['netlify', 'background'].includes(resolveFetchMode(process.env.EXCHANGE_RATES_1965_FETCH_MODE))) return;
    const authorization = request.headers.get('authorization') ?? '';
    if (!/^Bearer [0-9a-f-]{36}$/i.test(authorization)) return;
    const result = await runSlowBatch({ token: authorization.slice(7), store: createRuntimeStore({ context: context?.deploy?.context }) });
    // Never log the bearer token, job blob or request headers.
    console.log(JSON.stringify({ event: 'exchange_rates_1965_background', ...result }));
  } catch { console.error(JSON.stringify({ event: 'exchange_rates_1965_background', status: 'stopped', reason: 'internal_error' })); }
}

export const config = { background: true };
