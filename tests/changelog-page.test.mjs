import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CHANGELOG,
  formatChangelogDate,
  localizeChangelogItem,
} from '../src/features/changelog-data.js';

test('changelog data is newest-first and has bilingual copy', () => {
  assert.ok(CHANGELOG.length > 3);
  for (let index = 1; index < CHANGELOG.length; index += 1) {
    assert.ok(CHANGELOG[index - 1].publishTime >= CHANGELOG[index].publishTime);
  }

  const latest = CHANGELOG[0];
  assert.equal(new Date(latest.publishTime).getUTCFullYear(), 2026);
  assert.equal(localizeChangelogItem(latest, 'zh').title, '地圖標記自動聚合');
  assert.equal(localizeChangelogItem(latest, 'en').title, 'Automatic marker clustering');
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
  assert.match(changelogSrc, /changelog-lang-btn.+setAttribute\('aria-label'/);
  assert.match(changelogSrc, /changelog-theme-btn.+setAttribute\('aria-label'/);
});
