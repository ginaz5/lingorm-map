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

test('map clusters keep explicit contrast in dark mode', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /:root\[data-theme="dark"\][\s\S]*--marker-bg:\s*#2563eb/);
  assert.match(css, /:root\[data-theme="dark"\][\s\S]*--marker-fg:\s*#ffffff/);
  assert.match(css, /\.marker-cluster\{[^}]*background:var\(--marker-bg\);color:var\(--marker-fg\)/);
  assert.doesNotMatch(css, /\.marker-cluster\{[^}]*background:var\(--primary\)/);
});
