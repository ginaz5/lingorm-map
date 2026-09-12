#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tokenizeCSV } from '../src/data/csv-parser.js';
import { isValidDestinationPair } from '../src/data/destinations.js';
import { normalizeBranchCode } from '../src/data/exchange-rates.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate the shared Slug → official identity mapping against the exported snapshot. */
export function validateSuperrichMapping(mapping, csv, { sourceIds } = {}) {
  if (!isObject(mapping) || mapping.schemaVersion !== 1 || !isObject(mapping.branches)) {
    throw new Error('SuperRich mapping must use schemaVersion 1 and a branches object.');
  }
  const entries = Object.entries(mapping.branches);
  if (entries.length === 0) throw new Error('SuperRich mapping must contain branches.');
  const [header, ...rows] = tokenizeCSV(csv);
  const required = ['Slug', 'Category', 'Country Code', 'Destination Key', 'Verification Status', 'Lat', 'Lng'];
  if (!header || required.some(key => !header.includes(key))) {
    throw new Error('SuperRich mapping requires the formal location snapshot headers.');
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
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Invalid mapping Slug: ${slug}`);
    if (!isObject(branch) || !Number.isSafeInteger(branch.officialId) || branch.officialId <= 0) {
      throw new Error(`Invalid officialId for ${slug}`);
    }
    if (ids.has(branch.officialId)) throw new Error(`Duplicate officialId: ${branch.officialId}`);
    ids.add(branch.officialId);
    if (normalizeBranchCode(branch.branchCode) !== branch.branchCode || !branch.branchCode) {
      throw new Error(`Missing or invalid branchCode for ${slug}`);
    }
    if (codes.has(branch.branchCode)) throw new Error(`Duplicate branchCode: ${branch.branchCode}`);
    codes.add(branch.branchCode);
    const row = locations.get(slug);
    if (!row) throw new Error(`Mapped Slug is absent from snapshot: ${slug}`);
    if (row.Category !== 'Currency Exchange') throw new Error(`Mapped Slug must be Currency Exchange: ${slug}`);
    if (row['Country Code'] !== 'TH' || !isValidDestinationPair('TH', row['Destination Key'])) {
      throw new Error(`Mapped branch needs a valid Thai destination: ${slug}`);
    }
    for (const [key, limit] of [['Lat', 90], ['Lng', 180]]) {
      if (!row[key].trim() || !Number.isFinite(Number(row[key])) || Math.abs(Number(row[key])) > limit) {
        throw new Error(`Mapped branch needs valid ${key}: ${slug}`);
      }
    }
    if (row['Verification Status'] === 'Published') publishedCount += 1;
  }
  if (sourceIds !== undefined) {
    if (!Array.isArray(sourceIds) || sourceIds.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(sourceIds).size !== sourceIds.length) {
      throw new Error('Source branch IDs must be unique positive safe integers.');
    }
    const sourceSet = new Set(sourceIds);
    const unknown = sourceIds.filter(id => !ids.has(id));
    const absent = [...ids].filter(id => !sourceSet.has(id));
    if (unknown.length || absent.length) {
      throw new Error(`Source/mapping mismatch: unknown source IDs [${unknown.join(', ')}]; absent source IDs [${absent.join(', ')}]`);
    }
  }
  return { schemaVersion: 1, branchCount: entries.length, publishedCount, unpublishedCount: entries.length - publishedCount };
}

function main(args) {
  if (args.length > 3) throw new Error('Usage: validate-superrich-mapping.mjs [mapping.json] [locations.csv] [branch-options.json]');
  const mapping = JSON.parse(readFileSync(args[0] || 'data/superrich-branches.json', 'utf8'));
  const csv = readFileSync(args[1] || 'data/locations.csv', 'utf8');
  const sourceIds = args[2] ? JSON.parse(readFileSync(args[2], 'utf8')).data?.map(row => row.value) : undefined;
  if (args[2] && !sourceIds) throw new Error('Source options file must contain data[].value.');
  console.log(JSON.stringify(validateSuperrichMapping(mapping, csv, { sourceIds }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
