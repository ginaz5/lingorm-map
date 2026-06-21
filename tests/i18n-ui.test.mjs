// Updated for Option B modularisation: reads from src/render.js instead of index.html.
// Helper functions use state.data (via state object) instead of bare data variable.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadUiHelpers(deps) {
  const src = await readFile(new URL('../src/render.js', import.meta.url), 'utf8');
  // Capture from rebuildSelect through everything up to (but not including) buildCatDropdown
  const helperMatch = src.match(
    /(?:export\s+)?function rebuildSelect\(sel,\s*html\)\s*\{[\s\S]*?(?=\n(?:export\s+)?function buildCatDropdown\(\))/
  );
  assert.ok(helperMatch, 'i18n/select helper block should exist in src/render.js');

  const code = helperMatch[0].replace(/\bexport\s+/g, '');
  return Function(
    'document',
    't',
    'state',
    'lang',
    `${code}; return { rebuildSelect, updateLangUI, buildStatusFilter, buildCatFilter };`,
  )(deps.document, deps.t, deps.state, deps.lang);
}

function makeSelect(value = '') {
  return {
    value,
    innerHTML: '',
  };
}

test('updateLangUI updates text, HTML, placeholders, and status options in one pass', async () => {
  const textEl = { dataset: { i18n: 'label' }, textContent: '' };
  const htmlEl = { dataset: { i18nHtml: 'markup' }, innerHTML: '' };
  const placeholderEl = { dataset: { i18nPh: 'hint' }, placeholder: '' };
  const langBtnLabel = { textContent: '' };
  const statusFilter = makeSelect('Needs Review');
  const byId = new Map([
    ['lang-btn-label', langBtnLabel],
    ['status-filter', statusFilter],
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
      all_status: 'All Statuses',
      status: { Verified: 'Verified', 'Needs Review': 'Needs Review' },
    })[key],
    state: { data: [] },
    lang: 'en',
  });

  updateLangUI();

  assert.equal(textEl.textContent, 'Label');
  assert.equal(htmlEl.innerHTML, '<strong>Markup</strong>');
  assert.equal(placeholderEl.placeholder, 'Hint');
  assert.equal(langBtnLabel.textContent, 'Language');
  assert.equal(statusFilter.value, 'Needs Review');
  assert.match(statusFilter.innerHTML, /<option value="">All Statuses<\/option>/);
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
        { catEn: 'Cafe', catZh: '咖啡廳' },
        { catEn: 'Hotel', catZh: '飯店' },
      ],
    },
    lang: 'en',
  });

  buildCatFilter();

  assert.equal(catFilter.value, 'Cafe');
  assert.match(catFilter.innerHTML, /<option value="">All Categories<\/option>/);
  assert.match(catFilter.innerHTML, /<option value="Cafe">Cafe<\/option>/);
  assert.match(catFilter.innerHTML, /<option value="Hotel">Hotel<\/option>/);
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
