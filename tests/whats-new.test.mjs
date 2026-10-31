import assert from 'node:assert/strict';
import test from 'node:test';
import { setLang } from '../src/core/i18n.js';

import {
  checkWhatsNew,
  closeWhatsNew,
  updateWhatsNewLangUI,
  WHATS_NEW_PREVIEW_LIMIT,
} from '../src/features/whats-new.js';
import {
  CHANGELOG,
  CURRENT_CHANGELOG_RELEASE_ID,
} from '../src/features/changelog-data.js';

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
    'wn-changelog-link': { textContent: '' },
    'wn-list': { innerHTML: '' },
  };
  globalThis.document = { getElementById: id => elements[id] ?? null };
  return { elements, modalClasses };
}

function installEnvironment({ lastVisit, seenRelease, shown } = {}) {
  const local = makeStorage({
    ...(lastVisit ? { last_visit_time: lastVisit } : {}),
    ...(seenRelease ? { last_seen_changelog_release: seenRelease } : {}),
  });
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
    assert.equal(
      env.local.values.get('last_seen_changelog_release'),
      CURRENT_CHANGELOG_RELEASE_ID,
    );
    assert.equal(env.dom.modalClasses.has('open'), false);
    assert.equal(env.dom.elements['wn-list'].innerHTML, '');
  } finally {
    cleanupEnvironment(env.originalSetTimeout);
  }
});

test('checkWhatsNew previews the current release with general update copy', () => {
  const env = installEnvironment({
    lastVisit: String(Date.parse('2026-07-30T12:00:00+08:00')),
  });
  try {
    checkWhatsNew();

    const currentReleaseItems = CHANGELOG.filter(
      item => item.releaseId === CURRENT_CHANGELOG_RELEASE_ID,
    );
    assert.equal(env.dom.modalClasses.has('open'), true);
    assert.equal(WHATS_NEW_PREVIEW_LIMIT, 3);
    assert.equal(currentReleaseItems.length, 4);
    assert.equal(env.dom.elements['wn-title'].textContent, '✨ 最近更新');
    assert.equal(env.dom.elements['wn-desc'].textContent, '來看看上次造訪後的更新。');
    assert.equal(
      env.dom.elements['wn-list'].innerHTML.match(/class="wn-feat"/g)?.length,
      3,
    );
    assert.match(env.dom.elements['wn-list'].innerHTML, /新增 SuperRich 1965 橘標分店與匯率/);
    assert.match(env.dom.elements['wn-list'].innerHTML, /點頁首標題，回到完整地圖/);
    assert.match(env.dom.elements['wn-list'].innerHTML, /粉絲資源新增音樂與同人文網站/);
    assert.doesNotMatch(env.dom.elements['wn-list'].innerHTML, /新增杜拜與佛統府目的地支援/);
    assert.doesNotMatch(env.dom.elements['wn-list'].innerHTML, /手機版新增篩選面板/);
    assert.doesNotMatch(env.dom.elements['wn-list'].innerHTML, /手機地圖彈窗置中，地點筆記更好讀/);
    assert.doesNotMatch(env.dom.elements['wn-list'].innerHTML, /新增東京目的地與更多踩點/);
    assert.doesNotMatch(env.dom.elements['wn-list'].innerHTML, /新增 SuperRich Thailand 換匯地圖/);
    assert.doesNotMatch(env.dom.elements['wn-list'].innerHTML, /手機版篩選與卡片定位更順手/);
    assert.doesNotMatch(env.dom.elements['wn-list'].innerHTML, /更注重隱私的互動分析/);
    assert.doesNotMatch(env.dom.elements['wn-list'].innerHTML, /篩選新增「標籤」與「目的地」/);
    assert.equal(env.dom.elements['wn-changelog-link'].textContent, '查看完整更新紀錄');
  } finally {
    cleanupEnvironment(env.originalSetTimeout);
  }
});

test('checkWhatsNew shows the catch-up release after September 28 and refreshes its preview in English', () => {
  const env = installEnvironment({
    lastVisit: String(Date.parse('2026-10-30T12:00:00Z')),
    seenRelease: '2026-09-28-mobile-filters-and-map-updates',
  });
  try {
    checkWhatsNew();
    assert.equal(env.dom.modalClasses.has('open'), true);

    setLang('en');
    updateWhatsNewLangUI();
    const html = env.dom.elements['wn-list'].innerHTML;
    assert.equal(html.match(/class="wn-feat"/g)?.length, WHATS_NEW_PREVIEW_LIMIT);
    assert.match(html, /SuperRich 1965 branches and rates are now on the map/);
    assert.match(html, /Return to the full map from the header/);
    assert.match(html, /Concert audio and fan fiction in Fan Resources/);
    assert.doesNotMatch(html, /Destination support for Dubai and Nakhon Pathom/);
    assert.doesNotMatch(html, /A new filter sheet on mobile/);
    assert.doesNotMatch(html, /Tokyo and more locations added/);
    assert.equal(env.dom.elements['wn-title'].textContent, '✨ Latest updates');
    assert.equal(env.dom.elements['wn-changelog-link'].textContent, 'View full changelog');
  } finally {
    setLang('zh');
    cleanupEnvironment(env.originalSetTimeout);
  }
});

test('checkWhatsNew does not repeat a release that was already seen', () => {
  const env = installEnvironment({
    lastVisit: String(Date.parse('2026-07-29T00:00:00+08:00')),
    seenRelease: CURRENT_CHANGELOG_RELEASE_ID,
  });
  try {
    checkWhatsNew();

    assert.equal(env.dom.modalClasses.has('open'), false);
    assert.equal(env.dom.elements['wn-list'].innerHTML, '');
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
    assert.equal(
      env.local.values.get('last_seen_changelog_release'),
      CURRENT_CHANGELOG_RELEASE_ID,
    );
    assert.equal(env.session.values.get('whats_new_shown'), '1');
    assert.equal(env.dom.modalClasses.has('open'), false);
  } finally {
    cleanupEnvironment(env.originalSetTimeout);
  }
});
