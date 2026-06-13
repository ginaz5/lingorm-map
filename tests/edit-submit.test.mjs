import assert from 'node:assert/strict';
import test from 'node:test';

function makeElement(value = '') {
  return {
    value,
    textContent: '',
    className: '',
    disabled: false,
    classList: {
      add() {},
      remove() {},
    },
  };
}

test('submitEdit sends reason separately without duplicating it into note fields', async () => {
  const elements = {
    'edit-location-index': makeElement('0'),
    'edit-maps': makeElement('Updated Maps Query'),
    'edit-lat': makeElement('13.75'),
    'edit-lng': makeElement('100.50'),
    'edit-reason': makeElement('Visited and confirmed details'),
    'edit-submitter': makeElement('@reviewer'),
    'edit-submit-btn': makeElement(),
    'edit-feedback': makeElement(),
    'pending-banner': makeElement(),
    'edit-modal': makeElement(),
  };
  let submittedPayload = null;
  const originalSetTimeout = globalThis.setTimeout;

  globalThis.location = { hostname: 'localhost' };
  globalThis.localStorage = {
    setItem() {},
    getItem() { return null; },
  };
  globalThis.document = {
    getElementById: (id) => elements[id],
    querySelector: (selector) => {
      assert.equal(selector, 'input[name="suggest-status"]:checked');
      return { value: 'Verified' };
    },
  };
  const originalConsoleInfo = console.info;
  console.info = (...args) => {
    submittedPayload = args[2];
  };
  globalThis.setTimeout = (fn) => {
    fn();
    return 0;
  };

  try {
    const { state } = await import('../src/state.js');
    const { submitEdit } = await import('../src/forms.js');
    state.data = [{
      nameZh: '中文地點',
      nameEn: 'English Place',
    }];

    await submitEdit();
  } finally {
    console.info = originalConsoleInfo;
    globalThis.setTimeout = originalSetTimeout;
    delete globalThis.document;
    delete globalThis.location;
    delete globalThis.localStorage;
  }

  assert.equal(submittedPayload.reason, 'Visited and confirmed details');
  assert.equal(submittedPayload.notes_zh, '');
  assert.equal(submittedPayload.notes_en, '');
});
