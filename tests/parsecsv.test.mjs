import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadParseCSV() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const match = html.match(/function parseCSV\(text\)\{[\s\S]*?\n\}/);
  assert.ok(match, 'parseCSV function should exist in index.html');
  return Function(`${match[0]}; return parseCSV;`)();
}

test('parseCSV returns rows when required app headers are present', async () => {
  const parseCSV = await loadParseCSV();
  const csv = [
    'Name_EN,Name_ZH,Alt_Name,Category_EN,Category_ZH,Notes_EN,Notes_ZH,Icon,Lat,Lng,Maps_Query,Status,Duplicate_Group,Source,Coords_Approx',
    'The Siam Hotel,暹羅精品酒店,,Hotel,酒店,English notes,中文說明,🏨,13.7608,100.5089,The+Siam+Hotel+Bangkok,Verified,,KKday,FALSE',
  ].join('\n');

  assert.deepEqual(parseCSV(csv), [[
    'The Siam Hotel',
    '暹羅精品酒店',
    '',
    'Hotel',
    '酒店',
    'English notes',
    '中文說明',
    '🏨',
    '13.7608',
    '100.5089',
    'The+Siam+Hotel+Bangkok',
    'Verified',
    '',
    'KKday',
    'FALSE',
    '',
  ]]);
});

test('parseCSV maps published spreadsheet headers to app rows', async () => {
  const parseCSV = await loadParseCSV();
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Duplicate Group,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH',
    'The Siam Hotel,,https://maps.example/the-siam,Hotel,Luxury hotel,https://example.com,"KKday, Threads",Verified,,13.7608,100.5089,🏨,FALSE,暹羅精品酒店,河畔精品酒店',
    '⚠️ Douban source,,,Source note,Login-only source note,https://example.com/source,Not extracted,,,,,',
  ].join('\n');

  assert.deepEqual(parseCSV(csv), [[
    'The Siam Hotel',
    '暹羅精品酒店',
    '',
    'Hotel',
    '酒店',
    'Luxury hotel',
    '河畔精品酒店',
    '🏨',
    '13.7608',
    '100.5089',
    'https://maps.example/the-siam',
    'Verified',
    '',
    'KKday + Threads',
    'FALSE',
    'https://example.com',
  ]]);
});

test('parseCSV preserves repeated source tags for one-to-one URL mapping', async () => {
  const parseCSV = await loadParseCSV();
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Duplicate Group,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH',
    "Dear December Cafe,P'Booky Cafe,https://maps.example/dear,Cafe,English notes,\"https://trip.example/post, https://threads.example/a, https://threads.example/b, https://maps.example/place\",\"Trip.com, Threads, Threads, Google Maps\",Verified,Group A,13.6756573,100.6446636,☕,FALSE,Dear December 咖啡廳,中文說明",
  ].join('\n');

  const [row] = parseCSV(csv);

  assert.equal(row[13], 'Trip.com + Threads + Threads + Google Maps');
  assert.equal(row[15], 'https://trip.example/post, https://threads.example/a, https://threads.example/b, https://maps.example/place');
});

test('parseCSV ignores URL-shaped source tags and falls back to source URL label', async () => {
  const parseCSV = await loadParseCSV();
  const csv = [
    'Location Name,Thai / Alt Name,Google Maps URL,Category,Notes,Source URL,Source Tags,Verification Status,Duplicate Group,Lat,Lng,Icon,Coordinates Approx,Location Name ZH,Notes ZH',
    "Dear December Cafe,P'Booky Cafe,https://maps.example/dear,Cafe,English notes,https://tw.trip.com/moments/detail/bangkok-191-140507082/,https://tw.trip.com/moments/detail/bangkok-191-140507082/,Verified,Group A,13.6756573,100.6446636,☕,FALSE,Dear December 咖啡廳,中文說明",
  ].join('\n');

  const [row] = parseCSV(csv);

  assert.equal(row[13], 'Trip.com');
});
