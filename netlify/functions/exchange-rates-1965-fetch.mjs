import { resolveFetchMode } from './_shared/exchange-rates-1965-contract.mjs';
import { dispatchSlowBatch } from './_shared/exchange-rates-1965-background.mjs';
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
  const isExternalFetcher = result.status === 'skipped' && ['external_fetcher', 'on_demand'].includes(result.reason);
  if (isComplete || isDisabled || isExternalFetcher || result.status === 'dispatched' ||
      (result.status === 'skipped' && ['already_scheduled', 'busy'].includes(result.reason))) (logger.info ?? console.log)(message);
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

/** Use a deploy permalink so Preview jobs cannot dispatch to production.
 * DEPLOY_URL is a build variable, not a guaranteed Functions runtime variable.
 * @param {Request} request
 * @param {{deploy?:{context?:string,id?:string},site?:{name?:string,url?:string}}} [context]
 * @param {Record<string,string|undefined>} [env]
 */
export function resolveBackgroundDeployURL(request, context, env = process.env) {
  const requestURL = new URL(request.url);
  if (env.NETLIFY_DEV === 'true' && ['localhost', '127.0.0.1'].includes(requestURL.hostname)) return requestURL.origin;
  const deployId = context?.deploy?.id;
  const siteName = context?.site?.name ?? env.SITE_NAME;
  if (deployId && siteName && /^[a-z0-9-]+$/i.test(deployId) && /^[a-z0-9-]+$/i.test(siteName)) {
    return `https://${deployId}--${siteName}.netlify.app`;
  }
  if (context?.deploy?.context === 'production') return context?.site?.url ?? env.URL ?? '';
  return ''; // Missing Preview identity must fail closed, never target production.
}

/** @param {Request} request @param {{deploy?:{context?:string,id?:string},site?:{name?:string,url?:string}}} [context] */
export default async function exchangeRatesFetch(request, context) {
  const { mode, valid } = resolveScheduledFetchMode();
  if (!valid) return;
  if (mode === 'local' || mode === 'on-demand') {
    // Return before creating the store: no control read, no breaker or
    // snapshot write, and no source request from the cloud.
    logExchangeRateFetchResult({
      status: 'skipped',
      reason: mode === 'on-demand' ? 'on_demand' : 'external_fetcher',
      fetchMode: mode,
      sourceRequestCount: 0,
    });
    return;
  }
  try {
    const result = await dispatchSlowBatch({
      store: createRuntimeStore({ context: context?.deploy?.context }),
      deployURL: resolveBackgroundDeployURL(request, context),
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
