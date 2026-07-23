// Updated for Option B modularisation: reads from src/render.js instead of index.html.
// Helper functions use state.data (via state object) instead of bare data variable.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { T } from '../src/i18n.js';

async function loadUiHelpers(deps) {
  const src = await readFile(new URL('../src/render.js', import.meta.url), 'utf8');
  const helperMatch = src.match(
    /(?:export\s+)?function rebuildSelect\(sel,\s*html\)\s*\{[\s\S]*$/
  );
  assert.ok(helperMatch, 'i18n/select helper block should exist in src/render.js');

  const code = helperMatch[0].replace(/\bexport\s+/g, '');
  return Function(
    'document',
    't',
    'state',
    'lang',
    'isPublicLocation',
    `${code}; return { rebuildSelect, updateLangUI, buildCatFilter };`,
  )(
    deps.document,
    deps.t,
    deps.state,
    deps.lang,
    deps.isPublicLocation ?? ((row) => row.status === 'Published'),
  );
}

function makeSelect(value = '') {
  return {
    value,
    innerHTML: '',
  };
}

test('updateLangUI updates text, HTML, and placeholders without status controls', async () => {
  const textEl = { dataset: { i18n: 'label' }, textContent: '' };
  const htmlEl = { dataset: { i18nHtml: 'markup' }, innerHTML: '' };
  const placeholderEl = { dataset: { i18nPh: 'hint' }, placeholder: '' };
  const langBtnLabel = { textContent: '' };
  const byId = new Map([
    ['lang-btn-label', langBtnLabel],
  ]);
  const { updateLangUI } = await loadUiHelpers({
    document: {
      querySelectorAll: (selector) => {
        assert.equal(selector, '[data-i18n],[data-i18n-html],[data-i18n-ph]');
        return [textEl, htmlEl, placeholderEl];
      },
      getElementById: (id) => byId.get(id),
    },
    t: (key) => ({
      label: 'Label',
      markup: '<strong>Markup</strong>',
      hint: 'Hint',
      lang_btn: 'Language',
    })[key],
    state: { data: [] },
    lang: 'en',
  });

  updateLangUI();

  assert.equal(textEl.textContent, 'Label');
  assert.equal(htmlEl.innerHTML, '<strong>Markup</strong>');
  assert.equal(placeholderEl.placeholder, 'Hint');
  assert.equal(langBtnLabel.textContent, 'Language');
});

test('search placeholders explain that names and notes are searchable', () => {
  assert.equal(T.zh.search_ph, '搜尋地點或內文關鍵字…');
  assert.equal(T.en.search_ph, 'Search names or notes…');
});

test('favorite storage notice is available in both supported languages', () => {
  assert.equal(
    T.zh.favorite_storage_notice,
    '收藏僅儲存在此瀏覽器，不會跨裝置同步；清除瀏覽資料後可能遺失。',
  );
  assert.equal(
    T.en.favorite_storage_notice,
    'Favorites stay in this browser only. They aren’t synced across devices and may be lost if browsing data is cleared.',
  );
});

test('buildCatFilter preserves the selected category while rebuilding options', async () => {
  const catFilter = makeSelect('Cafe');
  const { buildCatFilter } = await loadUiHelpers({
    document: {
      querySelectorAll: () => [],
      getElementById: (id) => {
        assert.equal(id, 'cat-filter');
        return catFilter;
      },
    },
    t: (key) => ({ all_cat: 'All Categories' })[key],
    state: {
      data: [
        { catEn: 'Cafe', catZh: '咖啡廳', status: 'Published' },
        { catEn: 'Hotel', catZh: '飯店', status: 'Published' },
        { catEn: 'Internal', catZh: '內部分類', status: 'Paused' },
      ],
    },
    lang: 'en',
  });

  buildCatFilter();

  assert.equal(catFilter.value, 'Cafe');
  assert.match(catFilter.innerHTML, /<option value="">All Categories<\/option>/);
  assert.match(catFilter.innerHTML, /<option value="Cafe">Cafe<\/option>/);
  assert.match(catFilter.innerHTML, /<option value="Hotel">Hotel<\/option>/);
  assert.doesNotMatch(catFilter.innerHTML, /Internal|內部分類/);
});

test('setLang normalizes unsupported stored languages to zh', async () => {
  let storedLanguage = '';
  globalThis.localStorage = {
    setItem(key, value) {
      assert.equal(key, 'lang');
      storedLanguage = value;
    },
  };

  try {
    const i18n = await import('../src/i18n.js?invalid-language-normalization');
    i18n.setLang('th');

    assert.equal(i18n.lang, 'zh');
    assert.equal(storedLanguage, 'zh');
  } finally {
    delete globalThis.localStorage;
  }
});
