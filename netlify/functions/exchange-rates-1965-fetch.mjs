import { loadBranchMapping, runExchangeRateFetch } from './_shared/exchange-rates-1965-runner.mjs';
import { createRuntimeStore } from './_shared/exchange-rates-1965-storage.mjs';

/**
 * Keep intentional disablement at INFO, but make every result that can leave
 * rates unavailable visible as an ERROR in the Netlify function log.
 * @param {Record<string, any>} result
 * @param {{info?:(message:string)=>void,error?:(message:string)=>void}} [logger]
 */
export function logExchangeRateFetchResult(result, logger = {}) {
  const message = JSON.stringify({ event: 'exchange_rates_1965_fetch', ...result });
  const isComplete = result.status === 'published' && result.sourceOutcome === 'complete';
  const isDisabled = result.status === 'disabled';
  if (isComplete || isDisabled) (logger.info ?? console.log)(message);
  else (logger.error ?? console.error)(message);
}

/** @param {Request} request @param {{deploy?:{context?:string}}} [context] */
export default async function exchangeRatesFetch(request, context) {
  const functionStartedAtMs = Date.now();
  try {
    const result = await runExchangeRateFetch({
      store: createRuntimeStore({ context: context?.deploy?.context }),
      mapping: await loadBranchMapping(),
      functionStartedAtMs,
    });
    logExchangeRateFetchResult(result);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'exchange_rates_1965_fetch_failed',
      code: error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'internal_error',
    }));
    throw error;
  }
}

export const config = {
  schedule: '0,30 * * * *',
};
