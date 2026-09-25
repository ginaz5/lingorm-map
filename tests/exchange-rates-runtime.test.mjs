import assert from 'node:assert/strict';
import test from 'node:test';
import { setEnvironmentContext } from '@netlify/blobs';

import exchangeRates from '../netlify/functions/exchange-rates.mjs';
import exchangeRatesFetch from '../netlify/functions/exchange-rates-fetch.mjs';
import { createControl } from '../netlify/functions/_shared/exchange-rates-contract.mjs';
import { uuid } from './helpers/exchange-rates-store.mjs';

for (const context of ['production', 'deploy-preview', 'branch-deploy', 'dev', undefined]) {
  test(`both function handlers use runtime deployment context: ${context ?? 'missing'}`, async t => {
    const previousContext = process.env.CONTEXT;
    const previousBlobs = process.env.NETLIFY_BLOBS_CONTEXT;
    const previousGlobalBlobs = globalThis.netlifyBlobsContext;
    t.after(() => {
      if (previousContext === undefined) delete process.env.CONTEXT;
      else process.env.CONTEXT = previousContext;
      if (previousBlobs === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT;
      else process.env.NETLIFY_BLOBS_CONTEXT = previousBlobs;
      globalThis.netlifyBlobsContext = previousGlobalBlobs;
    });
    // Production must work without build variables; other contexts must not
    // touch production even if a build variable says otherwise.
    if (context === 'production') delete process.env.CONTEXT;
    else process.env.CONTEXT = 'production';
    globalThis.netlifyBlobsContext = undefined;
    setEnvironmentContext({
      siteID: 'fixture-site', token: 'fixture-token', deployID: 'fixturedeploy',
      primaryRegion: 'us-east-1', edgeURL: 'https://cached.blobs.test',
      uncachedEdgeURL: 'https://strong.blobs.test',
    });
    const requested = [];
    const disabled = createControl({
      enabled: false, disabledReason: 'manual', updatedBy: 'manual',
      controlVersion: uuid(1), nowMs: Date.now(),
    });
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      requested.push({ url: new URL(url), method: options.method });
      return Response.json(disabled, { headers: { etag: 'fixture-etag' } });
    });
    t.mock.method(console, 'log', () => {});
    const runtimeContext = context === undefined ? undefined : { deploy: { context } };
    const request = new Request('https://example.test/api/exchange-rates');
    const response = await exchangeRates(request, runtimeContext);
    assert.equal((await response.json()).enabled, false);
    await exchangeRatesFetch(request, runtimeContext);

    assert.equal(requested.length, 2);
    const storeName = context === 'production' ? 'site:exchange-rates' : 'deploy:fixturedeploy:exchange-rates';
    for (const { url, method } of requested) {
      assert.equal(url.host, 'strong.blobs.test');
      assert.ok(url.pathname.endsWith(`/fixture-site/${storeName}/exchange-rates/control`), url.pathname);
      assert.equal(method.toLowerCase(), 'get');
    }
  });
}
