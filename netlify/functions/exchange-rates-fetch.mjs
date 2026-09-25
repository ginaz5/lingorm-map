import { loadBranchMapping, runExchangeRateFetch } from './_shared/exchange-rates-runner.mjs';
import { createRuntimeStore } from './_shared/exchange-rates-storage.mjs';

/** @param {Request} request @param {{deploy?:{context?:string}}} [context] */
export default async function exchangeRatesFetch(request, context) {
  const functionStartedAtMs = Date.now();
  try {
    const result = await runExchangeRateFetch({
      store: createRuntimeStore({ context: context?.deploy?.context }),
      mapping: await loadBranchMapping(),
      functionStartedAtMs,
    });
    console.log(JSON.stringify({ event: 'exchange_rates_fetch', ...result }));
  } catch (error) {
    console.error(JSON.stringify({
      event: 'exchange_rates_fetch_failed',
      code: error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'internal_error',
    }));
    throw error;
  }
}

export const config = {
  schedule: '0,30 * * * *',
};
