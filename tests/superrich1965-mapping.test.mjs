import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { CSV_HEADER, csvRow } from '../scripts/export-snapshot.mjs';
import { validateSuperrich1965Mapping } from '../scripts/validate-superrich1965-mapping.mjs';
import { parseCSV } from '../src/data/csv-parser.js';
import { isPublicLocation } from '../src/ui/render.js';

const mapping = () => ({ schemaVersion: 1, branches: {
  'superrich1965-56': { officialId: 56, branchNo: '00', companyCode: 'A04' },
  'superrich1965-112': { officialId: 112, branchNo: '51', companyCode: 'A04' },
} });
const row = (slug, patch = {}) => ({
  'Location Name': 'SuperRich 1965 test', 'Location Name ZH': '橘標測試分店',
  Slug: slug, Category: 'Currency Exchange', 'Verification Status': 'Paused',
  'Country Code': 'TH', 'Destination Key': 'bangkok', Lat: '13.72', Lng: '100.52',
  'Google Maps URL': 'https://www.google.com/maps?cid=123',
  'Source URL': 'https://www.superrich1965.com/en/exchange-rate', ...patch,
});
const csv = (rows = [row('superrich1965-56'), row('superrich1965-112')]) =>
  [csvRow(CSV_HEADER), ...rows.map(r => csvRow(CSV_HEADER.map(key => r[key] ?? '')))].join('\n');
const source = () => Object.values(mapping().branches).map(b => ({ ...b, group: 'main-branch' }));

test('orange mapping preserves leading zero branch numbers and Paused rows remain hidden', () => {
  assert.deepEqual(validateSuperrich1965Mapping(mapping(), csv(), { sourceBranches: source() }), {
    schemaVersion: 1, branchCount: 2, publishedCount: 0, unpublishedCount: 2,
  });
  const parsed = parseCSV(csv());
  assert.equal(parsed.length, 2);
  assert(parsed.every(r => !isPublicLocation(r) && r.type === ''));
});

test('orange mapping checks exact Slug and officialId correspondence', () => {
  const input = mapping(); input.branches['superrich1965-112'].officialId = 110;
  assert.throws(() => validateSuperrich1965Mapping(input, csv()), /Slug\/officialId mismatch/);
});

test('orange mapping rejects duplicate or invalid official identities', () => {
  for (const officialId of [56, 0, -1, 1.5, '112', Number.MAX_SAFE_INTEGER + 1]) {
    const input = mapping(); input.branches['superrich1965-112'].officialId = officialId;
    assert.throws(() => validateSuperrich1965Mapping(input, csv()), /officialId/);
  }
});

test('orange mapping rejects duplicated, numeric, padded or empty branch numbers', () => {
  for (const branchNo of ['00', 51, ' 51 ', '', null]) {
    const input = mapping(); input.branches['superrich1965-112'].branchNo = branchNo;
    assert.throws(() => validateSuperrich1965Mapping(input, csv()), /branchNo/);
  }
});

test('orange first release excludes Partner company codes', () => {
  const input = mapping(); Object.assign(input.branches['superrich1965-112'], { branchNo: 'E52-01', companyCode: 'E52' });
  assert.throws(() => validateSuperrich1965Mapping(input, csv()), /Partner/);
});

test('orange mapping rejects draft markers and green contract fields', () => {
  const input = mapping(); input._draft = 'pending';
  assert.throws(() => validateSuperrich1965Mapping(input, csv()), /reviewed/);
  for (const patch of [{ _review: {} }, { branchCode: 'M01' }]) {
    const draft = mapping(); Object.assign(draft.branches['superrich1965-56'], patch);
    assert.throws(() => validateSuperrich1965Mapping(draft, csv()), /Unreviewed or unknown/);
  }
});

test('orange mapping rejects missing CSV branches', () => {
  assert.throws(() => validateSuperrich1965Mapping(mapping(), csv([row('superrich1965-56')])), /absent from snapshot/);
});

test('reverse orange inventory check rejects CSV rows missing from mapping', () => {
  assert.throws(() => validateSuperrich1965Mapping(mapping(), csv([
    row('superrich1965-56'), row('superrich1965-112'), row('superrich1965-110'),
  ])), /absent from mapping/);
});

test('orange inventory checks do not absorb green branches', () => {
  assert.equal(validateSuperrich1965Mapping(mapping(), csv([
    row('superrich1965-56'), row('superrich1965-112'), row('superrich-thailand-10'),
  ])).branchCount, 2);
});

test('orange mapping rejects duplicate snapshot Slugs', () => {
  assert.throws(() => validateSuperrich1965Mapping(mapping(), csv([
    row('superrich1965-56'), row('superrich1965-112'), row('superrich1965-56'),
  ])), /Duplicate snapshot Slug/);
});

test('orange branch rows require category, geography, status and paired coordinates', () => {
  for (const patch of [{ Category: 'Cafe' }, { 'Country Code': 'VN' }, { 'Destination Key': 'unknown' },
    { 'Verification Status': 'verified' }, { Lat: '' }, { Lng: '' }, { Lat: 'NaN' }, { Lng: 'Infinity' }, { Lat: '91' }, { Lng: '-181' }]) {
    assert.throws(() => validateSuperrich1965Mapping(mapping(), csv([row('superrich1965-56', patch), row('superrich1965-112')])));
  }
});

test('orange records require an orange source and a Google Maps link', () => {
  for (const patch of [{ 'Google Maps URL': '' }, { 'Google Maps URL': 'https://example.org/maps' },
    { 'Source URL': 'https://www.superrichthailand.com/exchange-rate' },
    { 'Source URL': 'https://www.superrich1965.com.evil.example/en/exchange-rate' }]) {
    assert.throws(() => validateSuperrich1965Mapping(mapping(), csv([row('superrich1965-56', patch), row('superrich1965-112')])));
  }
});

test('source evidence catches swapped branch numbers even when both remain unique', () => {
  const input = mapping(); input.branches['superrich1965-56'].branchNo = '51'; input.branches['superrich1965-112'].branchNo = '00';
  assert.throws(() => validateSuperrich1965Mapping(input, csv(), { sourceBranches: source() }), /identity mismatch/);
});

test('source evidence detects missing, duplicate and Partner rows', () => {
  for (const input of [[], [source()[0], source()[0]], [source()[0], { ...source()[1], group: 'partner' }], [null, source()[1]]]) {
    assert.throws(() => validateSuperrich1965Mapping(mapping(), csv(), { sourceBranches: input }));
  }
});

test('committed orange mapping and snapshot match reviewed source evidence (pre-push gate)', () => {
  const input = JSON.parse(readFileSync(new URL('../data/superrich1965-branches.json', import.meta.url), 'utf8'));
  const snapshot = readFileSync(new URL('../data/locations.csv', import.meta.url), 'utf8');
  const evidence = JSON.parse(readFileSync(new URL('../docs/evidence/superrich1965-branches-2026-09-10.json', import.meta.url), 'utf8'));
  const result = validateSuperrich1965Mapping(input, snapshot, { sourceBranches: evidence.includedBranches });
  assert.equal(result.branchCount, 38);
  assert.equal(input.branches['superrich1965-84'].branchNo, '55');
  assert.equal(input.branches['superrich1965-60'].branchNo, '50');
  assert.equal(input.branches['superrich1965-90'].branchNo, '17');
  assert.equal(input.branches['superrich1965-110'].branchNo, '64');
  assert.equal(input.branches['superrich1965-112'].branchNo, '51');
});
