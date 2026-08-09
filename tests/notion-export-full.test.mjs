// Current formal-Notion snapshot acceptance tests. The frozen Google Sheet
// remains an immutable historical artifact; approved slug additions and
// replacements must be enumerated instead of weakening the reconciliation.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCSV, tokenizeCSV } from '../src/data/csv-parser.js';
import { CSV_HEADER } from '../scripts/export-snapshot.mjs';

const snapshotPath = fileURLToPath(new URL('../data/locations.csv', import.meta.url));
const frozenSourcePath = fileURLToPath(
  new URL('../data/migration/source-20260718.csv', import.meta.url)
);
const snapshotCsv = readFileSync(snapshotPath, 'utf8');
const snapshotRows = parseCSV(snapshotCsv);

const APPROVED_ADDED_SLUGS = [
  'alien-bangkok',
  'ama-bakery-silom',
  'areeya-mookrata-new-petchaburi',
  'auntie-nid-coffee-shop',
  'baiwago-plus-cafe-kmc',
  'cafe-madeleine-four-seasons-bangkok',
  'chatuchak-weekend-market',
  'chom-arun-restaurant',
  'chrisly-cafe-tsim-sha-tsui',
  'churn-buttery-lat-krabang',
  'coco-tams-fishermans-village',
  'connie-bakes-anhe',
  'dragon-town-banthat-thong',
  'gourmet-market-siam-paragon',
  'hint-coffee-khlong-san',
  'hitori-shabu-siam-paragon',
  'house-of-benedict-pattaya',
  'hungry-eatery-prasert-manutakit-33',
  'iki-haus-sukhumvit-71',
  'james-boulangerie-gaysorn-amarin',
  'kao-man-ban-nok-ramkhamhaeng',
  'kate-teaw-boat-noodles-siam-square-soi-3',
  'khlong-bang-luang-floating-market',
  'long-phung-buffet-seafood-mookata',
  'mae-varee-mango-sticky-rice',
  'military-dependents-village-cultural-park',
  'mok-ubon-ratchathani',
  'moo-ping-sutra-akong-jae-hoong',
  'nai-ek-roll-noodles',
  'nanaflora',
  'nattaporn-coconut-ice-cream',
  'naughty-girl-kaohsiung',
  'nguan-soon-no1-hand-brand-yaowarat',
  'niyai-baansuan',
  'pak-khlong-talat',
  'pata-plantation-original-tiwanon',
  'phra-phutthayotfa-bridge-memorial-bridge',
  'plantiful-sukhumvit-61',
  'pungdet-banthat-thong',
  'rethink-coffee-roasters-broadway-macau',
  'sampeng-market',
  'shenfangcui-coffee-yunong',
  'showa-shiyoubajiu',
  'star-trails-kaohsiung',
  'swu-international-flea-market',
  'the-office-thonglor',
  'titicaca-brunch-club-central-eastville',
  'wallflowers-cafe-restaurant-bar',
  'waraporn-salapao-asoke',
  'wat-paknam-phasi-charoen',
  'woolloomooloo-bakery-thonglor',
];
const APPROVED_REMOVED_SLUGS = [
  'by',
];

test('formal snapshot uses the stable CSV contract and unique Slugs', () => {
  assert.deepEqual(tokenizeCSV(snapshotCsv)[0], CSV_HEADER);
  assert.ok(snapshotRows.length > 0);
  assert.equal(new Set(snapshotRows.map((row) => row.id)).size, snapshotRows.length);
});

test('formal snapshot does not mark exported coordinates as approximate', () => {
  assert.equal(snapshotRows.every((row) => row.approx === ''), true);
});

test('formal snapshot contains the two explicitly requested slug results', () => {
  const snapshotBySlug = new Map(snapshotRows.map((row) => [row.id, row]));

  assert.equal(
    snapshotBySlug.get('kate-teaw-boat-noodles-siam-square-soi-3')?.nameEn,
    'Kate Teaw Boat Noodles Siam Square Soi 3'
  );
  assert.equal(
    snapshotBySlug.get('plantiful-sukhumvit-61')?.nameEn,
    'PLANTIFUL on Sukhumvit 61'
  );
});

test(
  'formal snapshot has only the approved slug delta from the frozen source',
  { skip: !existsSync(frozenSourcePath) && 'frozen migration source is intentionally gitignored' },
  () => {
    const sourceRows = parseCSV(readFileSync(frozenSourcePath, 'utf8'));
    const sourceSlugs = new Set(sourceRows.map((row) => row.id));
    const snapshotSlugs = new Set(snapshotRows.map((row) => row.id));
    const added = [...snapshotSlugs]
      .filter((slug) => !sourceSlugs.has(slug))
      .sort();
    const removed = [...sourceSlugs]
      .filter((slug) => !snapshotSlugs.has(slug))
      .sort();

    assert.equal(sourceRows.length, 98);
    assert.equal(sourceRows.filter((row) => row.src === '___epoh___').length, 56);
    assert.deepEqual(added, APPROVED_ADDED_SLUGS);
    assert.deepEqual(removed, APPROVED_REMOVED_SLUGS);
  }
);
