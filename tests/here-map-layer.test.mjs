import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('HERE loads the supported 3.2 SDK and uses the HARP renderer', async () => {
  const source = await readFile(new URL('../src/map.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /js\.api\.here\.com\/v3\/3\.1/);
  assert.match(source, /js\.api\.here\.com\/v3\/3\.2\/mapsjs-core\.js/);
  assert.match(source, /createDefaultLayers\(\{[\s\S]*?engineType: H\.Map\.EngineType\.HARP,[\s\S]*?lg: mapLanguage,[\s\S]*?\}\)/);
  assert.match(source, /engineType: H\.Map\.EngineType\.HARP/);
});

test('getHereLanguagePreferences uses the primary language for map labels and the first supported locale for UI', async () => {
  const { getHereLanguagePreferences } = await import('../src/map.js');

  // zh-TW → map labels in Chinese, UI in zh-CN (closest supported locale)
  assert.deepEqual(
    getHereLanguagePreferences(['zh-TW', 'en-US']),
    { mapLanguage: 'zh', uiLocale: 'zh-CN' },
  );
  // th-TH → map labels in Thai, but Thai has no UI locale so falls through to en-US
  assert.deepEqual(
    getHereLanguagePreferences(['th-TH', 'en-US']),
    { mapLanguage: 'th', uiLocale: 'en-US' },
  );
  // A valid BCP 47 script subtag must not cause the map language to fall back.
  assert.deepEqual(
    getHereLanguagePreferences(['zh-Hant-TW']),
    { mapLanguage: 'zh', uiLocale: 'zh-CN' },
  );
});

test('getHereLanguagePreferences falls back to secondary locale when primary is unsupported', async () => {
  const { getHereLanguagePreferences } = await import('../src/map.js');

  // ja has no UI locale, so uiLocale falls through to the secondary fr-FR
  assert.deepEqual(
    getHereLanguagePreferences(['ja-JP', 'fr-FR']),
    { mapLanguage: 'ja', uiLocale: 'fr-FR' },
  );
});

test('getHereLanguagePreferences handles pt-BR specially', async () => {
  const { getHereLanguagePreferences } = await import('../src/map.js');

  assert.deepEqual(
    getHereLanguagePreferences(['pt-BR']),
    { mapLanguage: 'pt', uiLocale: 'pt-BR' },
  );
  // Plain pt (no region) maps to pt-PT, not pt-BR
  assert.deepEqual(
    getHereLanguagePreferences(['pt']),
    { mapLanguage: 'pt', uiLocale: 'pt-PT' },
  );
});

test('getHereLanguagePreferences defaults to en / en-US for empty input', async () => {
  const { getHereLanguagePreferences } = await import('../src/map.js');

  assert.deepEqual(
    getHereLanguagePreferences([]),
    { mapLanguage: 'en', uiLocale: 'en-US' },
  );
});

test('getHereLanguagePreferences does not pass unsupported locales to the HERE UI', async () => {
  const { getHereLanguagePreferences } = await import('../src/map.js');

  assert.deepEqual(
    getHereLanguagePreferences(['sv-SE', 'de-DE']),
    { mapLanguage: 'sv', uiLocale: 'de-DE' },
  );
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
