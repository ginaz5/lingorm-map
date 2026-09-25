// Current formal-Notion snapshot acceptance tests. The committed legacy
// favorite-ID manifest is the CI-visible migration baseline; approved slug
// additions must be enumerated instead of weakening the reconciliation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCSV, tokenizeCSV } from '../src/data/csv-parser.js';
import { CSV_HEADER } from '../scripts/export-snapshot.mjs';

const snapshotPath = fileURLToPath(new URL('../data/locations.csv', import.meta.url));
const legacyFavoriteIdsPath = fileURLToPath(
  new URL('../data/legacy-favorite-ids.json', import.meta.url)
);
const snapshotCsv = readFileSync(snapshotPath, 'utf8');
const snapshotRows = parseCSV(snapshotCsv);
const legacyFavoriteIds = JSON.parse(readFileSync(legacyFavoriteIdsPath, 'utf8')).ids;

const APPROVED_ADDED_SLUGS = [
  'ace-of-clubs-rama-iv',
  'alien-bangkok',
  'ama-bakery-silom',
  'areeya-mookrata-new-petchaburi',
  'auntie-nid-coffee-shop',
  'baiwago-plus-cafe-kmc',
  'cafe-madeleine-four-seasons-bangkok',
  'caffe-del-museo-khao-yai',
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
  'ku-thai-krung-thep-kaohsiung',
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
  'nittaya-bamee-kiao-charoen-rat-4',
  'niyai-baansuan',
  'pak-khlong-talat',
  'pata-plantation-original-tiwanon',
  'phra-phutthayotfa-bridge-memorial-bridge',
  'pungdet-banthat-thong',
  'restaurante-litoral-macau',
  'rethink-coffee-roasters-broadway-macau',
  'sampeng-market',
  'sea-of-love-pattaya',
  'shenfangcui-coffee-yunong',
  'showa-shiyoubajiu',
  'star-trails-kaohsiung',
  'superrich-thailand-10',
  'superrich-thailand-11',
  'superrich-thailand-12',
  'superrich-thailand-13',
  'superrich-thailand-14',
  'superrich-thailand-15',
  'superrich-thailand-16',
  'superrich-thailand-17',
  'superrich-thailand-18',
  'superrich-thailand-19',
  'superrich-thailand-20',
  'superrich-thailand-21',
  'superrich-thailand-22',
  'superrich-thailand-23',
  'superrich-thailand-24',
  'superrich-thailand-25',
  'superrich-thailand-26',
  'superrich-thailand-27',
  'superrich-thailand-28',
  'superrich-thailand-29',
  'superrich-thailand-30',
  'superrich-thailand-31',
  'superrich-thailand-32',
  'superrich-thailand-33',
  'superrich-thailand-34',
  'superrich-thailand-35',
  'superrich1965-110',
  'superrich1965-112',
  'superrich1965-56',
  'superrich1965-57',
  'superrich1965-58',
  'superrich1965-59',
  'superrich1965-60',
  'superrich1965-61',
  'superrich1965-62',
  'superrich1965-63',
  'superrich1965-64',
  'superrich1965-65',
  'superrich1965-66',
  'superrich1965-67',
  'superrich1965-68',
  'superrich1965-69',
  'superrich1965-70',
  'superrich1965-71',
  'superrich1965-72',
  'superrich1965-73',
  'superrich1965-74',
  'superrich1965-76',
  'superrich1965-77',
  'superrich1965-78',
  'superrich1965-79',
  'superrich1965-80',
  'superrich1965-81',
  'superrich1965-82',
  'superrich1965-83',
  'superrich1965-84',
  'superrich1965-85',
  'superrich1965-86',
  'superrich1965-88',
  'superrich1965-89',
  'superrich1965-90',
  'superrich1965-91',
  'superrich1965-92',
  'superrich1965-93',
  'swu-international-flea-market',
  'the-office-thonglor',
  'titicaca-brunch-club-central-eastville',
  'wallflowers-cafe-restaurant-bar',
  'waraporn-salapao-asoke',
  'wat-paknam-phasi-charoen',
  'woolloomooloo-bakery-thonglor',
  'yole-siam-paragon',
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

test('formal snapshot has only the approved slug delta from the migration baseline', () => {
  const baselineSlugs = new Set(legacyFavoriteIds);
  const snapshotSlugs = new Set(snapshotRows.map((row) => row.id));
  const added = [...snapshotSlugs]
    .filter((slug) => !baselineSlugs.has(slug))
    .sort();
  const removed = [...baselineSlugs]
    .filter((slug) => !snapshotSlugs.has(slug))
    .sort();

  assert.equal(legacyFavoriteIds.length, 98);
  assert.deepEqual(added, APPROVED_ADDED_SLUGS);
  assert.deepEqual(removed, []);
});
