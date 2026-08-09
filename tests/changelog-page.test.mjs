import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { T } from '../src/core/i18n.js';
import {
  CHANGELOG,
  CURRENT_CHANGELOG_RELEASE_ID,
  formatChangelogDate,
  groupChangelogByDate,
  localizeChangelogItem,
} from '../src/features/changelog-data.js';

test('changelog data is newest-first and has bilingual copy', () => {
  assert.ok(CHANGELOG.length > 3);
  for (let index = 1; index < CHANGELOG.length; index += 1) {
    assert.ok(CHANGELOG[index - 1].publishTime >= CHANGELOG[index].publishTime);
  }

  const latest = CHANGELOG[0];
  assert.equal(new Date(latest.publishTime).getUTCFullYear(), 2026);
  assert.equal(localizeChangelogItem(latest, 'zh').title, '手機版篩選與卡片定位更順手');
  assert.equal(localizeChangelogItem(latest, 'en').title, 'Smoother mobile filters and card positioning');

  const currentReleaseItems = CHANGELOG.filter(
    item => item.releaseId === CURRENT_CHANGELOG_RELEASE_ID,
  );
  assert.equal(currentReleaseItems.length, 3);
  assert.ok(currentReleaseItems.every(item => item.publishTime === latest.publishTime));
  assert.equal(
    CHANGELOG.filter(item => item.releaseId === '2026-07-30-pr-2').length,
    7,
  );
});

test('changelog entries with the same GMT+8 date share one group', () => {
  const groups = groupChangelogByDate(CHANGELOG);

  assert.equal(groups[0].dateKey, '2026-08-09');
  assert.equal(groups[0].items.length, 3);
  assert.equal(groups[1].dateKey, '2026-07-30');
  assert.equal(groups[1].items.length, 7);
  assert.equal(groups.length < CHANGELOG.length, true);
});

test('changelog dates render in the selected language and GMT+8 calendar day', () => {
  const publishTime = Date.parse('2026-07-21T00:00:00+08:00');
  assert.equal(formatChangelogDate(publishTime, 'zh'), '2026年7月21日');
  assert.equal(formatChangelogDate(publishTime, 'en'), 'July 21, 2026');
});

test('modal links to a dedicated changelog page with language and theme controls', async () => {
  const [indexHtml, changelogHtml, mainSrc, changelogSrc] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../changelog.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/changelog-page.js', import.meta.url), 'utf8'),
  ]);

  assert.match(indexHtml, /id="wn-changelog-link"[^>]+href="\.\/changelog\.html"/);
  assert.match(indexHtml, /id="changelog-btn"[^>]+href="\.\/changelog\.html"/);
  assert.doesNotMatch(mainSrc, /wn-changelog-link.+closeWhatsNew/);
  assert.match(changelogHtml, /id="changelog-list"/);
  assert.match(changelogHtml, /src="\/src\/changelog-page\.js"/);
  assert.match(changelogHtml, /id="changelog-lang-btn"/);
  assert.match(changelogHtml, /id="changelog-theme-btn"/);
  assert.match(changelogHtml, /href="\.\/index\.html"/);
  assert.match(changelogHtml, /LingOrm Map/);
  assert.doesNotMatch(changelogHtml, /Lingorm Map/);
  assert.match(T.zh.changelog_intro, /LingOrm Map/);
  assert.match(T.zh.changelog_page_title, /LingOrm Map/);
  assert.match(T.en.changelog_intro, /LingOrm Map/);
  assert.match(T.en.changelog_page_title, /LingOrm Map/);
  assert.match(changelogSrc, /changelog-lang-btn.+setAttribute\('aria-label'/);
  assert.match(changelogSrc, /changelog-theme-btn.+setAttribute\('aria-label'/);
  assert.match(changelogSrc, /groupChangelogByDate\(CHANGELOG\)/);
  assert.match(changelogSrc, /class="changelog-entry-items"/);
});
