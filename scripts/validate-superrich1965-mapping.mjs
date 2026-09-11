#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tokenizeCSV } from '../src/data/csv-parser.js';
import { isValidDestinationPair } from '../src/data/destinations.js';
import { normalizeBranchNo } from '../src/data/exchange-rates-1965.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const PREFIX = 'superrich1965-';

/** Check both sides of the orange Slug/officialId/branchNo join, including Paused rows. */
export function validateSuperrich1965Mapping(mapping, csv, { sourceBranches } = {}) {
  if (!isObject(mapping) || mapping.schemaVersion !== 1 || !isObject(mapping.branches) || '_draft' in mapping) {
    throw new Error('SuperRich 1965 mapping requires schemaVersion 1 and reviewed branches.');
  }
  const entries = Object.entries(mapping.branches);
  if (!entries.length) throw new Error('SuperRich 1965 mapping must contain branches.');
  const [header, ...rows] = tokenizeCSV(csv);
  const required = ['Slug', 'Category', 'Country Code', 'Destination Key', 'Verification Status', 'Lat', 'Lng', 'Google Maps URL', 'Source URL'];
  if (!header || required.some(key => !header.includes(key)) || new Set(header).size !== header.length) {
    throw new Error('SuperRich 1965 mapping requires unique formal snapshot headers.');
  }
  const locations = new Map();
  for (const cells of rows.filter(row => row.join('').trim())) {
    const row = Object.fromEntries(header.map((key, index) => [key, cells[index] ?? '']));
    if (locations.has(row.Slug)) throw new Error(`Duplicate snapshot Slug: ${row.Slug}`);
    locations.set(row.Slug, row);
  }
  const ids = new Set();
  const codes = new Set();
  let publishedCount = 0;
  for (const [slug, branch] of entries) {
    if (!isObject(branch) || !Number.isSafeInteger(branch.officialId) || branch.officialId <= 0) {
      throw new Error(`Invalid officialId for ${slug}`);
    }
    if (ids.has(branch.officialId)) throw new Error(`Duplicate officialId: ${branch.officialId}`);
    ids.add(branch.officialId);
    if (slug !== `${PREFIX}${branch.officialId}`) throw new Error(`Slug/officialId mismatch: ${slug}`);
    if ('_review' in branch || Object.keys(branch).some(key => !['officialId', 'branchNo', 'companyCode'].includes(key))) {
      throw new Error(`Unreviewed or unknown mapping fields: ${slug}`);
    }
    if (typeof branch.branchNo !== 'string' || !branch.branchNo || normalizeBranchNo(branch.branchNo) !== branch.branchNo) {
      throw new Error(`Invalid branchNo: ${slug}`);
    }
    // First release contains only the reviewed A04 Our Branch inventory.
    if (branch.companyCode !== 'A04' || !/^\d+$/.test(branch.branchNo)) {
      throw new Error(`Partner or unsupported company/branchNo: ${slug}`);
    }
    if (codes.has(branch.branchNo)) throw new Error(`Duplicate branchNo: ${branch.branchNo}`);
    codes.add(branch.branchNo);
    const row = locations.get(slug);
    if (!row) throw new Error(`Mapped Slug is absent from snapshot: ${slug}`);
    if (row.Category !== 'Currency Exchange') throw new Error(`Mapped Slug must be Currency Exchange: ${slug}`);
    if (row['Country Code'] !== 'TH' || !isValidDestinationPair('TH', row['Destination Key'])) {
      throw new Error(`Mapped branch needs a valid Thai destination: ${slug}`);
    }
    if (!['Paused', 'Published', 'Inactive'].includes(row['Verification Status'])) {
      throw new Error(`Invalid status: ${slug}`);
    }
    for (const [key, limit] of [['Lat', 90], ['Lng', 180]]) {
      if (!row[key].trim() || !Number.isFinite(Number(row[key])) || Math.abs(Number(row[key])) > limit) {
        throw new Error(`Mapped branch needs valid ${key}: ${slug}`);
      }
    }
    let maps;
    try { maps = new URL(row['Google Maps URL']); } catch { throw new Error(`Invalid Google Maps URL: ${slug}`); }
    if (maps.protocol !== 'https:' || maps.hostname !== 'www.google.com' || !/^\/maps(?:\/|$)/.test(maps.pathname)) {
      throw new Error(`Invalid Google Maps URL: ${slug}`);
    }
    const sources = row['Source URL'].split(/[,\s]+/).filter(Boolean);
    if (!sources.some(value => {
      try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'www.superrich1965.com'; } catch { return false; }
    })) throw new Error(`Missing orange official source: ${slug}`);
    if (row['Verification Status'] === 'Published') publishedCount += 1;
  }
  for (const slug of locations.keys()) {
    if (slug.startsWith(PREFIX) && !Object.hasOwn(mapping.branches, slug)) {
      throw new Error(`Orange snapshot Slug is absent from mapping: ${slug}`);
    }
  }
  if (sourceBranches !== undefined) {
    if (!Array.isArray(sourceBranches) || sourceBranches.length !== entries.length) {
      throw new Error('Source/mapping inventory mismatch.');
    }
    const seen = new Set();
    for (const source of sourceBranches) {
      if (!isObject(source)) throw new Error('Invalid source branch.');
      const branch = mapping.branches[`${PREFIX}${source.officialId}`];
      if (seen.has(source.officialId) || !branch || source.branchNo !== branch.branchNo || source.companyCode !== branch.companyCode || source.group !== 'main-branch') {
        throw new Error(`Source/mapping identity mismatch: ${source.officialId}`);
      }
      seen.add(source.officialId);
    }
  }
  return { schemaVersion: 1, branchCount: entries.length, publishedCount, unpublishedCount: entries.length - publishedCount };
}

function main(args) {
  if (args.length > 3) throw new Error('Usage: validate-superrich1965-mapping.mjs [mapping.json] [locations.csv] [reviewed-evidence.json]');
  const mapping = JSON.parse(readFileSync(args[0] || 'data/superrich1965-branches.json', 'utf8'));
  const csv = readFileSync(args[1] || 'data/locations.csv', 'utf8');
  const evidence = JSON.parse(readFileSync(args[2] || 'docs/evidence/superrich1965-branches-2026-09-10.json', 'utf8'));
  if (!Array.isArray(evidence.includedBranches)) throw new Error('Evidence must contain includedBranches.');
  console.log(JSON.stringify(validateSuperrich1965Mapping(mapping, csv, { sourceBranches: evidence.includedBranches }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
