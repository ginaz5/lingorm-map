// Updated for Option B modularisation:
//   - switchTab extracted from src/ui/ui.js (uses state.map instead of bare map)
//   - static markup check: split on /<script\b[^>]*>/ to handle <script type="module">
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadSwitchTab(deps) {
  const src = await readFile(new URL('../src/ui/ui.js', import.meta.url), 'utf8');
  const switchMatch = src.match(/(?:export\s+)?function switchTab\(tab\)\s*\{[\s\S]*?\n\}/);
  assert.ok(switchMatch, 'switchTab function should exist in src/ui/ui.js');

  const code = switchMatch[0].replace(/\bexport\s+/g, '');
  return Function(
    'document',
    'state',
    'requiredElement',
    `${code}; return { switchTab };`,
  )(
    deps.document,
    deps.state,
    (id) => {
      const el = deps.document.getElementById(id);
      if (!el) throw new Error(`Missing required element #${id}`);
      return el;
    },
  );
}

function makeElement() {
  const attrs = {};
  const classToggles = [];
  return {
    attrs,
    classToggles,
    setAttribute: (name, value) => { attrs[name] = value; },
    classList: {
      toggle: (name, value) => { classToggles.push([name, value]); },
    },
  };
}

test('static HTML controls are wired without inline event attributes', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const headerMatch = html.match(/<header>[\s\S]*?<\/header>/);
  assert.ok(headerMatch, 'header markup should exist');
  const staticMarkup = headerMatch[0];

  assert.doesNotMatch(staticMarkup, /id="add-btn"/);
  assert.match(staticMarkup, /id="issue-btn"/);
  assert.match(staticMarkup, /id="locate-btn"[\s\S]*?class="locate-icon"[\s\S]*?M12 8c-2\.21 0-4 1\.79-4 4/);
  assert.match(staticMarkup, /id="changelog-btn"/);
  assert.match(staticMarkup, /id="theme-btn"/);
  assert.match(staticMarkup, /class="theme-icon-sun"/);
  assert.match(staticMarkup, /class="theme-icon-moon"/);
  assert.doesNotMatch(staticMarkup, /☀️|🌙/);
  assert.equal(/\son(?:click|keydown)=/i.test(staticMarkup), false);
});

test('mobile header keeps locate, language, and theme visible while secondary actions use overflow', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const menuMatch = html.match(/id="mobile-actions-menu"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(menuMatch, 'mobile overflow menu should exist');
  const menuMarkup = menuMatch[0];

  assert.match(html, /id="mobile-actions-btn"/);
  assert.match(html, /id="mobile-actions-menu"/);
  assert.match(menuMarkup, /href="\.\/changelog\.html"/);
  assert.match(menuMarkup, /data-mobile-action="issue"/);
  assert.doesNotMatch(menuMarkup, /data-mobile-action="locate"/);
  assert.doesNotMatch(menuMarkup, /data-mobile-action="lang"/);
  assert.doesNotMatch(menuMarkup, /data-mobile-action="theme"/);
  assert.match(html, /id="locate-btn"[^>]*data-i18n-aria="locate_btn_label"/);
  assert.ok(
    menuMarkup.indexOf('href="./changelog.html"') < menuMarkup.indexOf('data-mobile-action="issue"'),
    'changelog should be the first overflow action',
  );
  assert.match(styles, /#locate-btn,#lang-btn,#theme-btn\{display:flex/);
  assert.match(styles, /#locate-btn>\[data-i18n="locate_btn_label"\]/);
  assert.match(mainSrc, /mobile-actions-btn/);
  assert.match(mainSrc, /data-mobile-action/);
  assert.doesNotMatch(mainSrc, /action === 'locate'/);
});

test('switchTab keeps panel and map visibility states aligned', async () => {
  const elements = {
    panel: makeElement(),
    'map-wrap': makeElement(),
    'tab-map': makeElement(),
    'tab-list': makeElement(),
  };
  let resizeCount = 0;
  const { switchTab } = await loadSwitchTab({
    document: { getElementById: (id) => elements[id] },
    state: {
      map: {
        getViewPort: () => ({
          resize: () => { resizeCount += 1; },
        }),
      },
    },
  });

  switchTab('map');
  assert.equal(elements.panel.attrs['data-mobile-tab'], 'map');
  assert.equal(elements['map-wrap'].attrs['data-mobile-tab'], 'map');
  assert.deepEqual(elements['tab-map'].classToggles.at(-1), ['active', true]);
  assert.deepEqual(elements['tab-list'].classToggles.at(-1), ['active', false]);
  assert.equal(resizeCount, 1);

  switchTab('list');
  assert.equal(elements.panel.attrs['data-mobile-tab'], 'list');
  assert.equal(elements['map-wrap'].attrs['data-mobile-tab'], 'list');
  assert.deepEqual(elements['tab-map'].classToggles.at(-1), ['active', false]);
  assert.deepEqual(elements['tab-list'].classToggles.at(-1), ['active', true]);
  assert.equal(resizeCount, 1);
});
