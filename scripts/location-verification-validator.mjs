import { TARGET_STATUSES } from './location-verification-core.mjs';
import {
  LOCATION_TYPES,
  tokenizeCSV,
} from '../src/data/csv-parser.js';
import {
  COUNTRY_CODES,
  DESTINATION_KEYS,
  isValidDestinationPair,
} from '../src/data/destinations.js';
import { CSV_HEADER } from './export-snapshot.mjs';
import { isGoogleMapsUrl } from './validate-location-snapshot.mjs';

function issue(layer, code, message, { slug = null, field = null } = {}) {
  return { layer, code, slug, field, message };
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\r\n?/g, '\n')
    .trim()
    .normalize('NFC');
}

function rowLabel(row) {
  return normalizeText(row.Slug) || normalizeText(row.Name) || '(missing slug)';
}

function validateCoordinates(row, issues) {
  const slug = rowLabel(row);
  const hasLat = row.Lat !== null && row.Lat !== undefined && row.Lat !== '';
  const hasLng = row.Lng !== null && row.Lng !== undefined && row.Lng !== '';
  if (hasLat !== hasLng) {
    issues.push(
      issue(
        'live',
        'COORDINATE_PAIR_INCOMPLETE',
        'Lat and Lng must either both exist or both be blank',
        { slug }
      )
    );
    return;
  }
  if (!hasLat) return;
  const lat = Number(row.Lat);
  const lng = Number(row.Lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    issues.push(
      issue('live', 'LAT_INVALID', `Invalid latitude: ${row.Lat}`, {
        slug,
        field: 'Lat',
      })
    );
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    issues.push(
      issue('live', 'LNG_INVALID', `Invalid longitude: ${row.Lng}`, {
        slug,
        field: 'Lng',
      })
    );
  }
}

function validateGeography(row, issues) {
  const slug = rowLabel(row);
  const countryCode = normalizeText(row['Country Code']);
  const destinationKey = normalizeText(row['Destination Key']);
  const hasCountry = Boolean(countryCode);
  const hasDestination = Boolean(destinationKey);

  if (row.Status === 'Published' && (!hasCountry || !hasDestination)) {
    issues.push(
      issue(
        'live',
        'PUBLISHED_GEOGRAPHY_MISSING',
        'Published requires Country Code and Destination Key',
        { slug }
      )
    );
    return;
  }
  if (hasCountry !== hasDestination) {
    issues.push(
      issue(
        'live',
        'GEOGRAPHY_PAIR_INCOMPLETE',
        'Country Code and Destination Key must either both exist or both be blank',
        { slug }
      )
    );
    return;
  }
  if (!hasCountry) return;
  if (!COUNTRY_CODES.includes(countryCode)) {
    issues.push(
      issue(
        'live',
        'COUNTRY_CODE_INVALID',
        `Unsupported Country Code: ${countryCode}`,
        { slug, field: 'Country Code' }
      )
    );
  }
  if (!DESTINATION_KEYS.includes(destinationKey)) {
    issues.push(
      issue(
        'live',
        'DESTINATION_KEY_INVALID',
        `Unsupported Destination Key: ${destinationKey}`,
        { slug, field: 'Destination Key' }
      )
    );
  }
  if (
    COUNTRY_CODES.includes(countryCode) &&
    DESTINATION_KEYS.includes(destinationKey) &&
    !isValidDestinationPair(countryCode, destinationKey)
  ) {
    issues.push(
      issue(
        'live',
        'GEOGRAPHY_PAIR_MISMATCH',
        `${countryCode} does not contain destination ${destinationKey}`,
        { slug }
      )
    );
  }
}

function validatePolicy(rows, slugs, snapshotPolicy, issues) {
  if (
    !snapshotPolicy ||
    !Number.isInteger(snapshotPolicy.minimumRowCount) ||
    !Array.isArray(snapshotPolicy.protectedSlugs) ||
    !Array.isArray(snapshotPolicy.deletionManifest)
  ) {
    throw new Error('Snapshot policy is required for live validation');
  }

  const approvedDeletions = new Set(
    snapshotPolicy.deletionManifest.map(({ slug }) => slug)
  );
  const minimumRowCount =
    snapshotPolicy.minimumRowCount - approvedDeletions.size;
  if (rows.length < minimumRowCount) {
    issues.push(
      issue(
        'policy',
        'LOCATION_COUNT_BELOW_MINIMUM',
        `Expected at least ${minimumRowCount} rows, found ${rows.length}`
      )
    );
  }

  for (const slug of snapshotPolicy.protectedSlugs) {
    if (!approvedDeletions.has(slug) && !slugs.has(slug)) {
      issues.push(
        issue(
          'policy',
          'PROTECTED_SLUG_MISSING',
          'Protected favorite Slug is missing from live Notion',
          { slug, field: 'Slug' }
        )
      );
    }
  }

  return {
    policyId: snapshotPolicy.policyId,
    minimumRowCount,
    protectedSlugCount: snapshotPolicy.protectedSlugs.length,
  };
}

export function validateTargetRows(rows, { snapshotPolicy } = {}) {
  const issues = [];
  const warnings = [];
  const slugs = new Map();
  const placeIds = new Map();
  const statusCounts = {};
  const typeCounts = {};
  const supportedTypes = new Set(LOCATION_TYPES);

  for (const row of rows) {
    const slug = rowLabel(row);
    statusCounts[row.Status || '(blank)'] =
      (statusCounts[row.Status || '(blank)'] || 0) + 1;
    const type = normalizeText(row.Type);
    typeCounts[type || '(blank)'] =
      (typeCounts[type || '(blank)'] || 0) + 1;

    if (!type) {
      warnings.push(
        issue('live', 'TYPE_MISSING', 'Type is blank', {
          slug,
          field: 'Type',
        })
      );
    } else if (!supportedTypes.has(type)) {
      issues.push(
        issue(
          'live',
          'TYPE_INVALID',
          `Unsupported Type: ${type}`,
          { slug, field: 'Type' }
        )
      );
    }

    const canonicalSlug = normalizeText(row.Slug);
    if (!canonicalSlug) {
      issues.push(
        issue('live', 'SLUG_MISSING', 'Slug is required', {
          slug,
          field: 'Slug',
        })
      );
    } else {
      const duplicate = slugs.get(canonicalSlug);
      if (duplicate) {
        issues.push(
          issue(
            'live',
            'SLUG_DUPLICATE',
            `Duplicate Slug shared with ${rowLabel(duplicate)}`,
            { slug, field: 'Slug' }
          )
        );
      } else {
        slugs.set(canonicalSlug, row);
      }
    }

    if (!normalizeText(row.Name)) {
      issues.push(
        issue('live', 'NAME_MISSING', 'Name is required', {
          slug,
          field: 'Name',
        })
      );
    }
    if (!TARGET_STATUSES.has(row.Status)) {
      issues.push(
        issue(
          'live',
          'STATUS_INVALID',
          `Unsupported Status: ${row.Status || '(blank)'}`,
          { slug, field: 'Status' }
        )
      );
    }

    validateCoordinates(row, issues);
    validateGeography(row, issues);

    const hasLat =
      row.Lat !== null &&
      row.Lat !== undefined &&
      row.Lat !== '' &&
      Number.isFinite(Number(row.Lat));
    const hasLng =
      row.Lng !== null &&
      row.Lng !== undefined &&
      row.Lng !== '' &&
      Number.isFinite(Number(row.Lng));
    if (row.Status === 'Published') {
      if (!hasLat || !hasLng) {
        issues.push(
          issue(
            'live',
            'PUBLISHED_COORDINATES_MISSING',
            'Published requires Lat and Lng',
            { slug }
          )
        );
      }
      if (!isGoogleMapsUrl(row['Google Maps URL'])) {
        issues.push(
          issue(
            'live',
            'PUBLISHED_MAP_URL_INVALID',
            'Published requires a valid Google Maps URL',
            { slug, field: 'Google Maps URL' }
          )
        );
      }
      if (!normalizeText(row['Last Verified'])) {
        issues.push(
          issue(
            'live',
            'PUBLISHED_LAST_VERIFIED_MISSING',
            'Published requires Last Verified',
            { slug, field: 'Last Verified' }
          )
        );
      }
    }

    if (
      row['Review Needed'] === '__YES__' &&
      !normalizeText(row['Verification Note'])
    ) {
      warnings.push(
        issue(
          'live',
          'REVIEW_NOTE_MISSING',
          'Review Needed is checked but Verification Note is blank',
          { slug, field: 'Verification Note' }
        )
      );
    }

    if (row.Status === 'Paused' && row['Review Needed'] !== '__YES__') {
      issues.push(
        issue(
          'live',
          'QUEUE_STATUS_MISMATCH',
          'Paused requires Review Needed = TRUE',
          { slug, field: 'Review Needed' }
        )
      );
    }
    if (row.Status === 'Inactive') {
      if (row['Review Needed'] !== '__NO__') {
        issues.push(
          issue(
            'live',
            'INACTIVE_REVIEW_MISMATCH',
            'Inactive requires Review Needed = FALSE',
            { slug, field: 'Review Needed' }
          )
        );
      }
      if (!normalizeText(row['Last Verified'])) {
        issues.push(
          issue(
            'live',
            'INACTIVE_AUDIT_MISSING',
            'Inactive requires Last Verified',
            { slug, field: 'Last Verified' }
          )
        );
      }
    }

    const placeId = normalizeText(row['Google Place ID']);
    if (placeId) {
      const duplicate = placeIds.get(placeId);
      if (duplicate) {
        issues.push(
          issue(
            'live',
            'PLACE_ID_DUPLICATE',
            `Google Place ID is also used by ${rowLabel(duplicate)}`,
            { slug, field: 'Google Place ID' }
          )
        );
      } else {
        placeIds.set(placeId, row);
      }
    }
  }

  const policy = validatePolicy(rows, slugs, snapshotPolicy, issues);
  return { issues, warnings, statusCounts, typeCounts, policy };
}

function snapshotTable(csv, label) {
  const rows = tokenizeCSV(csv);
  const headers = (rows[0] || []).map((header) =>
    header.replace(/^\uFEFF/, '')
  );
  if (
    headers.length !== CSV_HEADER.length ||
    headers.some((header, index) => header !== CSV_HEADER[index])
  ) {
    throw new Error(`${label} does not match the stable CSV header contract`);
  }

  const slugIndex = headers.indexOf('Slug');
  const bySlug = new Map();
  for (const row of rows.slice(1).filter((value) => value.join('').trim())) {
    if (row.length !== headers.length) {
      throw new Error(
        `${label} contains a row with ${row.length} fields; expected ${headers.length}`
      );
    }
    const slug = row[slugIndex];
    if (!normalizeText(slug)) {
      throw new Error(`${label} contains a row without Slug`);
    }
    if (bySlug.has(slug)) {
      throw new Error(`${label} contains duplicate Slug: ${slug}`);
    }
    bySlug.set(slug, [...row]);
  }
  return { headers, bySlug };
}

export function reconcileSnapshotCsv(liveCsv, committedCsv) {
  const issues = [];
  let live;
  let committed;
  try {
    live = snapshotTable(liveCsv, 'Live Notion export');
    committed = snapshotTable(committedCsv, 'Committed snapshot');
  } catch (error) {
    issues.push(
      issue(
        'snapshot',
        'SNAPSHOT_CONTRACT_INVALID',
        error instanceof Error ? error.message : 'Snapshot contract is invalid'
      )
    );
    return {
      ok: false,
      issues,
      liveRowCount: live?.bySlug.size || 0,
      committedRowCount: committed?.bySlug.size || 0,
      addedSlugCount: 0,
      removedSlugCount: 0,
      changedSlugCount: 0,
      changedFieldCount: 0,
    };
  }

  const addedSlugs = [...live.bySlug.keys()]
    .filter((slug) => !committed.bySlug.has(slug))
    .sort();
  const removedSlugs = [...committed.bySlug.keys()]
    .filter((slug) => !live.bySlug.has(slug))
    .sort();
  for (const slug of addedSlugs) {
    issues.push(
      issue(
        'snapshot',
        'SNAPSHOT_SLUG_MISSING',
        'Live Notion Slug is not present in committed data/locations.csv',
        { slug, field: 'Slug' }
      )
    );
  }
  for (const slug of removedSlugs) {
    issues.push(
      issue(
        'snapshot',
        'NOTION_SLUG_MISSING',
        'Committed snapshot Slug is not present in live Notion',
        { slug, field: 'Slug' }
      )
    );
  }

  const changedSlugs = new Set();
  let changedFieldCount = 0;
  const slugIndex = CSV_HEADER.indexOf('Slug');
  for (const [slug, liveRow] of live.bySlug) {
    const committedRow = committed.bySlug.get(slug);
    if (!committedRow) continue;
    for (let index = 0; index < CSV_HEADER.length; index += 1) {
      if (index === slugIndex || liveRow[index] === committedRow[index]) {
        continue;
      }
      changedSlugs.add(slug);
      changedFieldCount += 1;
      issues.push(
        issue(
          'snapshot',
          'SNAPSHOT_FIELD_MISMATCH',
          'Live Notion export differs from committed data/locations.csv',
          { slug, field: CSV_HEADER[index] }
        )
      );
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    liveRowCount: live.bySlug.size,
    committedRowCount: committed.bySlug.size,
    addedSlugCount: addedSlugs.length,
    removedSlugCount: removedSlugs.length,
    changedSlugCount: changedSlugs.size,
    changedFieldCount,
  };
}
