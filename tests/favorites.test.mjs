import assert from 'node:assert/strict';
import test from 'node:test';

import { state } from '../src/state.js';
import { loadFavorites, saveFavorites, toggleFavorite } from '../src/favorites.js';
import { applyFilters } from '../src/render.js';

function installBrowserState({ search = '', pathname = '/map', stored = null } = {}) {
  const storage = new Map();
  if (stored !== null) storage.set('favorites', stored);
  const replacedUrls = [];

  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.window = {
    location: { search, pathname },
    history: {
      replaceState: (_state, _title, url) => replacedUrls.push(url),
    },
  };

  return { storage, replacedUrls };
}

function cleanupBrowserState() {
  delete globalThis.localStorage;
  delete globalThis.window;
  delete globalThis.document;
  state.favorites = new Set();
  state.favFilterOn = false;
  state.data = [];
  state.visIdx = [];
  state.isLoading = true;
  state.map = null;
  state.provider = null;
  state.markers = [];
}

test('loadFavorites gives shared URL favorites priority and syncs localStorage', () => {
  const { storage } = installBrowserState({
    search: '?favs=the-siam-hotel,dear-december-cafe',
    stored: JSON.stringify(['old-favorite']),
  });

  try {
    loadFavorites();

    assert.deepEqual([...state.favorites], ['the-siam-hotel', 'dear-december-cafe']);
    assert.equal(storage.get('favorites'), JSON.stringify(['the-siam-hotel', 'dear-december-cafe']));
  } finally {
    cleanupBrowserState();
  }
});

test('loadFavorites restores localStorage and tolerates corrupt values', () => {
  const valid = installBrowserState({ stored: JSON.stringify(['the-siam-hotel']) });

  try {
    loadFavorites();
    assert.deepEqual([...state.favorites], ['the-siam-hotel']);
    assert.deepEqual(valid.replacedUrls, ['?favs=the-siam-hotel']);

    valid.storage.set('favorites', '{broken json');
    state.favorites = new Set(['stale']);
    loadFavorites();
    assert.deepEqual([...state.favorites], []);
  } finally {
    cleanupBrowserState();
  }
});

test('saveFavorites removes an empty favorites query while retaining other params', () => {
  const { storage, replacedUrls } = installBrowserState({
    search: '?favs=old&lang=en',
    pathname: '/map',
  });

  try {
    state.favorites = new Set();
    saveFavorites();

    assert.equal(storage.get('favorites'), '[]');
    assert.deepEqual(replacedUrls, ['?lang=en']);
  } finally {
    cleanupBrowserState();
  }
});

test('applyFilters shows only favorited locations when the favorites filter is active', () => {
  const elements = {
    search: { value: '' },
    'cat-filter': { value: '' },
    'status-filter': { value: '' },
    'loc-list': { innerHTML: '' },
    'result-info': { textContent: '' },
  };
  globalThis.document = { getElementById: id => elements[id] };

  try {
    state.isLoading = false;
    state.favFilterOn = true;
    state.favorites = new Set(['favorite-cafe']);
    state.data = [
      {
        id: 'favorite-cafe', nameEn: 'Favorite Cafe', nameZh: 'Favorite Cafe', alt: '',
        notesEn: '', notesZh: '', catEn: 'Cafe', catZh: '咖啡廳', icon: '☕',
        status: 'Verified', lat: '13.7', lng: '100.5', src: '', sourceUrl: '', dup: '', approx: '',
      },
      {
        id: 'other-cafe', nameEn: 'Other Cafe', nameZh: 'Other Cafe', alt: '',
        notesEn: '', notesZh: '', catEn: 'Cafe', catZh: '咖啡廳', icon: '☕',
        status: 'Verified', lat: '13.8', lng: '100.6', src: '', sourceUrl: '', dup: '', approx: '',
      },
    ];
    state.map = { id: 'map' };
    state.provider = 'google';
    state.markers = [{ map: state.map }, { map: state.map }];

    applyFilters();

    assert.deepEqual(state.visIdx, [0]);
    assert.match(elements['loc-list'].innerHTML, /Favorite Cafe/);
    assert.doesNotMatch(elements['loc-list'].innerHTML, /Other Cafe/);
    assert.equal(state.markers[0].map, state.map);
    assert.equal(state.markers[1].map, null);
  } finally {
    cleanupBrowserState();
  }
});

test('toggleFavorite persists state and synchronizes every matching button', () => {
  const { storage, replacedUrls } = installBrowserState();
  const buttons = [0, 1].map(() => {
    const classes = new Set();
    const attrs = new Map();
    return {
      classes,
      attrs,
      innerHTML: '',
      classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
      setAttribute: (name, value) => attrs.set(name, value),
    };
  });
  globalThis.document = {
    querySelectorAll: selector => {
      assert.equal(selector, '[data-fav-id="the-siam-hotel"]');
      return buttons;
    },
  };

  try {
    toggleFavorite('the-siam-hotel');

    assert.equal(state.favorites.has('the-siam-hotel'), true);
    assert.equal(storage.get('favorites'), JSON.stringify(['the-siam-hotel']));
    assert.deepEqual(replacedUrls, ['?favs=the-siam-hotel']);
    for (const button of buttons) {
      assert.equal(button.classes.has('fav-active'), true);
      assert.equal(button.attrs.get('aria-pressed'), 'true');
      assert.equal(button.attrs.get('aria-label'), '移除最愛');
      assert.match(button.innerHTML, /<svg/);
    }
  } finally {
    cleanupBrowserState();
  }
});
