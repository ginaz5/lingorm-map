import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  candidatePreviewMatchesLocation,
  nextReviewLocationId,
  selectionAfterQueueRefresh,
} from '../tools/location-verification-ui/workflow.js';

const appSource = readFileSync(
  new URL('../tools/location-verification-ui/app.js', import.meta.url),
  'utf8'
);
const htmlSource = readFileSync(
  new URL('../tools/location-verification-ui/index.html', import.meta.url),
  'utf8'
);
const serverSource = readFileSync(
  new URL('../scripts/location-verification-ui-server.mjs', import.meta.url),
  'utf8'
);

test('next review location follows queue order and wraps once', () => {
  const queue = [
    { id: 'a', reviewNeeded: true },
    { id: 'b', reviewNeeded: true },
    { id: 'c', reviewNeeded: true },
  ];
  assert.equal(nextReviewLocationId(queue, 'a'), 'b');
  assert.equal(nextReviewLocationId(queue, 'c'), 'a');
  assert.equal(nextReviewLocationId([queue[0]], 'a'), null);
});

test('refresh keeps the selected page when it remains Review Needed', () => {
  const queue = [
    { id: 'a', reviewNeeded: true },
    { id: 'b', reviewNeeded: true },
  ];
  assert.equal(selectionAfterQueueRefresh(queue, 'b', 1), 'b');
});

test('refresh selects the next queue position after Review Needed is unchecked', () => {
  const queue = [
    { id: 'a', reviewNeeded: true },
    { id: 'c', reviewNeeded: true },
  ];
  assert.equal(selectionAfterQueueRefresh(queue, 'b', 1), 'c');
  assert.equal(selectionAfterQueueRefresh(queue, 'c', 2), 'c');
  assert.equal(selectionAfterQueueRefresh([], 'b', 1), null);
});

test('Candidate preview survives refresh only for the same unchanged location', () => {
  const location = {
    id: 'a',
    name: 'Example Cafe',
    slug: 'example-cafe',
    currentPlaceId: 'ChIJexample',
    lat: 13.75,
    lng: 100.5,
  };
  const preview = {
    page: {
      id: '842c2315-8ea2-8281-a3bf-81a75de56f72',
      name: 'Example Cafe',
      slug: 'example-cafe',
      currentPlaceId: 'ChIJexample',
      lat: 13.75,
      lng: 100.5,
    },
  };
  location.id = '842c23158ea28281a3bf81a75de56f72';

  assert.equal(candidatePreviewMatchesLocation(preview, location), true);
  assert.equal(
    candidatePreviewMatchesLocation(preview, {
      ...location,
      id: 'b',
    }),
    false
  );
  assert.equal(
    candidatePreviewMatchesLocation(preview, {
      ...location,
      currentPlaceId: 'ChIJupdated',
    }),
    false
  );
  assert.equal(
    candidatePreviewMatchesLocation(preview, {
      ...location,
      lat: 13.76,
    }),
    false
  );
  assert.equal(candidatePreviewMatchesLocation(null, location), false);
});

test('the UI exposes only Candidate dry-run and read-only evidence', () => {
  assert.match(appSource, /api\('\/api\/resolve\/preview'/);
  assert.match(htmlSource, /執行 Candidate dry-run/);
  assert.match(htmlSource, /開啟 Notion/);
  assert.match(htmlSource, /Notion Automation 會更新 Last\s*Verified/);
  assert.match(htmlSource, /執行全量資料對帳/);
  assert.match(
    htmlSource,
    /同一地點重新同步後會保留/
  );
  assert.doesNotMatch(
    appSource,
    /state\.selectedId = selectionAfterQueueRefresh\([\s\S]*?clearCandidatePreview\(\);\s*renderQueue/
  );

  assert.doesNotMatch(appSource, /\/api\/resolve\/confirm/);
  assert.doesNotMatch(appSource, /\/api\/candidate-reset/);
  assert.doesNotMatch(appSource, /\/api\/coordinates/);
  assert.doesNotMatch(appSource, /\/api\/review/);
  assert.doesNotMatch(appSource, /\/api\/apply/);
  assert.doesNotMatch(htmlSource, /確認寫入 Candidate/);
  assert.doesNotMatch(htmlSource, /記錄人工判斷/);
  assert.doesNotMatch(htmlSource, /Apply 決定/);
  assert.doesNotMatch(htmlSource, /確認寫入座標/);
  assert.doesNotMatch(htmlSource, /已保存 Candidate/);
  assert.doesNotMatch(htmlSource, /Place ID Checked At/);
  assert.doesNotMatch(htmlSource, /Coordinate Type/);
});

test('the server contains no Notion mutation implementation or write secret', () => {
  assert.doesNotMatch(serverSource, /NOTION_FORMAL_WRITE_API_KEY/);
  assert.doesNotMatch(serverSource, /resolvePageWrite/);
  assert.doesNotMatch(serverSource, /reviewPageConfirm/);
  assert.doesNotMatch(serverSource, /applyPageConfirm/);
  assert.doesNotMatch(serverSource, /coordinateCorrectionPageConfirm/);
  assert.doesNotMatch(serverSource, /commitFormalApprovalPlan/);
  assert.match(serverSource, /placesApiMode: 'legacy'/);
  assert.match(serverSource, /filter\(\(item\) => item\.reviewNeeded\)/);
});
