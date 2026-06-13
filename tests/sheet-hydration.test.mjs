import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadHydrator() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const embeddedMatch = html.match(/const EMBEDDED = \[[\s\S]*?\n\];/);
  const cMatch = html.match(/const C=\{[\s\S]*?\};/);
  const categoryMatch = html.match(/const CATEGORY_ALIASES = \{[\s\S]*?function normalizeCategoryRows\(rows\)\{[\s\S]*?\n\}/);
  const hydrateMatch = html.match(/function hydrateSheetRows\(rows\)\{[\s\S]*?\n\}/);

  assert.ok(embeddedMatch, 'EMBEDDED data should exist in index.html');
  assert.ok(cMatch, 'column indexes should exist in index.html');
  assert.ok(categoryMatch, 'category normalization helpers should exist in index.html');
  assert.ok(hydrateMatch, 'hydrateSheetRows function should exist in index.html');

  return Function(`${embeddedMatch[0]}\n${cMatch[0]}\n${categoryMatch[0]}\n${hydrateMatch[0]}; return {C, hydrateSheetRows};`)();
}

test('hydrateSheetRows fills missing coordinates from embedded rows by location name', async () => {
  const { C, hydrateSheetRows } = await loadHydrator();
  const row = [
    'The Siam Hotel',
    'The Siam Hotel',
    '',
    'Hotel',
    '酒店',
    'Sheet notes',
    'Sheet notes',
    '🏨',
    '',
    '',
    'The Siam Hotel Bangkok',
    'Verified',
    '',
    'KKday',
    'TRUE',
    'https://www.kkday.com/example',
  ];

  const [hydrated] = hydrateSheetRows([row]);

  assert.equal(hydrated[C.LAT], '13.7608');
  assert.equal(hydrated[C.LNG], '100.5089');
  assert.equal(hydrated[C.NOTES_EN], 'Sheet notes');
  assert.equal(row[C.LAT], '');
});

test('hydrateSheetRows matches simple spreadsheet name variants', async () => {
  const { C, hydrateSheetRows } = await loadHydrator();
  const rows = [
    [
      "00K's Fried Chicken Shop",
      "00K's Fried Chicken Shop",
      '',
      'Restaurant',
      '餐廳',
      'Sheet notes',
      'Sheet notes',
      '🍽',
      '',
      '',
      "00K's Fried Chicken Shop Bangkok",
      'Needs Review',
      'Group D',
      'Threads',
      'TRUE',
      'https://www.threads.com/example',
    ],
    [
      'Tue Kha Tang (豬肘凍)',
      'Tue Kha Tang (豬肘凍)',
      'ตือ ข้า ตัง(?)',
      'Street Food',
      '街頭小吃',
      'Sheet notes',
      'Sheet notes',
      '🍜',
      '',
      '',
      'Tue Kha Tang Bangkok',
      'Needs Review',
      '',
      'KKday',
      'TRUE',
      'https://www.kkday.com/example',
    ],
  ];

  const hydrated = hydrateSheetRows(rows);

  assert.equal(hydrated[0][C.LAT], '13.7603');
  assert.equal(hydrated[0][C.LNG], '100.5476');
  assert.equal(hydrated[1][C.LAT], '13.735');
  assert.equal(hydrated[1][C.LNG], '100.515');
});
