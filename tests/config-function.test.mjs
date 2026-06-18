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

test('returns HERE Maps browser config from Netlify env', async () => {
  await withNetlifyEnv({
    HERE_API_KEY: 'here-key',
  }, async () => {
    const response = await configHandler(new Request('https://example.test/api/config'));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(await response.json(), {
      hereApiKey: 'here-key',
    });
  });
});

test('returns 500 when Maps config is missing', async () => {
  await withNetlifyEnv({}, async () => {
    const response = await configHandler(new Request('https://example.test/api/config'));

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'HERE_API_KEY is required',
    });
  });
});
