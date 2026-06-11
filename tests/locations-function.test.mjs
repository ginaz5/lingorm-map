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

test('converts a Google Sheets edit URL to a CSV export URL', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(
      url,
      'https://docs.google.com/spreadsheets/d/sheet-id/export?format=csv&gid=12345'
    );
    return new Response('Name_EN,Lat\nThe Siam,13.7608\n', {
      status: 200,
      headers: { 'content-type': 'text/csv' },
    });
  };

  try {
    await withNetlifyEnv('https://docs.google.com/spreadsheets/d/sheet-id/edit?gid=12345#gid=12345', async () => {
      const response = await locationsHandler(new Request('https://example.test/api/locations'));

      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'Name_EN,Lat\nThe Siam,13.7608\n');
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('rejects Google Sheets HTML pages instead of returning them as CSV', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('<!DOCTYPE html><title>Google Sheets</title>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    });

  try {
    await withNetlifyEnv('https://docs.google.com/spreadsheets/d/example/edit?usp=sharing', async () => {
      const response = await locationsHandler(new Request('https://example.test/api/locations'));

      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        error: 'Google Sheet URL did not return CSV. Use a published CSV URL or a share URL that can be exported as CSV.',
      });
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
