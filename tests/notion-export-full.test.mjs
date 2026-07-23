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
  'ama-bakery-silom',
  'auntie-nid-coffee-shop',
  'cafe-madeleine-four-seasons-bangkok',
  'chatuchak-weekend-market',
  'chom-arun-restaurant',
  'churn-buttery-lat-krabang',
  'dragon-town-banthat-thong',
  'gourmet-market-siam-paragon',
  'hint-coffee-khlong-san',
  'hitori-shabu-siam-paragon',
  'iki-haus-sukhumvit-71',
  'james-boulangerie-gaysorn-amarin',
  'kao-man-ban-nok-ramkhamhaeng',
  'kate-teaw-boat-noodles-siam-square-soi-3',
  'khlong-bang-luang-floating-market',
  'long-phung-buffet-seafood-mookata',
  'mae-varee-mango-sticky-rice',
  'mok-ubon-ratchathani',
  'moo-ping-sutra-akong-jae-hoong',
  'nai-ek-roll-noodles',
  'nanaflora',
  'nattaporn-coconut-ice-cream',
  'nguan-soon-no1-hand-brand-yaowarat',
  'pak-khlong-talat',
  'pata-plantation-original-tiwanon',
  'phra-phutthayotfa-bridge-memorial-bridge',
  'plantiful-sukhumvit-61',
  'pungdet-banthat-thong',
  'sampeng-market',
  'swu-international-flea-market',
  'titicaca-brunch-club-central-eastville',
  'waraporn-salapao-asoke',
  'wat-paknam-phasi-charoen',
];
const APPROVED_REMOVED_SLUGS = [
  'by',
];

test('formal snapshot uses the stable CSV contract and contains 130 unique rows', () => {
  assert.deepEqual(tokenizeCSV(snapshotCsv)[0], CSV_HEADER);
  assert.equal(snapshotRows.length, 130);
  assert.equal(new Set(snapshotRows.map((row) => row.id)).size, 130);
});

test('formal snapshot preserves the current publication status distribution', () => {
  const statusCounts = Object.fromEntries(
    ['Published', 'Paused', 'Inactive'].map((status) => [
      status,
      snapshotRows.filter((row) => row.status === status).length,
    ])
  );

  assert.deepEqual(statusCounts, {
    Published: 103,
    Paused: 26,
    Inactive: 1,
  });
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
