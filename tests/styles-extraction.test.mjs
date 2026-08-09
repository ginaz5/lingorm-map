import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('index loads app styles from an external stylesheet', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(html, /<link rel="stylesheet" href="\.\/styles\.css"\/?>/);
  assert.equal(html.includes('<style>'), false);
  assert.match(css, /\.loc-card\{/);
  assert.match(css, /\.btn-ghost\s*\{\s*font-family:\s*inherit;/);
});

test('index does not keep presentational inline style hooks', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const appMarkup = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');

  assert.equal(appMarkup.includes(' style='), false);
  assert.equal(appMarkup.includes('.style.cssText'), false);
  assert.equal(appMarkup.includes('.style.display'), false);
});

test('HERE popup body stays centered above its map anchor', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /#map \.H_ib_body\{left:0!important;right:auto!important;transform:translateX\(-50%\)\}/,
  );
  assert.match(
    css,
    /@media\(max-width:700px\)\{[\s\S]*?\.H_ib_body\{max-width:calc\(100vw - 32px\)!important\}/,
  );
});

test('popup badges use compact spacing without changing list badges', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.popup-badges\{margin-top:4px;margin-bottom:6px\}/);
  assert.match(css, /\.popup-badges \.badge\{padding:2px 7px;line-height:1\.2\}/);
  assert.match(css, /\.badge\{\s*font-size:11px;font-weight:500;\s*padding:3px 8px;/);
});

test('result metadata uses the same inline spacing at every viewport', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /\.result-meta\{display:flex;align-items:baseline;gap:6px;padding:0 2px\}/,
  );
  assert.match(css, /\.last-updated\{font-size:12px;color:var\(--text-muted\)\}/);
  assert.match(
    css,
    /\.last-updated:not\(:empty\)::before\{content:"·";margin-right:6px;/,
  );
  assert.doesNotMatch(css, /\.result-meta\{[^}]*flex-direction:/);
  assert.doesNotMatch(css, /@media\(min-width:1100px\)[\s\S]*?\.result-meta/);
});

test('location card actions are visible only at the mobile breakpoint', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /\.card-footer\{display:none;align-items:center;justify-content:flex-end;margin-top:8px\}/,
  );
  assert.match(
    css,
    /@media\(max-width:700px\)\{\s*\.card-footer\{display:flex\}/,
  );
  assert.doesNotMatch(css, /\.popup-footer\{[^}]*display:none/);
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

test('light mode cards have scoped accessible contrast styles', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const lightSection = css.match(/\/\* Light mode card contrast \*\/([\s\S]*?)\/\* User location blue dot \*\//)?.[1];

  assert.ok(lightSection);
  assert.match(lightSection, /:root:not\(\[data-theme="dark"\]\) \.gm-style \.gm-style-iw-c/);
  assert.match(lightSection, /border:1px solid rgba\(0,0,0,\.12\)/);
  assert.match(lightSection, /box-shadow:0 10px 25px -5px rgba\(0,0,0,\.12\),0 8px 10px -6px rgba\(0,0,0,\.08\)/);
  assert.match(lightSection, /\.popup-content\{\s*color:#111827;\s*font-family:'Inter'/);
  assert.match(lightSection, /\.popup-content \.popup-name\{\s*color:#111827;font-weight:600/);
  assert.match(lightSection, /\.popup-content \.popup-notes\{color:#374151\}/);
  assert.match(lightSection, /\.popup-content \.approx-tag\{color:#4b5563;font-weight:500\}/);
  assert.match(lightSection, /\.popup-content \.src-tag\{font-family:inherit!important\}/);
  assert.match(lightSection, /background:#e0f2fe;color:#0369a1;font-weight:600/);
  assert.doesNotMatch(lightSection, /:root\[data-theme="dark"\]/);
});

test('favorite buttons avoid a black flash while becoming active', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.fav-btn\{[^}]*-webkit-tap-highlight-color:transparent/);
  assert.match(css, /\.fav-btn:focus\{outline:none\}/);
  assert.match(css, /\.fav-btn:focus-visible\{outline:2px solid #e05252;outline-offset:2px\}/);
  assert.match(css, /\.fav-filter-btn\{[^}]*-webkit-tap-highlight-color:transparent/);
  assert.match(css, /\.fav-filter-btn:focus\{outline:none\}/);
  assert.match(css, /\.fav-filter-btn:focus-visible\{outline:2px solid #e05252;outline-offset:2px\}/);
  assert.match(css, /\.fav-filter-btn:hover,\s*\.fav-filter-btn:active\{border-color:#fca5a5;color:#e05252\}/);
  assert.doesNotMatch(css, /\.fav-filter-btn\{[^}]*transition:all/);
  assert.doesNotMatch(css, /\.fav-filter-btn:hover\{[^}]*color:var\(--primary\)/);
  assert.match(css, /\.fav-btn:not\(\.fav-active\):hover\{color:#e05252\}/);
  assert.match(css, /\.fav-btn:not\(\.fav-active\):hover svg\{stroke:#e05252\}/);
  assert.doesNotMatch(css, /\.fav-btn:not\(\.fav-active\):hover(?: svg)?\{[^}]*#111827/);
});
