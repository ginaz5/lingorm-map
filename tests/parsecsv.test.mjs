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
    'Location Name,Thai / Alt Name,Google Maps Link,Category,Notes,Source URL,Verification Status,Duplicate Group',
    'The Siam Hotel,,📍 Open in Maps,Hotel,Luxury hotel,https://example.com,Verified,',
    '⚠️ Douban source,,,Source note,Login-only source note,https://example.com/source,Not extracted,',
  ].join('\n');

  assert.deepEqual(parseCSV(csv), [[
    'The Siam Hotel',
    'The Siam Hotel',
    '',
    'Hotel',
    '酒店',
    'Luxury hotel',
    'Luxury hotel',
    '🏨',
    '',
    '',
    'The Siam Hotel Bangkok',
    'Verified',
    '',
    'Source',
    'TRUE',
    'https://example.com',
  ]]);
});
