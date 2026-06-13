// Updated to check src/map.js for the Maps script URL (Option B modularisation)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('index loads Google Maps through runtime config instead of build placeholders', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.equal(html.includes('__GOOGLE_MAPS_KEY__'), false);
  assert.equal(html.includes('__GOOGLE_MAP_ID__'), false);

  // /api/config is fetched at runtime in src/map.js
  const mapJs = await readFile(new URL('../src/map.js', import.meta.url), 'utf8');
  assert.equal(mapJs.includes('/api/config'), true);
  assert.equal(mapJs.includes('maps.googleapis.com/maps/api/js?key='), true);
});
