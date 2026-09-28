import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CSV_HEADER, csvRow } from '../scripts/export-snapshot.mjs';
import { validateSuperrichMapping } from '../scripts/validate-superrich-mapping.mjs';
import { validateLocationSnapshot } from '../scripts/validate-location-snapshot.mjs';
import { parseCSV } from '../src/data/csv-parser.js';
import { isPublicLocation } from '../src/ui/render.js';

const mapping = () => ({ schemaVersion: 1, branches: {
  'superrich-thailand-32': { officialId: 32, branchCode: 'M21' },
  'existing-si-racha-slug': { officialId: 33, branchCode: 'M22' },
} });
const row = (slug, destination, patch = {}) => ({
  'Location Name': 'SuperRich test branch', 'Location Name ZH': 'SuperRich 測試分店',
  Category: '', Type: 'Currency Exchange', Icon: '💱', 'Verification Status': 'Paused',
  Slug: slug, 'Country Code': 'TH', 'Destination Key': destination,
  Lat: '13.3709154', Lng: '100.9684753',
  'Google Maps URL': 'https://www.google.com/maps?cid=123',
  'Source URL': 'https://www.superrichthailand.com/exchange-rate', ...patch,
});
const csv = (rows = [row('superrich-thailand-32', 'chonburi'), row('existing-si-racha-slug', 'si-racha')]) =>
  [csvRow(CSV_HEADER), ...rows.map(r => csvRow(CSV_HEADER.map(key => r[key] || '')))].join('\n');

test('mapping joins by stable Slug, accepts Paused branches and preserves an existing Slug', () => {
  assert.deepEqual(validateSuperrichMapping(mapping(), csv(), { sourceIds: [32, 33] }), {
    schemaVersion: 1, branchCount: 2, publishedCount: 0, unpublishedCount: 2,
  });
  const parsed = parseCSV(csv());
  assert.ok(parsed);
  for (const branch of parsed) {
    assert.equal(branch.catZh, '');
    assert.equal(branch.catEn, '');
    assert.equal(branch.icon, '💱');
    assert.equal(branch.type, 'Currency Exchange');
    assert.equal(isPublicLocation(branch), false);
  }
});

test('committed mapping passes the Netlify build gate with exchange labels and blank categories', () => {
  const committedMapping = JSON.parse(readFileSync(new URL('../data/superrich-branches.json', import.meta.url), 'utf8'));
  const snapshot = readFileSync(new URL('../data/locations.csv', import.meta.url), 'utf8');
  const result = validateSuperrichMapping(committedMapping, snapshot);
  assert.equal(result.branchCount, Object.keys(committedMapping.branches).length);
  assert.ok(result.publishedCount > 0);
});

test('mapping requires the Type column in the formal snapshot', () => {
  const header = CSV_HEADER.filter(key => key !== 'Type');
  const snapshot = [csvRow(header), csvRow(header.map(key => row('superrich-thailand-32', 'chonburi')[key] || ''))].join('\n');
  assert.throws(() => validateSuperrichMapping(mapping(), snapshot), /formal location snapshot headers/);
});

test('mapping rejects duplicate official identities and unresolved branch codes', () => {
  for (const [patch, expected] of [
    [{ officialId: 32 }, /Duplicate officialId/],
    [{ officialId: Number.MAX_SAFE_INTEGER + 1 }, /Invalid officialId/],
    [{ branchCode: 'M21' }, /Duplicate branchCode/],
    [{ branchCode: null }, /Missing or invalid branchCode/],
    [{ branchCode: ' M22 ' }, /Missing or invalid branchCode/],
  ]) {
    const input = mapping();
    Object.assign(input.branches['existing-si-racha-slug'], patch);
    assert.throws(() => validateSuperrichMapping(input, csv()), expected);
  }
});

test('mapping rejects missing, duplicated or misclassified location rows', () => {
  const first = row('superrich-thailand-32', 'chonburi');
  assert.throws(() => validateSuperrichMapping(mapping(), csv([first])), /absent from snapshot/);
  assert.throws(() => validateSuperrichMapping(mapping(), csv([first, first])), /Duplicate snapshot Slug/);
  for (const patch of [{ Type: 'LingOrm' }, { Type: '', Category: 'Currency Exchange' }, { 'Destination Key': '' }, { 'Country Code': 'VN' }, { Lat: '' }, { Lng: '181' }]) {
    assert.throws(() => validateSuperrichMapping(mapping(), csv([
      row('superrich-thailand-32', 'chonburi', patch), row('existing-si-racha-slug', 'si-racha'),
    ])));
  }
});

test('mapping exposes source inventory additions and removals without silently ignoring them', () => {
  assert.throws(() => validateSuperrichMapping(mapping(), csv(), { sourceIds: [32, 34] }), /unknown source IDs \[34\]; absent source IDs \[33\]/);
  assert.throws(() => validateSuperrichMapping(mapping(), csv(), { sourceIds: [32, 32] }), /unique positive/);
});

test('published exchange branches require a supported destination in the snapshot gate', () => {
  for (const destination of ['chonburi', 'si-racha']) {
    const good = row('exchange-test', destination, { 'Verification Status': 'Published' });
    assert.equal(validateLocationSnapshot(csv([good]), 1).publicRowCount, 1);
    assert.throws(() => validateLocationSnapshot(csv([{ ...good, 'Destination Key': '' }]), 1), /Destination|destination/);
  }
});
