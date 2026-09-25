import { resolveFetchMode } from './_shared/exchange-rates-1965-contract.mjs';
import { loadBranchMapping, runExchangeRateFetch } from './_shared/exchange-rates-1965-runner.mjs';
import { createRuntimeStore } from './_shared/exchange-rates-1965-storage.mjs';

/**
 * Keep intentional disablement and the expected external-fetcher skip at INFO,
 * but make every result that can leave rates unavailable visible as an ERROR
 * in the Netlify function log.
 * @param {Record<string, any>} result
 * @param {{info?:(message:string)=>void,error?:(message:string)=>void}} [logger]
 */
export function logExchangeRateFetchResult(result, logger = {}) {
  const message = JSON.stringify({ event: 'exchange_rates_1965_fetch', ...result });
  const isComplete = result.status === 'published' && result.sourceOutcome === 'complete';
  const isDisabled = result.status === 'disabled';
  const isExternalFetcher = result.status === 'skipped' && result.reason === 'external_fetcher';
  if (isComplete || isDisabled || isExternalFetcher) (logger.info ?? console.log)(message);
  else (logger.error ?? console.error)(message);
}

/**
 * Which collector owns fetching. `local` is NOT the public enable switch:
 * `/api/exchange-rates-1965` keeps serving a valid snapshot while the local
 * CLI publishes it.
 * @param {{fetchMode?:unknown}} [input]
 * @param {{info?:(message:string)=>void,error?:(message:string)=>void}} [logger]
 */
export function resolveScheduledFetchMode({ fetchMode = process.env.EXCHANGE_RATES_1965_FETCH_MODE } = {}, logger = {}) {
  try {
    return { mode: resolveFetchMode(fetchMode), valid: /** @type {const} */ (true) };
  } catch {
    (logger.error ?? console.error)(JSON.stringify({
      event: 'exchange_rates_1965_fetch',
      status: 'failed',
      reason: 'invalid_fetch_mode',
      sourceRequestCount: 0,
    }));
    return { mode: null, valid: /** @type {const} */ (false) };
  }
}

/** @param {Request} request @param {{deploy?:{context?:string}}} [context] */
export default async function exchangeRatesFetch(request, context) {
  const functionStartedAtMs = Date.now();
  const { mode, valid } = resolveScheduledFetchMode();
  if (!valid) return;
  if (mode === 'local') {
    // Return before creating the store: no control read, no breaker or
    // snapshot write, and no source request from the cloud.
    logExchangeRateFetchResult({
      status: 'skipped',
      reason: 'external_fetcher',
      fetchMode: mode,
      sourceRequestCount: 0,
    });
    return;
  }
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
