// Updated for Option B modularisation:
//   - switchTab extracted from src/ui.js (uses state.map instead of bare map)
//   - static markup check: split on /<script\b[^>]*>/ to handle <script type="module">
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadSwitchTab(deps) {
  const src = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
  const switchMatch = src.match(/(?:export\s+)?function switchTab\(tab\)\s*\{[\s\S]*?\n\}/);
  assert.ok(switchMatch, 'switchTab function should exist in src/ui.js');

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
  assert.match(staticMarkup, /id="theme-btn"/);
  assert.match(staticMarkup, /class="theme-icon-sun"/);
  assert.match(staticMarkup, /class="theme-icon-moon"/);
  assert.doesNotMatch(staticMarkup, /☀️|🌙/);
  assert.equal(/\son(?:click|keydown)=/i.test(staticMarkup), false);
});

test('mobile header exposes secondary actions through an overflow menu', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

  assert.match(html, /id="mobile-actions-btn"/);
  assert.match(html, /id="mobile-actions-menu"/);
  assert.match(html, /data-mobile-action="issue"/);
  assert.match(html, /data-mobile-action="locate"/);
  assert.match(html, /data-mobile-action="lang"/);
  assert.match(html, /data-mobile-action="theme"/);
  assert.match(mainSrc, /mobile-actions-btn/);
  assert.match(mainSrc, /data-mobile-action/);
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
