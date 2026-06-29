import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadOpenInGoogleMaps(deps) {
  const source = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
  const match = source.match(/(?:export\s+)?function openInGoogleMaps\(i\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'openInGoogleMaps function should exist in src/ui.js');

  const code = match[0].replace(/\bexport\s+/g, '');
  return Function('state', 'window', `${code}; return { openInGoogleMaps };`)(
    deps.state,
    deps.window,
  );
}

test('index UI does not render Google Maps open links', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.equal(html.includes('popup-maplink'), false);
  assert.equal(html.includes("${t('maps')}"), false);
});

test('Google Maps navigation reads the parsed maps field', async () => {
  const source = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /\brow\.mapsQuery\b/);
  assert.match(source, /\brow\.maps\b/);
});

test('Google Maps navigation opens parsed URLs directly', async () => {
  const opened = [];
  const { openInGoogleMaps } = await loadOpenInGoogleMaps({
    state: {
      data: [
        { maps: 'https://maps.app.goo.gl/abc', lat: '13.7608', lng: '100.5089' },
        { maps: 'The Siam Bangkok', lat: '13.7608', lng: '100.5089' },
      ],
    },
    window: {
      open: (url, target) => opened.push([url, target]),
    },
  });

  openInGoogleMaps(0);
  openInGoogleMaps(1);

  assert.deepEqual(opened, [
    ['https://maps.app.goo.gl/abc', '_blank'],
    ['https://www.google.com/maps/search/?api=1&query=The%20Siam%20Bangkok', '_blank'],
  ]);
});
