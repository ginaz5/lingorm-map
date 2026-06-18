import assert from 'node:assert/strict';
import test from 'node:test';

test('theme mode supports only light and dark', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };

  try {
    const { THEME_ICONS, getEffectiveTheme } = await import('../src/ui.js');

    assert.deepEqual(Object.keys(THEME_ICONS).sort(), ['dark', 'light']);
    assert.equal(getEffectiveTheme(), 'light');

    localStorage.setItem('theme', 'dark');
    assert.equal(getEffectiveTheme(), 'dark');

    localStorage.setItem('theme', 'auto');
    assert.equal(getEffectiveTheme(), 'light');
  } finally {
    delete globalThis.localStorage;
  }
});
