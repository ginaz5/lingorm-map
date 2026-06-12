import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('index loads Google Maps through runtime config instead of build placeholders', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.equal(html.includes('__GOOGLE_MAPS_KEY__'), false);
  assert.equal(html.includes('__GOOGLE_MAP_ID__'), false);
  assert.equal(html.includes('/api/config'), true);
  assert.equal(html.includes('maps.googleapis.com/maps/api/js?key='), true);
});
