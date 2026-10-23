import { getStore } from '@netlify/blobs';
import { createRuntimeStore } from './_shared/exchange-rates-1965-storage.mjs';
import { readEntry } from './_shared/exchange-rates-1965-storage.mjs';
import { NETLIFY_CONTROL_KEY, parseNetlifyWork, runNetlifyRates } from './_shared/exchange-rates-1965-netlify.mjs';
import { createRuntimePythonSource } from './_shared/exchange-rates-1965-python-runtime.mjs';

/** @param {Request} request @param {any} context */
export default async function backgroundRates(request, context) {
  try {
    if (request.method !== 'POST') return;
    const text = await request.text();
    if (text.length > 1024) return;
    const store = createRuntimeStore({ context: context?.deploy?.context });
    const binding = (await readEntry(store, NETLIFY_CONTROL_KEY))?.data;
    if (!binding?.enabled || !parseNetlifyWork(text, request.headers.get('x-lingorm-signature'), binding, Date.now())) return;
    const source = await createRuntimePythonSource();
    const result = await runNetlifyRates({ store, source,
      sourceGuardStore: getStore({ name: 'exchange-rates-1965-source-guard', consistency: 'strong' }),
      identity: { siteID: context?.site?.id, deployID: context?.deploy?.id, context: context?.deploy?.context },
      body: text, signature: request.headers.get('x-lingorm-signature') });
    console.info(JSON.stringify({ event: 'exchange_rates_1965_netlify_complete', ...result }));
  } catch { console.error(JSON.stringify({ event: 'exchange_rates_1965_netlify_failed', reason: 'worker_unavailable' })); }
}
export const config = { background: true, nodeVersion: '22' };
