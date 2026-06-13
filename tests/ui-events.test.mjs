import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadIndexHtml() {
  return readFile(new URL('../index.html', import.meta.url), 'utf8');
}

async function loadSwitchTab(deps) {
  const html = await loadIndexHtml();
  const switchMatch = html.match(/function switchTab\(tab\)\{[\s\S]*?\n\}/);
  assert.ok(switchMatch, 'switchTab function should exist');

  return Function(
    'document',
    'map',
    'google',
    `${switchMatch[0]}; return { switchTab };`,
  )(deps.document, deps.map, deps.google);
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
  const html = await loadIndexHtml();
  const staticMarkup = html.split('<script>')[0];

  assert.match(staticMarkup, /id="add-btn"/);
  assert.equal(/\son(?:click|keydown)=/i.test(staticMarkup), false);
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
    map: {},
    google: { maps: { event: { trigger: () => { resizeCount += 1; } } } },
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
