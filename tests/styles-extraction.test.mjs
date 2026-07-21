import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('index loads app styles from an external stylesheet', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(html, /<link rel="stylesheet" href="\.\/styles\.css"\/?>/);
  assert.equal(html.includes('<style>'), false);
  assert.match(css, /\.loc-card\{/);
});

test('index does not keep presentational inline style hooks', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const appMarkup = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');

  assert.equal(appMarkup.includes(' style='), false);
  assert.equal(appMarkup.includes('.style.cssText'), false);
  assert.equal(appMarkup.includes('.style.display'), false);
});

test('unused map-link and Leaflet styles are not kept', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.equal(css.includes('card-maplink'), false);
  assert.equal(css.includes('leaflet-popup'), false);
});

test('map markers keep their light style and use coral with contrast in dark mode', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /:root\s*\{[\s\S]*--marker-bg:\s*#111111/);
  assert.match(css, /:root\[data-theme="dark"\][\s\S]*--marker-bg:\s*#ff6b35/);
  assert.match(css, /--marker-fg:\s*#ffffff/);
  assert.match(css, /--marker-ring:\s*#ffffff/);
  assert.match(css, /\.marker-cluster\{[^}]*background:var\(--marker-bg\);color:var\(--marker-fg\)/);
  assert.match(css, /\.marker-cluster\{[^}]*border:2px solid var\(--marker-ring\);box-shadow:0 4px 12px rgba\(0,0,0,\.4\)/);
  assert.match(css, /\.marker-dot\.active\{[^}]*0 0 15px rgba\(255,255,255,\.6\)/);
  assert.doesNotMatch(css, /\.marker-cluster\{[^}]*background:var\(--primary\)/);
});
