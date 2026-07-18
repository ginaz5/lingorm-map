#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { parseCSV, tokenizeCSV } from '../src/csv-parser.js';
import { CSV_HEADER } from './export-snapshot.mjs';

export const EXPECTED_LOCATION_COUNT = 98;

export function validateLocationSnapshot(csv, expectedCount = EXPECTED_LOCATION_COUNT) {
  const rows = tokenizeCSV(csv);
  const headers = rows[0] || [];
  if (
    headers.length !== CSV_HEADER.length ||
    headers.some((header, index) => header.replace(/^\uFEFF/, '') !== CSV_HEADER[index])
  ) {
    throw new Error('Location snapshot does not match the stable CSV header contract.');
  }

  const dataRows = rows.slice(1).filter((row) => row.join('').trim());
  if (dataRows.length !== expectedCount) {
    throw new Error(
      `Location snapshot must contain exactly ${expectedCount} rows; found ${dataRows.length}.`
    );
  }

  const slugIndex = headers.indexOf('Slug');
  const slugs = dataRows.map((row) => (row[slugIndex] || '').trim());
  const missingSlugIndex = slugs.findIndex((slug) => !slug);
  if (missingSlugIndex !== -1) {
    throw new Error(`Location snapshot row ${missingSlugIndex + 2} has no Slug.`);
  }

  const seen = new Set();
  for (const slug of slugs) {
    if (seen.has(slug)) {
      throw new Error(`Location snapshot contains duplicate Slug: ${slug}`);
    }
    seen.add(slug);
  }

  const parsed = parseCSV(csv);
  if (!parsed || parsed.length !== expectedCount) {
    throw new Error('Location snapshot could not be parsed into the expected location rows.');
  }

  return { rowCount: parsed.length, uniqueSlugCount: seen.size };
}

function main() {
  const snapshotPath = process.argv[2] || 'data/locations.csv';
  const result = validateLocationSnapshot(readFileSync(snapshotPath, 'utf8'));
  console.log(
    `Validated ${result.rowCount} locations with ${result.uniqueSlugCount} unique slugs.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
