#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  LOCATION_STATUSES,
  parseCSV,
  tokenizeCSV,
} from '../src/csv-parser.js';
import { PUBLIC_LOCATION_STATUSES } from '../src/render.js';
import { CSV_HEADER } from './export-snapshot.mjs';

export const EXPECTED_LOCATION_COUNT = 100;
export const DEFAULT_SNAPSHOT_POLICY_PATH = fileURLToPath(
  new URL('../data/location-snapshot-policy-v1.json', import.meta.url)
);

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function validateCanonicalStringList(value, field) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || !item.trim() || item !== item.trim())
  ) {
    throw new Error(`Location snapshot policy ${field} must be a non-empty string array.`);
  }
  const repeated = duplicates(value);
  if (repeated.length > 0) {
    throw new Error(
      `Location snapshot policy ${field} contains duplicates: ${repeated.join(', ')}`
    );
  }
}

export function loadSnapshotPolicy(policyPath = DEFAULT_SNAPSHOT_POLICY_PATH) {
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  if (
    policy?.schemaVersion !== 1 ||
    typeof policy.policyId !== 'string' ||
    !policy.policyId.trim() ||
    !Number.isInteger(policy.minimumRowCount) ||
    policy.minimumRowCount <= 0 ||
    typeof policy.protectedSlugManifest !== 'string' ||
    !policy.protectedSlugManifest.trim() ||
    !Array.isArray(policy.deletionManifest)
  ) {
    throw new Error('Location snapshot policy must use the complete schemaVersion 1 contract.');
  }

  validateCanonicalStringList(policy.allowedStatuses, 'allowedStatuses');
  validateCanonicalStringList(policy.publicStatuses, 'publicStatuses');

  const supportedStatuses = new Set(LOCATION_STATUSES);
  const unexpectedAllowed = policy.allowedStatuses.filter(
    (status) => !supportedStatuses.has(status)
  );
  if (unexpectedAllowed.length > 0) {
    throw new Error(
      `Location snapshot policy contains unsupported statuses: ${unexpectedAllowed.join(', ')}`
    );
  }
  if (
    policy.allowedStatuses.length !== LOCATION_STATUSES.length ||
    LOCATION_STATUSES.some(
      (status) => !policy.allowedStatuses.includes(status)
    )
  ) {
    throw new Error('Location snapshot policy must enumerate the complete three-status contract.');
  }
  if (
    policy.publicStatuses.length !== PUBLIC_LOCATION_STATUSES.length ||
    PUBLIC_LOCATION_STATUSES.some(
      (status) => !policy.publicStatuses.includes(status)
    )
  ) {
    throw new Error('Location snapshot policy publicStatuses do not match the UI allowlist.');
  }

  const manifestPath = resolve(
    dirname(policyPath),
    policy.protectedSlugManifest
  );
  const protectedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    protectedManifest?.schemaVersion !== 1 ||
    !Array.isArray(protectedManifest.ids) ||
    protectedManifest.count !== protectedManifest.ids.length
  ) {
    throw new Error('Protected Slug manifest must use the complete schemaVersion 1 contract.');
  }
  validateCanonicalStringList(protectedManifest.ids, 'protectedSlugManifest.ids');

  const deletionSlugs = [];
  for (const entry of policy.deletionManifest) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.slug !== 'string' ||
      !entry.slug.trim() ||
      !Number.isFinite(Date.parse(entry.approvedAt)) ||
      typeof entry.approvedBy !== 'string' ||
      !entry.approvedBy.trim() ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim()
    ) {
      throw new Error(
        'Each snapshot deletion approval requires slug, approvedAt, approvedBy, and reason.'
      );
    }
    deletionSlugs.push(entry.slug);
  }
  const repeatedDeletions = duplicates(deletionSlugs);
  if (repeatedDeletions.length > 0) {
    throw new Error(
      `Snapshot deletion manifest contains duplicate Slugs: ${repeatedDeletions.join(', ')}`
    );
  }
  const protectedSet = new Set(protectedManifest.ids);
  const unknownDeletions = deletionSlugs.filter((slug) => !protectedSet.has(slug));
  if (unknownDeletions.length > 0) {
    throw new Error(
      `Snapshot deletion manifest references unprotected Slugs: ${unknownDeletions.join(', ')}`
    );
  }

  return {
    ...policy,
    protectedSlugs: protectedManifest.ids,
  };
}

function normalizedPolicy(policyOrExpectedCount) {
  if (typeof policyOrExpectedCount === 'number') {
    return {
      policyId: 'legacy-exact-count',
      exactRowCount: policyOrExpectedCount,
      minimumRowCount: policyOrExpectedCount,
      protectedSlugs: [],
      allowedStatuses: [...LOCATION_STATUSES],
      publicStatuses: [...PUBLIC_LOCATION_STATUSES],
      deletionManifest: [],
    };
  }
  return policyOrExpectedCount || loadSnapshotPolicy();
}

function isGoogleMapsUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return (
      host === 'maps.app.goo.gl' ||
      host === 'maps.google.com' ||
      host === 'www.google.com' ||
      host.endsWith('.google.com')
    );
  } catch {
    return false;
  }
}

function validateCoordinates(dataRows, headers, rawStatuses) {
  const latIndex = headers.indexOf('Lat');
  const lngIndex = headers.indexOf('Lng');
  const mapsIndex = headers.indexOf('Google Maps URL');

  for (let index = 0; index < dataRows.length; index += 1) {
    const rowNumber = index + 2;
    const latRaw = (dataRows[index][latIndex] || '').trim();
    const lngRaw = (dataRows[index][lngIndex] || '').trim();
    const hasLat = Boolean(latRaw);
    const hasLng = Boolean(lngRaw);
    if (hasLat !== hasLng) {
      throw new Error(
        `Location snapshot row ${rowNumber} must provide both Lat and Lng or neither.`
      );
    }
    if (hasLat) {
      const lat = Number(latRaw);
      const lng = Number(lngRaw);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        throw new Error(
          `Location snapshot row ${rowNumber} has invalid coordinates.`
        );
      }
    }
    if (rawStatuses[index] === 'Published') {
      if (!hasLat) {
        throw new Error(
          `Published location snapshot row ${rowNumber} requires Lat and Lng.`
        );
      }
      const mapsUrl = (dataRows[index][mapsIndex] || '').trim();
      if (!isGoogleMapsUrl(mapsUrl)) {
        throw new Error(
          `Published location snapshot row ${rowNumber} requires a valid Google Maps URL.`
        );
      }
    }
  }
}

export function validateLocationSnapshot(
  csv,
  policyOrExpectedCount = loadSnapshotPolicy()
) {
  const policy = normalizedPolicy(policyOrExpectedCount);
  const rows = tokenizeCSV(csv);
  const headers = rows[0] || [];
  if (
    headers.length !== CSV_HEADER.length ||
    headers.some((header, index) => header.replace(/^\uFEFF/, '') !== CSV_HEADER[index])
  ) {
    throw new Error('Location snapshot does not match the stable CSV header contract.');
  }

  const dataRows = rows.slice(1).filter((row) => row.join('').trim());
  if (
    Number.isInteger(policy.exactRowCount) &&
    dataRows.length !== policy.exactRowCount
  ) {
    throw new Error(
      `Location snapshot must contain exactly ${policy.exactRowCount} rows; found ${dataRows.length}.`
    );
  }
  const minimumRowCount =
    policy.minimumRowCount - (policy.deletionManifest || []).length;
  if (dataRows.length < minimumRowCount) {
    throw new Error(
      `Location snapshot must contain at least ${minimumRowCount} rows; found ${dataRows.length}.`
    );
  }

  const slugIndex = headers.indexOf('Slug');
  const slugs = dataRows.map((row) => (row[slugIndex] || '').trim());
  const missingSlugIndex = slugs.findIndex((slug) => !slug);
  if (missingSlugIndex !== -1) {
    throw new Error(`Location snapshot row ${missingSlugIndex + 2} has no Slug.`);
  }
  const repeatedSlugs = duplicates(slugs);
  if (repeatedSlugs.length > 0) {
    throw new Error(
      `Location snapshot contains duplicate Slug: ${repeatedSlugs.join(', ')}`
    );
  }

  const deletedSlugs = new Set(
    (policy.deletionManifest || []).map((entry) => entry.slug)
  );
  const slugSet = new Set(slugs);
  const missingProtectedSlugs = (policy.protectedSlugs || []).filter(
    (slug) => !deletedSlugs.has(slug) && !slugSet.has(slug)
  );
  if (missingProtectedSlugs.length > 0) {
    throw new Error(
      `Location snapshot is missing protected Slugs: ${missingProtectedSlugs.join(', ')}`
    );
  }

  const statusIndex = headers.indexOf('Verification Status');
  const rawStatuses = dataRows.map((row) => (row[statusIndex] || '').trim());
  const allowedStatuses = new Set(policy.allowedStatuses);
  for (let index = 0; index < rawStatuses.length; index += 1) {
    if (!allowedStatuses.has(rawStatuses[index])) {
      throw new Error(
        `Location snapshot row ${index + 2} has unsupported raw status: ` +
        `${rawStatuses[index] || '(blank)'}`
      );
    }
  }

  validateCoordinates(dataRows, headers, rawStatuses);

  const parsed = parseCSV(csv);
  if (!parsed || parsed.length !== dataRows.length) {
    throw new Error('Location snapshot could not be parsed into the expected location rows.');
  }

  const statusCounts = Object.fromEntries(
    [...allowedStatuses]
      .map((status) => [
        status,
        rawStatuses.filter((value) => value === status).length,
      ])
      .filter(([, count]) => count > 0)
  );
  const publicStatuses = new Set(policy.publicStatuses);
  return {
    policyId: policy.policyId,
    rowCount: parsed.length,
    uniqueSlugCount: slugSet.size,
    publicRowCount: rawStatuses.filter((status) => publicStatuses.has(status)).length,
    statusCounts,
  };
}

function main() {
  const snapshotPath = process.argv[2] || 'data/locations.csv';
  const policyPath = process.argv[3] || DEFAULT_SNAPSHOT_POLICY_PATH;
  const result = validateLocationSnapshot(
    readFileSync(snapshotPath, 'utf8'),
    loadSnapshotPolicy(policyPath)
  );
  console.log(
    `Validated ${result.rowCount} locations with ${result.uniqueSlugCount} unique slugs ` +
    `under ${result.policyId}; ${result.publicRowCount} are eligible for UI display.`
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
