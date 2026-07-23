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

test('serves the committed Notion snapshot with no DATA_SOURCE set (default)', async () => {
  await withNetlifyEnv({}, async () => {
    const response = await locationsHandler(new Request('https://example.test/api/locations'));
    const csv = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');
    assert.match(csv, /"Location Name"/);
    assert.match(csv, /"Slug"/);
    assert.equal(parseCSV(csv).length, 130);
  });
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
    assert.equal(parseCSV(csv).length, 130);
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

test('DATA_SOURCE=sheet fails closed with a retired-path error and never fetches', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('must not fetch the retired sheet path');
  };

  try {
    await withNetlifyEnv({
      DATA_SOURCE: 'sheet',
      GOOGLE_SHEET_CSV_URL: 'https://docs.google.com/spreadsheets/d/example/export?format=csv',
    }, async () => {
      const response = await locationsHandler(new Request('https://example.test/api/locations'));

      assert.equal(response.status, 410);
      assert.match((await response.json()).error, /DATA_SOURCE=sheet is retired/);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('rejects an unsupported DATA_SOURCE value', async () => {
  await withNetlifyEnv({ DATA_SOURCE: 'database' }, async () => {
    const response = await locationsHandler(new Request('https://example.test/api/locations'));

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'DATA_SOURCE must be "notion" (sheet rollback path is retired)',
    });
  });
});

test('rejects non-GET requests', async () => {
  const response = await locationsHandler(new Request('https://example.test/api/locations', { method: 'POST' }));

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: 'Method not allowed' });
});
