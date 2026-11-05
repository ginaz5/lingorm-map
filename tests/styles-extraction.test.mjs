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

test('provider popups are retired in favour of the place detail panel', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  for (const token of ['.gm-style-iw', '.H_ib_', '.popup-content', '.popup-badges', '.tab-bar', '.mobile-actions']) {
    assert.equal(css.includes(token), false, token);
  }
  assert.match(css, /\.place-badges\{margin-top:10px\}/);
  assert.match(css, /\.badge\{\s*font-size:11px;font-weight:500;\s*padding:3px 8px;/);
});

test('map attribution stays uncovered by the floating panels', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  // Desktop: the map starts beside the open side panel, full width when collapsed.
  assert.match(css, /@media\(min-width:701px\)\{[\s\S]*?#map-wrap\{left:var\(--panel-w\)\}/);
  assert.match(css, /\[data-panel="collapsed"\] #map-wrap\{left:0\}/);
  // Mobile: the map ends where the peek sheet begins.
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*?#map-wrap\{bottom:var\(--sheet-peek\)\}/);
  assert.match(css, /--sheet-peek: 112px;/);
});

test('result metadata keeps the update date visible and wraps at narrow viewports', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /\.result-meta\{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;padding:4px 16px 8px;flex-shrink:0\}/,
  );
  assert.match(css, /\.last-updated\{font-size:12px;color:var\(--text-muted\)\}/);
  assert.match(
    css,
    /\.last-updated:not\(:empty\)::before\{content:"·";margin-right:6px;/,
  );
  assert.doesNotMatch(css, /\.result-meta\{[^}]*flex-direction:/);
  assert.doesNotMatch(css, /\.last-updated\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(css, /@media\(min-width:1100px\)[\s\S]*?\.result-meta/);
});

test('location card favorite heart is visible at every viewport; nav/maps buttons stay mobile-only', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /\.card-footer\{display:flex;align-items:center;justify-content:flex-end;margin-top:8px\}/,
  );
  assert.match(
    css,
    /\.card-footer \.popup-nav-btn,\.card-footer \.popup-maps-btn\{display:none\}/,
  );
  assert.match(
    css,
    /@media\(max-width:700px\)\{\s*\.card-footer \.popup-nav-btn,\.card-footer \.popup-maps-btn\{display:inline-flex\}/,
  );
  assert.doesNotMatch(css, /\.popup-footer\{[^}]*display:none/);
});

test('unused map-link and Leaflet styles are not kept', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.equal(css.includes('card-maplink'), false);
  assert.equal(css.includes('leaflet-popup'), false);
});

test('map markers are black in light mode and light-neutral in dark mode', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /:root\s*\{[\s\S]*--marker-bg:\s*#111111/);
  // Not coral/orange in dark mode: that read as SuperRich 1965 orange.
  assert.match(css, /:root\[data-theme="dark"\][\s\S]*--marker-bg:\s*#f4f4f5;\s*--marker-fg:\s*#111214;\s*--marker-ring:\s*#111214;/);
  assert.doesNotMatch(css, /--marker-bg:\s*#ff6b35/);
  assert.match(css, /--marker-fg:\s*#ffffff/);
  assert.match(css, /--marker-ring:\s*#ffffff/);
  assert.match(css, /\.marker-cluster\{[^}]*background:var\(--marker-bg\);color:var\(--marker-fg\)/);
  assert.match(css, /\.marker-cluster\{[^}]*border:2px solid var\(--marker-ring\);box-shadow:0 4px 12px rgba\(0,0,0,\.4\)/);
  assert.match(css, /\.marker-dot\.active\{[^}]*0 0 15px rgba\(255,255,255,\.6\)/);
  assert.doesNotMatch(css, /\.marker-cluster\{[^}]*background:var\(--primary\)/);
});

test('all-exchange clusters reuse the single-marker green variant (Phase D2)', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /\.marker-cluster\.is-exchange\{--marker-bg:#16835b;--marker-fg:#fff;--marker-ring:#b7f0d7\}/,
  );
  assert.match(
    css,
    /\.marker-dot\.is-exchange\{--marker-bg:#16835b;--marker-fg:#fff;--marker-ring:#b7f0d7\}/,
  );
});

test('light mode cards have scoped accessible contrast styles', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const lightSection = css.match(/\/\* Light mode card contrast \*\/([\s\S]*?)\/\* User location blue dot \*\//)?.[1];

  assert.ok(lightSection);
  assert.match(lightSection, /:root:not\(\[data-theme="dark"\]\) \.loc-card\{\s*background:#fff;border-color:rgba\(0,0,0,\.12\)/);
  assert.match(lightSection, /box-shadow:0 10px 25px -5px rgba\(0,0,0,\.12\),0 8px 10px -6px rgba\(0,0,0,\.08\)/);
  assert.match(lightSection, /\.place-name\{color:#111827\}/);
  assert.match(lightSection, /\.place-alt,\s*:root:not\(\[data-theme="dark"\]\) \.place-notes\{color:#374151\}/);
  assert.match(lightSection, /\.place-content \.approx-tag\{color:#4b5563;font-weight:500\}/);
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

test('place detail, list card, and fan resource descriptions share the left-rule style', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  for (const cls of ['place-notes', 'card-notes', 'fan-resource-description']) {
    assert.match(css, new RegExp(`\\.${cls}\\{[^}]*white-space:pre-line`));
    assert.match(css, new RegExp(`\\.${cls}\\{[^}]*padding:0 0 0 10px;\\s*border-left:3px solid var\\(--border\\)`));
    assert.doesNotMatch(css, new RegExp(`\\.${cls}\\{[^}]*background:`));
  }
  for (const cls of ['place-notes', 'card-notes']) {
    assert.match(css, new RegExp(`\\.${cls}:empty\\{display:none\\}`));
  }
  // flex:1 would stretch the fan resource rule into the empty space above the footer.
  assert.match(css, /\.fan-resource-description\{[^}]*margin-bottom:auto/);
  assert.doesNotMatch(css, /\.fan-resource-description\{[^}]*flex:1/);
  assert.match(css, /\.card-notes\{[^}]*-webkit-line-clamp:2/);
});

test('dark-mode place markers stay distinguishable from the orange SuperRich 1965 markers', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const dark = css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const markerBg = dark.match(/--marker-bg: (#[0-9a-f]{6});/i)?.[1];
  const orange = css.match(/\.marker-dot\.is-exchange-orange,\.marker-cluster\.is-exchange-orange\{--marker-bg:(#[0-9a-f]{6})/i)?.[1];
  const green = css.match(/\.marker-dot\.is-exchange\{--marker-bg:(#[0-9a-f]{6})/i)?.[1];
  assert.ok(markerBg && orange && green);
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const distance = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
  // Light mode uses #111111 vs #eb7923 (distance ≈ 280); keep dark mode as far apart.
  assert.ok(distance(markerBg, orange) > 200, `dark marker ${markerBg} too close to orange ${orange}`);
  assert.ok(distance(markerBg, green) > 200, `dark marker ${markerBg} too close to green ${green}`);
  assert.match(css, /:root\[data-theme="dark"\] \.b-exchange\.is-exchange-orange\{[^}]*color:#ffad70/);
});
