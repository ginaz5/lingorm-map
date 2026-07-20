import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import locationsHandler, {
  serveNotionSnapshot,
} from '../netlify/functions/locations.mjs';
import { parseCSV } from '../src/csv-parser.js';

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

test('returns 500 when GOOGLE_SHEET_CSV_URL is not configured', async () => {
  await withNetlifyEnv({}, async () => {
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
    await withNetlifyEnv({
      GOOGLE_SHEET_CSV_URL: 'https://docs.google.com/spreadsheets/d/example/export?format=csv',
    }, async () => {
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
    await withNetlifyEnv({
      DATA_SOURCE: 'sheet',
      GOOGLE_SHEET_CSV_URL: 'https://docs.google.com/spreadsheets/d/sheet-id/edit?gid=12345#gid=12345',
    }, async () => {
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
    await withNetlifyEnv({
      GOOGLE_SHEET_CSV_URL: 'https://docs.google.com/spreadsheets/d/example/edit?usp=sharing',
    }, async () => {
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

test('serves the committed Notion snapshot when DATA_SOURCE=notion', async () => {
  await withNetlifyEnv({
    DATA_SOURCE: 'notion',
  }, async () => {
    const response = await locationsHandler(new Request('https://example.test/api/locations'));
    const csv = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');
    assert.match(csv, /"Location Name"/);
    assert.match(csv, /"Slug"/);
    assert.doesNotMatch(csv.split(/\r?\n/, 1)[0], /Duplicate Group/);
    assert.equal(parseCSV(csv).length, 100);
  });
});

test('does not require the Google Sheet URL when DATA_SOURCE=notion', async () => {
  await withNetlifyEnv({
    DATA_SOURCE: 'notion',
  }, async () => {
    const response = await locationsHandler(new Request('https://example.test/api/locations'));

    assert.equal(response.status, 200);
  });
});

test('returns 503 when the Notion snapshot is missing', async () => {
  const response = await serveNotionSnapshot('/path/that/does/not/exist.csv');

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Notion snapshot is not available' });
});

test('rejects an invalid Notion snapshot', async () => {
  const invalidFixture = fileURLToPath(new URL('../package.json', import.meta.url));
  const response = await serveNotionSnapshot(invalidFixture);

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'Notion snapshot is invalid: expected a CSV with Location Name and Slug columns',
  });
});

test('rejects an unsupported DATA_SOURCE value', async () => {
  await withNetlifyEnv({ DATA_SOURCE: 'database' }, async () => {
    const response = await locationsHandler(new Request('https://example.test/api/locations'));

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'DATA_SOURCE must be either "sheet" or "notion"',
    });
  });
});
