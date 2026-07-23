#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { tokenizeCSV } from '../src/data/csv-parser.js';

export function validateFavoriteCompatibility(snapshotCsv, manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.ids)) {
    throw new Error('Legacy favorite ID manifest must use schemaVersion 1 and contain an ids array.');
  }

  const legacyIds = manifest.ids;
  if (manifest.count !== legacyIds.length) {
    throw new Error(
      `Legacy favorite ID manifest count is ${manifest.count}; found ${legacyIds.length} IDs.`
    );
  }

  const invalidLegacyId = legacyIds.find(
    (id) => typeof id !== 'string' || !id.trim() || id !== id.trim()
  );
  if (invalidLegacyId !== undefined) {
    throw new Error('Legacy favorite ID manifest contains an invalid ID.');
  }

  const duplicateLegacyIds = duplicates(legacyIds);
  if (duplicateLegacyIds.length > 0) {
    throw new Error(
      `Legacy favorite ID manifest contains duplicate IDs: ${duplicateLegacyIds.join(', ')}`
    );
  }

  const sortedLegacyIds = [...legacyIds].sort();
  if (legacyIds.some((id, index) => id !== sortedLegacyIds[index])) {
    throw new Error('Legacy favorite ID manifest must remain sorted.');
  }

  const rows = tokenizeCSV(snapshotCsv);
  const headers = rows[0] || [];
  const slugIndex = headers.indexOf('Slug');
  if (slugIndex === -1) {
    throw new Error('Notion location snapshot has no Slug column.');
  }

  const notionSlugs = rows
    .slice(1)
    .filter((row) => row.join('').trim())
    .map((row) => (row[slugIndex] || '').trim());

  if (notionSlugs.some((slug) => !slug)) {
    throw new Error('Notion location snapshot contains an empty Slug.');
  }

  const duplicateNotionSlugs = duplicates(notionSlugs);
  if (duplicateNotionSlugs.length > 0) {
    throw new Error(
      `Notion location snapshot contains duplicate Slugs: ${duplicateNotionSlugs.join(', ')}`
    );
  }

  const notionSlugSet = new Set(notionSlugs);
  const missingLegacyIds = legacyIds.filter((id) => !notionSlugSet.has(id));
  if (missingLegacyIds.length > 0) {
    throw new Error(
      `Notion snapshot is missing legacy favorite IDs: ${missingLegacyIds.join(', ')}`
    );
  }

  return {
    legacyIdCount: legacyIds.length,
    notionSlugCount: notionSlugs.length,
    newSlugCount: notionSlugs.length - legacyIds.length,
  };
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function main() {
  const snapshotPath = process.argv[2] || 'data/locations.csv';
  const manifestPath = process.argv[3] || 'data/legacy-favorite-ids.json';
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const result = validateFavoriteCompatibility(
    readFileSync(snapshotPath, 'utf8'),
    manifest
  );

  console.log(
    `Protected ${result.legacyIdCount} legacy favorite IDs across ` +
    `${result.notionSlugCount} Notion slugs (${result.newSlugCount} new).`
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
