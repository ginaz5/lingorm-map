// Switched from regex extraction to direct imports (Option B modularisation)
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_LOCATION_STATUSES, LOCATION_STATUSES,
  tokenizeCSV, normalizeStatus, sourceLabel,
  normalizeSourceTags, mapsQuery, parseCSV, slugify,
} from '../src/csv-parser.js';
import { isApproximateCoords } from '../src/render.js';

// ─── tokenizeCSV ────────────────────────────────────────────────────────────

test('tokenizeCSV: basic row', () => {
  assert.deepEqual(tokenizeCSV('a,b,c\n1,2,3'), [['a','b','c'],['1','2','3']]);
});

test('tokenizeCSV: quoted field with comma', () => {
  assert.deepEqual(tokenizeCSV('"a,b",c'), [['"a,b"'.replace(/^"|"$/g,''), 'c']]);
  // more precisely:
  assert.deepEqual(tokenizeCSV('"hello, world",ok'), [['hello, world', 'ok']]);
});

test('tokenizeCSV: escaped double-quote inside quoted field', () => {
  assert.deepEqual(tokenizeCSV('"say ""hi""",end'), [['say "hi"', 'end']]);
});

test('tokenizeCSV: CRLF line endings', () => {
  assert.deepEqual(tokenizeCSV('a,b\r\nc,d'), [['a','b'],['c','d']]);
});

test('tokenizeCSV: trailing newline does not add empty row', () => {
  // The if(field||row.length) guard suppresses the empty trailing row
  assert.deepEqual(tokenizeCSV('a,b\nc,d\n'), [['a','b'],['c','d']]);
});

test('tokenizeCSV: BOM prefix is preserved (parseCSV strips it)', () => {
  const bom = '﻿';
  const rows = tokenizeCSV(`${bom}Name,Value\nFoo,Bar`);
  assert.ok(rows[0][0].startsWith('﻿'));
});

test('slugify: produces stable location IDs', () => {
  assert.equal(slugify('The Siam Hotel'), 'the-siam-hotel');
  assert.equal(slugify('  Cafe & Bar  '), 'cafe-bar');
});

// ─── normalizeStatus ────────────────────────────────────────────────────────

test('normalizeStatus: every current status round-trips', () => {
  for (const status of LOCATION_STATUSES) {
    assert.equal(normalizeStatus(status), status);
  }
});

test('status model exposes exactly the three current values', () => {
  assert.deepEqual(LEGACY_LOCATION_STATUSES, [
    'Draft', 'Needs Review', 'Verifying', 'Verified', 'Could Not Find', 'Closed',
  ]);
  assert.deepEqual(LOCATION_STATUSES, ['Published', 'Paused', 'Inactive']);
  assert.equal(
    LOCATION_STATUSES.length,
    new Set(LOCATION_STATUSES).size
  );
});

test('normalizeStatus: canonicalizes case and legacy values into three statuses', () => {
  assert.equal(normalizeStatus('verified'), 'Paused');
  assert.equal(normalizeStatus('VERIFIED'), 'Paused');
  assert.equal(normalizeStatus('PUBLISHED'), 'Published');
  assert.equal(normalizeStatus('paused'), 'Paused');
  assert.equal(normalizeStatus('INACTIVE'), 'Inactive');
  assert.equal(normalizeStatus('Not Found'), 'Inactive');
  assert.equal(normalizeStatus('Could not find'), 'Inactive');
  assert.equal(normalizeStatus('Closed'), 'Inactive');
  assert.equal(normalizeStatus('Draft'), 'Paused');
});

test('normalizeStatus: blank and unknown values fail closed to Paused', () => {
  assert.equal(normalizeStatus(''), 'Paused');
  assert.equal(normalizeStatus('pending'), 'Paused');
});

test('normalizeStatus: negated verification defaults to Paused', () => {
  assert.equal(normalizeStatus('Not Verified'), 'Paused');
});

// ─── sourceLabel ────────────────────────────────────────────────────────────

test('sourceLabel: known platforms', () => {
  assert.equal(sourceLabel('https://www.kkday.com/something'), 'KKday');
  assert.equal(sourceLabel('https://trip.com/moments'), 'Trip.com');
  assert.equal(sourceLabel('https://www.threads.net/@user'), 'Threads');
  assert.equal(sourceLabel('https://www.instagram.com/p/abc'), 'Instagram');
  assert.equal(sourceLabel('https://youtu.be/xyz'), 'YouTube');
  assert.equal(sourceLabel('https://youtube.com/watch?v=abc'), 'YouTube');
});

test('sourceLabel: unknown domain returns Source', () => {
  assert.equal(sourceLabel('https://example.com/post'), 'Source');
});

test('sourceLabel: empty string returns empty', () => {
  assert.equal(sourceLabel(''), '');
});

// ─── normalizeSourceTags ────────────────────────────────────────────────────

test('normalizeSourceTags: strips URL-shaped tokens', () => {
  assert.equal(normalizeSourceTags('https://trip.com/post'), '');
});

test('normalizeSourceTags: joins non-URL tokens with " + "', () => {
  assert.equal(normalizeSourceTags('KKday, Threads'), 'KKday + Threads');
});

test('normalizeSourceTags: mixed URL and label tokens', () => {
  assert.equal(normalizeSourceTags('KKday, https://example.com, Threads'), 'KKday + Threads');
});

// ─── mapsQuery ──────────────────────────────────────────────────────────────

test('mapsQuery: returns maps value when it looks like a real query', () => {
  assert.equal(mapsQuery('The Siam', 'The+Siam+Hotel+Bangkok'), 'The+Siam+Hotel+Bangkok');
  assert.equal(mapsQuery('The Siam', 'https://maps.app.goo.gl/abc'), 'https://maps.app.goo.gl/abc');
});

test('mapsQuery: falls back to "name Bangkok" for placeholder values', () => {
  assert.equal(mapsQuery('Siam Hotel', 'Open in Maps'), 'Siam Hotel Bangkok');
  assert.equal(mapsQuery('Siam Hotel', '📍 Some placeholder'), 'Siam Hotel Bangkok');
  assert.equal(mapsQuery('Siam Hotel', ''), 'Siam Hotel Bangkok');
});

test('mapsQuery: empty name + empty maps returns empty string', () => {
  assert.equal(mapsQuery('', ''), '');
});

// ─── isApproximateCoords ────────────────────────────────────────────────────

test('isApproximateCoords: TRUE / true / yes / 1 / approx are approximate', () => {
  for (const val of ['TRUE', 'true', 'yes', '1', 'approx', 'approximate', 'APPROX']) {
    assert.equal(isApproximateCoords({ approx: val }), true, `expected true for "${val}"`);
  }
});

test('isApproximateCoords: FALSE / empty / 0 are not approximate', () => {
  for (const val of ['FALSE', 'false', '0', '']) {
    assert.equal(isApproximateCoords({ approx: val }), false, `expected false for "${val}"`);
  }
});

// ─── parseCSV integration ───────────────────────────────────────────────────

test('parseCSV: unsupported internal format returns null', () => {
  const csv = [
    'Name_EN,Name_ZH,Alt_Name,Category_EN,Category_ZH,Notes_EN,Notes_ZH,Icon,Lat,Lng,Maps_Query,Status,Duplicate_Group,Source,Coords_Approx',
    'The Siam Hotel,暹羅精品酒店,,Hotel,酒店,English notes,中文說明,🏨,13.7608,100.5089,The+Siam+Hotel+Bangkok,Verified,,KKday,FALSE',
  ].join('\n');

  assert.equal(parseCSV(csv), null);
});

test('parseCSV: published format — maps category, fills icon, normalizes status', () => {
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH',
    'The Siam Hotel,,https://maps.example/the-siam,Hotel,Luxury hotel,https://example.com,"KKday, Threads",Verified,13.7608,100.5089,🏨,FALSE,暹羅精品酒店,河畔精品酒店',
    '⚠️ Douban source,,,Source note,Login-only source note,https://example.com/source,Not extracted,,,,,',
  ].join('\n');

  assert.deepEqual(parseCSV(csv), [{
    id: 'the-siam-hotel',
    nameEn: 'The Siam Hotel', nameZh: '暹羅精品酒店', alt: '',
    catEn: 'Hotel', catZh: '飯店',
    notesEn: 'Luxury hotel', notesZh: '河畔精品酒店', icon: '🏨',
    lat: '13.7608', lng: '100.5089', maps: 'https://maps.example/the-siam',
    status: 'Paused', src: 'KKday + Threads', approx: 'FALSE', sourceUrl: 'https://example.com',
    countryCode: '', destinationKey: '',
  }]);
});

test('parseCSV: published format — preserves repeated source tags for URL mapping', () => {
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH',
    "Dear December Cafe,P'Booky Cafe,https://maps.example/dear,Cafe,English notes,\"https://trip.example/post, https://threads.example/a, https://threads.example/b, https://maps.example/place\",\"Trip.com, Threads, Threads, Google Maps\",Verified,13.6756573,100.6446636,☕,FALSE,Dear December 咖啡廳,中文說明",
  ].join('\n');

  const [row] = parseCSV(csv);
  assert.equal(row.src, 'Trip.com + Threads + Threads + Google Maps');
  assert.equal(row.sourceUrl, 'https://trip.example/post, https://threads.example/a, https://threads.example/b, https://maps.example/place');
});

test('parseCSV: published format — URL-only source tag falls back to sourceLabel', () => {
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH',
    "Dear December Cafe,P'Booky Cafe,https://maps.example/dear,Cafe,English notes,https://tw.trip.com/moments/detail/bangkok-191-140507082/,https://tw.trip.com/moments/detail/bangkok-191-140507082/,Verified,13.6756573,100.6446636,☕,FALSE,Dear December 咖啡廳,中文說明",
  ].join('\n');

  const [row] = parseCSV(csv);
  assert.equal(row.src, 'Trip.com');
});

test('parseCSV: returns null for unrecognized headers', () => {
  const csv = 'foo,bar\n1,2';
  assert.equal(parseCSV(csv), null);
});

test('parseCSV: returns null for empty / header-only input', () => {
  assert.equal(parseCSV(''), null);
  assert.equal(parseCSV('Name_EN,Name_ZH'), null); // header only, no data rows
});

// ─── Slug-based id (plan §6.3, §13 Phase 2 ID fix) ─────────────────────────

test('parseCSV: prefers Slug column over slugify(name) when present', () => {
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH,Slug',
    'The Siam Hotel,,https://maps.example/the-siam,Hotel,Luxury hotel,https://example.com,KKday,Verified,13.7608,100.5089,🏨,FALSE,暹羅精品酒店,河畔精品酒店,the-siam-hotel',
  ].join('\n');
  const [row] = parseCSV(csv);
  assert.equal(row.id, 'the-siam-hotel');
});

test('parseCSV: rename in Notion does not change id — Slug wins even when it no longer matches slugify(new name)', () => {
  // Simulates re-exporting after a maintainer renamed the page in Notion:
  // Name changed, but Slug is frozen at migration time (plan §13 Phase 2)
  // specifically so localStorage favorites and shared #fav URLs still resolve.
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH,Slug',
    'The Siam Hotel (Renamed),,https://maps.example/the-siam,Hotel,Luxury hotel,https://example.com,KKday,Verified,13.7608,100.5089,🏨,FALSE,暹羅精品酒店,河畔精品酒店,the-siam-hotel',
  ].join('\n');
  const [row] = parseCSV(csv);
  assert.equal(row.id, 'the-siam-hotel', 'id should stay the pre-rename slug, not slugify(new name)');
  assert.notEqual(row.id, slugify('The Siam Hotel (Renamed)'));
  assert.equal(row.nameEn, 'The Siam Hotel (Renamed)', 'display name still updates normally');
});

test('parseCSV: falls back to slugify(name) when Slug column absent (legacy sheet format)', () => {
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH',
    'The Siam Hotel,,https://maps.example/the-siam,Hotel,Luxury hotel,https://example.com,KKday,Verified,13.7608,100.5089,🏨,FALSE,暹羅精品酒店,河畔精品酒店',
  ].join('\n');
  const [row] = parseCSV(csv);
  assert.equal(row.id, slugify('The Siam Hotel'));
});

test('parseCSV: falls back to slugify(name) when Slug column present but empty for a row', () => {
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH,Slug',
    'The Siam Hotel,,https://maps.example/the-siam,Hotel,Luxury hotel,https://example.com,KKday,Verified,13.7608,100.5089,🏨,FALSE,暹羅精品酒店,河畔精品酒店,',
  ].join('\n');
  const [row] = parseCSV(csv);
  assert.equal(row.id, slugify('The Siam Hotel'));
});

test('parseCSV: BOM at start of file is stripped from first header', () => {
  const bom = '﻿';
  const csv = [
    `${bom}Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH`,
    'Cafe A,,https://maps.example/cafe-a,Cafe,Notes,https://example.com,KKday,Verified,13.0,100.0,☕,FALSE,咖啡廳A,備註',
  ].join('\n');
  const result = parseCSV(csv);
  assert.ok(result, 'should parse successfully despite BOM');
  assert.equal(result[0].nameEn, 'Cafe A');
});

test('parseCSV: published rows do not expose the removed dup property', () => {
  const csv = [
    'Location Name,Thai / Alt Name,Category,Notes,Source URL,Verification Status,Lat,Lng',
    'Cafe A,,Cafe,Notes,https://example.com,Verified,13.0,100.0',
  ].join('\n');
  const [row] = parseCSV(csv);
  assert.equal(Object.hasOwn(row, 'dup'), false);
});
