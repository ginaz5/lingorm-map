import { getStore } from '@netlify/blobs';
import { createRuntimeStore } from './_shared/exchange-rates-1965-storage.mjs';
import { dispatchNetlifyRates } from './_shared/exchange-rates-1965-netlify.mjs';

/** @param {Request} request @param {any} context */
export default async function scheduledRates(request, context) {
  const result = await dispatchNetlifyRates({ store: createRuntimeStore({ context: context?.deploy?.context }),
    sourceGuardStore: getStore({ name: 'exchange-rates-1965-source-guard', consistency: 'strong' }),
    identity: { siteID: context?.site?.id, deployID: context?.deploy?.id, context: context?.deploy?.context } });
  console.info(JSON.stringify({ event: 'exchange_rates_1965_netlify_dispatch', ...result }));
}
export const config = { schedule: '0,30 1-15 * * *', nodeVersion: '22' };
