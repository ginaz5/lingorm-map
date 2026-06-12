import assert from 'node:assert/strict';
import test from 'node:test';

import configHandler from '../netlify/functions/config.mjs';

function withNetlifyEnv(values, fn) {
  const previous = globalThis.Netlify;
  globalThis.Netlify = {
    env: {
      get(key) {
        return values[key];
      },
    },
  };

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) {
        delete globalThis.Netlify;
      } else {
        globalThis.Netlify = previous;
      }
    });
}

test('returns Google Maps browser config from Netlify env', async () => {
  await withNetlifyEnv({
    GOOGLE_MAPS_KEY: 'maps-key',
    GOOGLE_MAP_ID: 'map-id',
  }, async () => {
    const response = await configHandler(new Request('https://example.test/api/config'));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(await response.json(), {
      googleMapsKey: 'maps-key',
      googleMapId: 'map-id',
    });
  });
});

test('returns 500 when Maps config is missing', async () => {
  await withNetlifyEnv({ GOOGLE_MAPS_KEY: 'maps-key' }, async () => {
    const response = await configHandler(new Request('https://example.test/api/config'));

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'GOOGLE_MAPS_KEY and GOOGLE_MAP_ID are required',
    });
  });
});
