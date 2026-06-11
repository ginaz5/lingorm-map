import assert from 'node:assert/strict';
import test from 'node:test';

import locationsHandler from '../netlify/functions/locations.mjs';

function withNetlifyEnv(value, fn) {
  const previous = globalThis.Netlify;
  globalThis.Netlify = {
    env: {
      get(key) {
        return key === 'GOOGLE_SHEET_CSV_URL' ? value : undefined;
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

test('returns 500 when GOOGLE_SHEET_CSV_URL is not configured', async () => {
  await withNetlifyEnv('', async () => {
    const response = await locationsHandler(new Request('https://example.test/api/locations'));

    assert.equal(response.status, 500);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(await response.json(), { error: 'GOOGLE_SHEET_CSV_URL is not configured' });
  });
});

test('proxies the configured Google Sheet CSV as text/csv', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://docs.google.com/spreadsheets/d/example/export?format=csv');
    return new Response('Name_EN,Lat\nThe Siam,13.7608\n', {
      status: 200,
      headers: { 'content-type': 'text/csv' },
    });
  };

  try {
    await withNetlifyEnv('https://docs.google.com/spreadsheets/d/example/export?format=csv', async () => {
      const response = await locationsHandler(new Request('https://example.test/api/locations'));

      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
      assert.equal(response.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');
      assert.equal(await response.text(), 'Name_EN,Lat\nThe Siam,13.7608\n');
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
