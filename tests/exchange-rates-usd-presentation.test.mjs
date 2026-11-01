import assert from 'node:assert/strict';
import test from 'node:test';

import MAPPING from '../data/superrich-branches.json' with { type: 'json' };
import { state } from '../src/core/state.js';
import { lang, setLang } from '../src/core/i18n.js';
import {
  canCombineGreenUsd,
  expireExchangeRates,
  shouldCombineGreenUsdSort,
  syncExchangeControls,
} from '../src/features/exchange-rates.js';
import { buildPopupContent, renderExchangeRates, renderList, sortVisibleIndexes } from '../src/ui/render.js';
import { refreshActivePopup } from '../src/map/map.js';

const slugs = Object.keys(MAPPING.branches);
const cell = (denom, value, displayDecimals = 2) => ({
  denom, rateScaledE6: value, displayDecimals: value === null ? null : displayDecimals,
  unavailableReason: value === null ? 'missing' : null,
});
const quote = (hundred = 33_000_000, fifty = hundred) => ({ rates: {
  USD_100: cell('USD_100', hundred), USD_50: cell('USD_50', fifty), TWD: cell('TWD', 995_000, 5),
} });

function setup(t) {
  const previousState = { ...state };
  const previousLanguage = lang;
  const options = [];
  const makeOption = value => ({
    value, disabled: false, textContent: '', dataset: {},
    remove() { options.splice(options.indexOf(this), 1); },
    after(option) { options.splice(options.indexOf(this) + 1, 0, option); },
  });
  options.push(...['default', 'USD_100', 'USD_50', 'TWD', 'USD_1965', 'TWD_1965'].map(makeOption));
  const elements = {
    'exchange-sort': { value: 'default', options },
    'exchange-sort-label': { hidden: false }, 'exchange-sort-hint': { hidden: false },
    'loc-list': { innerHTML: '' },
  };
  const globals = {
    document: { getElementById: id => elements[id] ?? null, createElement: () => makeOption('') },
    localStorage: { setItem() {} },
  };
  const previousGlobals = Object.fromEntries(Object.keys(globals).map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  setLang('zh');
  Object.assign(state, {
    data: slugs.slice(0, 3).map((id, index) => ({
      id, nameEn: `Branch ${index}`, nameZh: `分店 ${index}`, notesEn: '', notesZh: '',
      catEn: '', catZh: '', icon: '💱', type: 'Currency Exchange', status: 'Published',
    })),
    visIdx: [0, 1, 2], favorites: new Set(), isLoading: false, activeIdx: -1,
    exchangeSort: 'default', exchangeRatesEnabled: true, exchangeHasUsableSnapshot: true,
    exchangeRatesLoading: false, exchangeCompletedAt: '2026-11-01T01:00:00.000Z',
    exchangeRatesBySlug: { [slugs[0]]: quote(33_000_000), [slugs[1]]: quote(32_000_000), [slugs[2]]: quote(null) },
    exchange1965Branches: {}, provider: null,
  });
  t.after(() => {
    Object.assign(state, previousState);
    setLang(previousLanguage);
    for (const [key, descriptor] of Object.entries(previousGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { elements, options, option: value => options.find(option => option.value === value) };
}

test('equal USD quotes share one row without changing either source cell', t => {
  setup(t);
  const original = structuredClone(state.exchangeRatesBySlug);
  // Different source precision still represents the same exact integer rate.
  state.exchangeRatesBySlug[slugs[0]].rates.USD_50.displayDecimals = 3;
  state.exchangeSort = 'USD_50';
  const html = renderExchangeRates(state.data[0]);
  assert.match(html, /<span class="fx-denom">USD 50\/100<\/span>/);
  assert.equal((html.match(/class="fx-rate-row"/g) || []).length, 2);
  assert.equal((html.match(/class="fx-best"/g) || []).length, 1);
  assert.match(html, /1 USD = 33\.00 THB/);
  assert.equal(state.exchangeRatesBySlug[slugs[0]].rates.USD_50.displayDecimals, 3);
  assert.deepEqual(state.exchangeRatesBySlug[slugs[1]], original[slugs[1]]);
  assert.equal(state.exchangeRatesBySlug[slugs[0]].rates.USD_100.rateScaledE6, original[slugs[0]].rates.USD_100.rateScaledE6);
});

for (const [name, hundred, fifty] of [
  ['different rates', 33_000_000, 32_000_000],
  ['differences hidden by display rounding', 33_000_001, 33_000_002],
  ['missing USD 50', 33_000_000, null],
  ['missing USD 100', null, 33_000_000],
  ['both missing', null, null],
]) {
  test(`${name} retain separate USD rows`, t => {
    setup(t);
    state.exchangeRatesBySlug[slugs[0]] = quote(hundred, fifty);
    assert.equal(canCombineGreenUsd(slugs[0]), false);
    const html = renderExchangeRates(state.data[0]);
    assert.equal((html.match(/class="fx-rate-row"/g) || []).length, 3);
    assert.match(html, />USD 100<\/span>/);
    assert.match(html, />USD 50<\/span>/);
    assert.doesNotMatch(html, /USD 50\/100/);
    assert.equal((html.match(/暫無報價/g) || []).length, Number(hundred === null) + Number(fifty === null));
  });
}

test('the combined menu keeps identical ranking and selection, then restores split options on new rates', t => {
  const { elements, option, options } = setup(t);
  const original = structuredClone(state.exchangeRatesBySlug);
  state.exchangeSort = 'USD_50';
  syncExchangeControls();
  assert.equal(shouldCombineGreenUsdSort(), true);
  assert.deepEqual(options.filter(option => option.value !== 'default').map(option => option.value),
    ['USD_100', 'TWD', 'USD_1965', 'TWD_1965']);
  assert.equal(option('USD_100').textContent, '🟢 綠標 USD 50/100');
  assert.equal(option('USD_50'), undefined);
  assert.equal(state.exchangeSort, 'USD_100');
  assert.equal(elements['exchange-sort'].value, 'USD_100');
  assert.deepEqual(sortVisibleIndexes([2, 1, 0], 'USD_100'), sortVisibleIndexes([2, 1, 0], 'USD_50'));
  assert.deepEqual(sortVisibleIndexes([2, 1, 0], state.exchangeSort), [0, 1, 2]);
  assert.deepEqual(state.exchangeRatesBySlug, original);

  // A branch outside the current filtered results still needs a truthful label.
  state.visIdx = [0];
  state.exchangeRatesBySlug[slugs[1]].rates.USD_50.rateScaledE6 = 34_000_000;
  syncExchangeControls();
  assert.equal(option('USD_100').textContent, '🟢 綠標 USD 100');
  assert.equal(option('USD_50').textContent, '🟢 綠標 USD 50');
  assert.equal(option('USD_50').disabled, false);
  assert.equal(state.exchangeSort, 'USD_100');
  assert.deepEqual(sortVisibleIndexes([0, 1], 'USD_50'), [1, 0]);

  state.exchangeSort = 'USD_50';
  state.exchangeRatesBySlug[slugs[1]] = quote(32_000_000);
  syncExchangeControls();
  assert.equal(option('USD_50'), undefined);
  assert.equal(state.exchangeSort, 'USD_100');
});

for (const missingDenom of ['USD_100', 'USD_50']) {
  test(`one branch missing ${missingDenom} keeps both menu choices and its available quote`, t => {
    const { option } = setup(t);
    state.exchangeRatesBySlug[slugs[1]].rates[missingDenom] = cell(missingDenom, null);
    syncExchangeControls();
    assert.equal(shouldCombineGreenUsdSort(), false);
    assert.ok(option('USD_50'));
    assert.equal(option('USD_100').textContent, '🟢 綠標 USD 100');
    assert.equal(option('USD_100').disabled, false);
    assert.equal(option('USD_50').disabled, false);
  });
}

test('combined labels survive language switching and expiry restores unavailable rows', t => {
  const { elements, option } = setup(t);
  for (const [language, label] of [['en', '🟢 Green USD 50/100'], ['zh', '🟢 綠標 USD 50/100']]) {
    setLang(language);
    syncExchangeControls();
    assert.equal(option('USD_100').textContent, label);
    assert.match(renderExchangeRates(state.data[0]), />USD 50\/100<\/span>/);
  }
  state.exchangeSort = 'USD_100';
  expireExchangeRates();
  assert.equal(state.exchangeSort, 'default');
  assert.equal(elements['exchange-sort'].hidden, true);
  assert.equal(elements['exchange-sort-hint'].hidden, true);
  assert.ok(option('USD_50'));
  const html = renderExchangeRates(state.data[0]);
  assert.equal((html.match(/暫無報價/g) || []).length, 3);
  assert.doesNotMatch(html, /USD 50\/100|fx-best|33\.00 THB/);
});

for (const provider of ['google', 'here']) {
  test(`${provider} popup and list share merged and split USD presentation in both languages`, t => {
    const { elements } = setup(t);
    let popup = '';
    state.provider = provider;
    state.activeIdx = 0;
    state.infoWindow = state.infoBubble = { setContent: html => { popup = html; } };
    state.exchangeSort = 'USD_100';
    for (const language of ['zh', 'en']) {
      setLang(language);
      for (const same of [true, false]) {
        state.exchangeRatesBySlug[slugs[0]] = quote(33_000_000, same ? 33_000_000 : 32_000_000);
        renderList();
        refreshActivePopup();
        const panel = buildPopupContent(0).match(/<section class="fx-panel[\s\S]*?<\/section>/)[0];
        assert.ok(elements['loc-list'].innerHTML.includes(panel));
        assert.ok(popup.includes(panel));
        assert.equal((panel.match(/class="fx-rate-row"/g) || []).length, same ? 2 : 3);
        assert.equal(panel.includes('USD 50/100'), same);
        assert.equal((panel.match(/class="fx-best"/g) || []).length, 1);
      }
    }
  });
}
