import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('HERE loads the supported 3.2 SDK and uses the HARP renderer', async () => {
  const source = await readFile(new URL('../src/map.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /js\.api\.here\.com\/v3\/3\.1/);
  assert.match(source, /js\.api\.here\.com\/v3\/3\.2\/mapsjs-core\.js/);
  assert.match(source, /createDefaultLayers\(\{ engineType: H\.Map\.EngineType\.HARP \}\)/);
  assert.match(source, /engineType: H\.Map\.EngineType\.HARP/);
});

test('HERE uses matching raster day and night layers when available', async () => {
  const { getHereBaseLayer } = await import('../src/map.js');
  const vectorDay = { name: 'vector-day' };
  const vectorNight = { name: 'vector-night' };
  const rasterDay = { name: 'raster-day' };
  const rasterNight = { name: 'raster-night' };
  const layers = {
    vector: {
      normal: {
        map: vectorDay,
        mapnight: vectorNight,
      },
    },
    raster: {
      normal: {
        map: rasterDay,
        mapnight: rasterNight,
      },
    },
  };

  assert.equal(getHereBaseLayer(layers, 'dark'), rasterNight);
  assert.equal(getHereBaseLayer(layers, 'light'), rasterDay);
});

test('HERE falls back to matching vector layers when raster is unavailable', async () => {
  const { getHereBaseLayer } = await import('../src/map.js');
  const mapLayer = { name: 'vector-day' };
  const mapnightLayer = { name: 'vector-night' };
  const layers = {
    vector: {
      normal: {
        map: mapLayer,
        mapnight: mapnightLayer,
      },
    },
  };

  assert.equal(getHereBaseLayer(layers, 'dark'), mapnightLayer);
  assert.equal(getHereBaseLayer(layers, 'light'), mapLayer);
});

test('Google map color scheme follows the selected theme', async () => {
  const { getGoogleColorScheme } = await import('../src/map.js');

  assert.equal(getGoogleColorScheme('light'), 'LIGHT');
  assert.equal(getGoogleColorScheme('dark'), 'DARK');
});
