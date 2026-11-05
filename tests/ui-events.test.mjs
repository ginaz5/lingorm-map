// Map-first layout: the header and mobile tab bar are replaced by a floating
// search bar, a side menu <dialog>, and a bottom sheet / side panel.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('static HTML controls are wired without inline event attributes', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const menuMatch = html.match(/<dialog class="side-menu"[\s\S]*?<\/dialog>/);
  const appMatch = html.match(/<main class="app-body"[\s\S]*?<\/main>/);
  assert.ok(menuMatch, 'side menu markup should exist');
  assert.ok(appMatch, 'app body markup should exist');
  const menu = menuMatch[0];
  const app = appMatch[0];

  assert.doesNotMatch(html, /id="add-btn"/);
  assert.doesNotMatch(html, /<header>|class="tab-bar"|id="mobile-actions-btn"/);
  for (const id of ['home-btn', 'lang-btn', 'theme-btn', 'fan-resources-btn', 'changelog-btn', 'issue-btn', 'install-btn']) {
    assert.match(menu, new RegExp(`id="${id}"`), id);
  }
  assert.match(menu, /class="theme-icon-sun"/);
  assert.match(menu, /class="theme-icon-moon"/);
  assert.match(app, /id="menu-btn"[^>]*aria-controls="side-menu"/);
  assert.match(app, /id="locate-btn"[\s\S]*?class="locate-icon"[\s\S]*?M12 8c-2\.21 0-4 1\.79-4 4/);
  assert.match(app, /id="locate-btn"[^>]*data-i18n-aria="locate_btn_label"/);
  for (const markup of [menu, app]) {
    assert.doesNotMatch(markup, /☀️|🌙/);
    assert.equal(/\son(?:click|keydown|input|change)=/i.test(markup), false);
  }
});

test('search and select filters use module listeners instead of inline analytics wiring', async () => {
  const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

  assert.match(mainSrc, /const searchInput = [^;]*getElementById\('search'\)/);
  assert.match(mainSrc, /searchInput\.addEventListener\('input'/);
  assert.match(mainSrc, /trackSearchComplete\(queryLength, state\.visIdx\.length\)/);
  assert.doesNotMatch(mainSrc, /const resultCount = state\.visIdx\.length/);
  assert.match(mainSrc, /}, 700\)/);
  assert.match(mainSrc, /getElementById\('cat-filter'\)\.addEventListener\('change'/);
  assert.match(mainSrc, /getElementById\('label-filter'\)\.addEventListener\('change'/);
});

test('collection guide exposes accessible static markup', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /id="label-filter"[^>]*data-i18n-aria="label_filter"/);
  assert.match(html, /id="label-info-btn"[^>]*aria-expanded="false"[^>]*aria-haspopup="dialog"[^>]*aria-controls="label-info-popover"/);
  assert.match(html, /id="label-info-popover"[^>]*role="dialog"[^>]*aria-labelledby="label-info-title"[^>]*hidden/);
  assert.match(html, /data-i18n="collection_info_lingorm"/);
  assert.match(html, /data-i18n="collection_info_jkr_picks"/);
  assert.match(html, /data-i18n="collection_info_jkr_projects"/);
  assert.match(html, /data-i18n="collection_info_admin"/);
});

test('side menu orders settings before secondary pages and closes before opening dialogs', async () => {
  const [html, mainSrc] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  ]);
  const menu = html.match(/<nav class="side-menu-list"[\s\S]*?<\/nav>/)?.[0] ?? '';
  const order = ['lang-btn', 'theme-btn', 'fan-resources-btn', 'changelog-btn', 'issue-btn', 'install-btn']
    .map(id => menu.indexOf(`id="${id}"`));
  assert.ok(order.every(index => index >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(menu, /id="changelog-btn" href="\.\/changelog\.html"/);
  // Dialog entries close the menu first so focus moves to the new dialog.
  assert.match(mainSrc, /sideMenu\.closeThen\(openIssueModal\)/);
  assert.match(mainSrc, /sideMenu\.closeThen\(open\)/);
  assert.doesNotMatch(mainSrc, /data-mobile-action|switchTab|tab-map|tab-list/);
});
