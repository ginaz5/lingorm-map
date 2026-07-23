import assert from 'node:assert/strict';
import test from 'node:test';

import { checkWhatsNew, closeWhatsNew } from '../src/features/whats-new.js';

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    api: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
}

function installWhatsNewDom() {
  const modalClasses = new Set();
  const elements = {
    'whats-new-modal': {
      classList: {
        add: name => modalClasses.add(name),
        remove: name => modalClasses.delete(name),
      },
    },
    'wn-title': { textContent: '' },
    'wn-desc': { textContent: '' },
    'wn-got-it-btn': { textContent: '' },
    'wn-list': { innerHTML: '' },
  };
  globalThis.document = { getElementById: id => elements[id] ?? null };
  return { elements, modalClasses };
}

function installEnvironment({ lastVisit, shown } = {}) {
  const local = makeStorage(lastVisit ? { last_visit_time: lastVisit } : {});
  const session = makeStorage(shown ? { whats_new_shown: shown } : {});
  globalThis.localStorage = local.api;
  globalThis.sessionStorage = session.api;
  const dom = installWhatsNewDom();
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = callback => { callback(); return 1; };
  return { local, session, dom, originalSetTimeout };
}

function cleanupEnvironment(originalSetTimeout) {
  globalThis.setTimeout = originalSetTimeout;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  delete globalThis.document;
}

test('checkWhatsNew records a first visit without opening the modal', () => {
  const env = installEnvironment();
  try {
    checkWhatsNew();

    assert.ok(Number(env.local.values.get('last_visit_time')) > 0);
    assert.equal(env.dom.modalClasses.has('open'), false);
    assert.equal(env.dom.elements['wn-list'].innerHTML, '');
  } finally {
    cleanupEnvironment(env.originalSetTimeout);
  }
});

test('checkWhatsNew shows all releases published since the last visit', () => {
  const env = installEnvironment({
    lastVisit: String(Date.parse('2026-06-18T00:00:00Z')),
  });
  try {
    checkWhatsNew();

    assert.equal(env.dom.modalClasses.has('open'), true);
    assert.match(env.dom.elements['wn-desc'].textContent, /2/);
    assert.match(env.dom.elements['wn-list'].innerHTML, /點選愛心為收藏景點/);
    assert.match(env.dom.elements['wn-list'].innerHTML, /Google Maps 開啟/);
  } finally {
    cleanupEnvironment(env.originalSetTimeout);
  }
});

test('checkWhatsNew respects the per-session display guard', () => {
  const env = installEnvironment({
    lastVisit: String(Date.parse('2026-06-18T00:00:00Z')),
    shown: '1',
  });
  try {
    checkWhatsNew();

    assert.equal(env.dom.modalClasses.has('open'), false);
    assert.equal(env.dom.elements['wn-list'].innerHTML, '');
  } finally {
    cleanupEnvironment(env.originalSetTimeout);
  }
});

test('closeWhatsNew records the visit, marks the session, and closes the modal', () => {
  const env = installEnvironment();
  env.dom.modalClasses.add('open');
  try {
    closeWhatsNew();

    assert.ok(Number(env.local.values.get('last_visit_time')) > 0);
    assert.equal(env.session.values.get('whats_new_shown'), '1');
    assert.equal(env.dom.modalClasses.has('open'), false);
  } finally {
    cleanupEnvironment(env.originalSetTimeout);
  }
});
