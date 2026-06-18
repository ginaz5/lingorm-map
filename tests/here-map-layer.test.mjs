import assert from 'node:assert/strict';
import test from 'node:test';

test('HERE base layer falls back when dark vector layer is unavailable', async () => {
  const { getHereBaseLayer } = await import('../src/map.js');
  const mapLayer = { name: 'map' };
  const layers = {
    vector: {
      normal: {
        map: mapLayer,
      },
    },
  };

  assert.equal(getHereBaseLayer(layers, 'dark'), mapLayer);
});

test('HERE base layer avoids legacy raster dark layer fallback', async () => {
  const { getHereBaseLayer } = await import('../src/map.js');
  const mapLayer = { name: 'map' };
  const mapnightLayer = { name: 'mapnight' };
  const layers = {
    vector: {
      normal: {
        map: mapLayer,
      },
    },
    raster: {
      normal: {
        mapnight: mapnightLayer,
      },
    },
  };

  assert.equal(getHereBaseLayer(layers, 'dark'), mapLayer);
});
