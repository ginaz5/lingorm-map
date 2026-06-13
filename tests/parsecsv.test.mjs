import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Extract the full CSV parser block + its dependencies from index.html.
// Dependencies: const C, CATEGORY_ALIASES, normalizeCategoryRow/Rows
// CSV parser block: everything from the "// CSV PARSER" banner to the "// STATE" banner
async function loadParsers() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  const deps = html.match(/const C=\{[\s\S]*?function normalizeCategoryRows\(rows\)\{[\s\S]*?\n\}/);
  assert.ok(deps, 'C / normalizeCategoryRows block not found in index.html');

  const csvBlock = html.match(/\/\/ CSV PARSER[\s\S]*?(?=\/\/ ═{10,}\n\/\/ STATE)/);
  assert.ok(csvBlock, 'CSV PARSER section not found in index.html');

  // isApproximateCoords lives in the CARD LIST section
  const approxFn = html.match(/function isApproximateCoords\(row\)\{[\s\S]*?\n\}/);
  assert.ok(approxFn, 'isApproximateCoords not found in index.html');

  const code = [deps[0], csvBlock[0], approxFn[0]].join('\n');
  return new Function(`
    ${code}
    return { tokenizeCSV, normalizeStatus, sourceLabel, normalizeSourceTags, mapsQuery, parseCSV, isApproximateCoords };
  `)();
}

// ─── tokenizeCSV ────────────────────────────────────────────────────────────

test('tokenizeCSV: basic row', async () => {
  const { tokenizeCSV } = await loadParsers();
  assert.deepEqual(tokenizeCSV('a,b,c\n1,2,3'), [['a','b','c'],['1','2','3']]);
});

test('tokenizeCSV: quoted field with comma', async () => {
  const { tokenizeCSV } = await loadParsers();
  assert.deepEqual(tokenizeCSV('"a,b",c'), [['"a,b"'.replace(/^"|"$/g,''), 'c']]);
  // more precisely:
  assert.deepEqual(tokenizeCSV('"hello, world",ok'), [['hello, world', 'ok']]);
});

test('tokenizeCSV: escaped double-quote inside quoted field', async () => {
  const { tokenizeCSV } = await loadParsers();
  assert.deepEqual(tokenizeCSV('"say ""hi""",end'), [['say "hi"', 'end']]);
});

test('tokenizeCSV: CRLF line endings', async () => {
  const { tokenizeCSV } = await loadParsers();
  assert.deepEqual(tokenizeCSV('a,b\r\nc,d'), [['a','b'],['c','d']]);
});

test('tokenizeCSV: trailing newline does not add empty row', async () => {
  const { tokenizeCSV } = await loadParsers();
  // The if(field||row.length) guard suppresses the empty trailing row
  assert.deepEqual(tokenizeCSV('a,b\nc,d\n'), [['a','b'],['c','d']]);
});

test('tokenizeCSV: BOM prefix is preserved (parseCSV strips it)', async () => {
  const { tokenizeCSV } = await loadParsers();
  const bom = '﻿';
  const rows = tokenizeCSV(`${bom}Name,Value\nFoo,Bar`);
  assert.ok(rows[0][0].startsWith('﻿'));
});

// ─── normalizeStatus ────────────────────────────────────────────────────────

test('normalizeStatus: exact values pass through', async () => {
  const { normalizeStatus } = await loadParsers();
  assert.equal(normalizeStatus('Verified'), 'Verified');
  assert.equal(normalizeStatus('Needs Review'), 'Needs Review');
  assert.equal(normalizeStatus('Could Not Find'), 'Could Not Find');
});

test('normalizeStatus: case-insensitive fuzzy match', async () => {
  const { normalizeStatus } = await loadParsers();
  assert.equal(normalizeStatus('verified'), 'Verified');
  assert.equal(normalizeStatus('VERIFIED'), 'Verified');
  assert.equal(normalizeStatus('Not Found'), 'Could Not Find');
  assert.equal(normalizeStatus('Could not find'), 'Could Not Find');
});

test('normalizeStatus: unknown value defaults to Needs Review', async () => {
  const { normalizeStatus } = await loadParsers();
  assert.equal(normalizeStatus(''), 'Needs Review');
  assert.equal(normalizeStatus('pending'), 'Needs Review');
});

// ─── sourceLabel ────────────────────────────────────────────────────────────

test('sourceLabel: known platforms', async () => {
  const { sourceLabel } = await loadParsers();
  assert.equal(sourceLabel('https://www.kkday.com/something'), 'KKday');
  assert.equal(sourceLabel('https://trip.com/moments'), 'Trip.com');
  assert.equal(sourceLabel('https://www.threads.net/@user'), 'Threads');
  assert.equal(sourceLabel('https://www.instagram.com/p/abc'), 'Instagram');
  assert.equal(sourceLabel('https://youtu.be/xyz'), 'YouTube');
  assert.equal(sourceLabel('https://youtube.com/watch?v=abc'), 'YouTube');
});

test('sourceLabel: unknown domain returns Source', async () => {
  const { sourceLabel } = await loadParsers();
  assert.equal(sourceLabel('https://example.com/post'), 'Source');
});

test('sourceLabel: empty string returns empty', async () => {
  const { sourceLabel } = await loadParsers();
  assert.equal(sourceLabel(''), '');
});

// ─── normalizeSourceTags ────────────────────────────────────────────────────

test('normalizeSourceTags: strips URL-shaped tokens', async () => {
  const { normalizeSourceTags } = await loadParsers();
  assert.equal(normalizeSourceTags('https://trip.com/post'), '');
});

test('normalizeSourceTags: joins non-URL tokens with " + "', async () => {
  const { normalizeSourceTags } = await loadParsers();
  assert.equal(normalizeSourceTags('KKday, Threads'), 'KKday + Threads');
});

test('normalizeSourceTags: mixed URL and label tokens', async () => {
  const { normalizeSourceTags } = await loadParsers();
  assert.equal(normalizeSourceTags('KKday, https://example.com, Threads'), 'KKday + Threads');
});

// ─── mapsQuery ──────────────────────────────────────────────────────────────

test('mapsQuery: returns maps value when it looks like a real query', async () => {
  const { mapsQuery } = await loadParsers();
  assert.equal(mapsQuery('The Siam', 'The+Siam+Hotel+Bangkok'), 'The+Siam+Hotel+Bangkok');
  assert.equal(mapsQuery('The Siam', 'https://maps.app.goo.gl/abc'), 'https://maps.app.goo.gl/abc');
});

test('mapsQuery: falls back to "name Bangkok" for placeholder values', async () => {
  const { mapsQuery } = await loadParsers();
  assert.equal(mapsQuery('Siam Hotel', 'Open in Maps'), 'Siam Hotel Bangkok');
  assert.equal(mapsQuery('Siam Hotel', '📍 Some placeholder'), 'Siam Hotel Bangkok');
  assert.equal(mapsQuery('Siam Hotel', ''), 'Siam Hotel Bangkok');
});

test('mapsQuery: empty name + empty maps returns empty string', async () => {
  const { mapsQuery } = await loadParsers();
  assert.equal(mapsQuery('', ''), '');
});

// ─── isApproximateCoords ────────────────────────────────────────────────────

const C_APPROX = 14; // C.APPROX index

test('isApproximateCoords: TRUE / true / yes / 1 / approx are approximate', async () => {
  const { isApproximateCoords } = await loadParsers();
  for (const val of ['TRUE', 'true', 'yes', '1', 'approx', 'approximate', 'APPROX']) {
    const row = Array(15).fill('');
    row[C_APPROX] = val;
    assert.equal(isApproximateCoords(row), true, `expected true for "${val}"`);
  }
});

test('isApproximateCoords: FALSE / empty / 0 are not approximate', async () => {
  const { isApproximateCoords } = await loadParsers();
  for (const val of ['FALSE', 'false', '0', '']) {
    const row = Array(15).fill('');
    row[C_APPROX] = val;
    assert.equal(isApproximateCoords(row), false, `expected false for "${val}"`);
  }
});

// ─── parseCSV integration ───────────────────────────────────────────────────

test('parseCSV: internal format — maps Category_ZH alias (Hotel → 飯店)', async () => {
  const { parseCSV } = await loadParsers();
  const csv = [
    'Name_EN,Name_ZH,Alt_Name,Category_EN,Category_ZH,Notes_EN,Notes_ZH,Icon,Lat,Lng,Maps_Query,Status,Duplicate_Group,Source,Coords_Approx',
    'The Siam Hotel,暹羅精品酒店,,Hotel,酒店,English notes,中文說明,🏨,13.7608,100.5089,The+Siam+Hotel+Bangkok,Verified,,KKday,FALSE',
  ].join('\n');

  assert.deepEqual(parseCSV(csv), [[
    'The Siam Hotel', '暹羅精品酒店', '',
    'Hotel', '飯店',
    'English notes', '中文說明', '🏨',
    '13.7608', '100.5089', 'The+Siam+Hotel+Bangkok',
    'Verified', '', 'KKday', 'FALSE', '',
  ]]);
});

test('parseCSV: published format — maps category, fills icon, normalizes status', async () => {
  const { parseCSV } = await loadParsers();
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Duplicate Group,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH',
    'The Siam Hotel,,https://maps.example/the-siam,Hotel,Luxury hotel,https://example.com,"KKday, Threads",Verified,,13.7608,100.5089,🏨,FALSE,暹羅精品酒店,河畔精品酒店',
    '⚠️ Douban source,,,Source note,Login-only source note,https://example.com/source,Not extracted,,,,,',
  ].join('\n');

  assert.deepEqual(parseCSV(csv), [[
    'The Siam Hotel', '暹羅精品酒店', '',
    'Hotel', '飯店',
    'Luxury hotel', '河畔精品酒店', '🏨',
    '13.7608', '100.5089', 'https://maps.example/the-siam',
    'Verified', '', 'KKday + Threads', 'FALSE', 'https://example.com',
  ]]);
});

test('parseCSV: published format — preserves repeated source tags for URL mapping', async () => {
  const { parseCSV } = await loadParsers();
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Duplicate Group,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH',
    "Dear December Cafe,P'Booky Cafe,https://maps.example/dear,Cafe,English notes,\"https://trip.example/post, https://threads.example/a, https://threads.example/b, https://maps.example/place\",\"Trip.com, Threads, Threads, Google Maps\",Verified,Group A,13.6756573,100.6446636,☕,FALSE,Dear December 咖啡廳,中文說明",
  ].join('\n');

  const [row] = parseCSV(csv);
  assert.equal(row[13], 'Trip.com + Threads + Threads + Google Maps');
  assert.equal(row[15], 'https://trip.example/post, https://threads.example/a, https://threads.example/b, https://maps.example/place');
});

test('parseCSV: published format — URL-only source tag falls back to sourceLabel', async () => {
  const { parseCSV } = await loadParsers();
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Duplicate Group,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH',
    "Dear December Cafe,P'Booky Cafe,https://maps.example/dear,Cafe,English notes,https://tw.trip.com/moments/detail/bangkok-191-140507082/,https://tw.trip.com/moments/detail/bangkok-191-140507082/,Verified,Group A,13.6756573,100.6446636,☕,FALSE,Dear December 咖啡廳,中文說明",
  ].join('\n');

  const [row] = parseCSV(csv);
  assert.equal(row[13], 'Trip.com');
});

test('parseCSV: returns null for unrecognized headers', async () => {
  const { parseCSV } = await loadParsers();
  const csv = 'foo,bar\n1,2';
  assert.equal(parseCSV(csv), null);
});

test('parseCSV: returns null for empty / header-only input', async () => {
  const { parseCSV } = await loadParsers();
  assert.equal(parseCSV(''), null);
  assert.equal(parseCSV('Name_EN,Name_ZH'), null); // header only, no data rows
});

test('parseCSV: BOM at start of file is stripped from first header', async () => {
  const { parseCSV } = await loadParsers();
  const bom = '﻿';
  const csv = [
    `${bom}Name_EN,Name_ZH,Alt_Name,Category_EN,Category_ZH,Notes_EN,Notes_ZH,Icon,Lat,Lng,Maps_Query,Status,Duplicate_Group,Source,Coords_Approx`,
    'Cafe A,咖啡廳A,,Cafe,咖啡廳,Notes,備註,☕,13.0,100.0,Cafe+A,Verified,,KKday,FALSE',
  ].join('\n');
  const result = parseCSV(csv);
  assert.ok(result, 'should parse successfully despite BOM');
  assert.equal(result[0][0], 'Cafe A');
});
