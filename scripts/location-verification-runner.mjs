#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  unlink,
} from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  COORDINATE_TYPES,
  FORMAL_DATA_SOURCE_ID,
  REVIEW_DECISIONS,
  TARGET_STATUSES,
  assertAllowedDataSource,
  basisRevision,
  buildCandidatePatch,
  buildCompletedApplyPatch,
  buildPendingApplyPatch,
  buildStatusMigrationPatch,
  haversineMeters,
  mapsUrlForPlaceId,
  validateCandidatePayload,
  workflowRevision,
} from './location-verification-core.mjs';
import {
  EXPECTED_LOCATION_COUNT,
  validateTargetRows,
} from './location-verification-validator.mjs';
import {
  CURRENT_FORMAL_BASELINE_FIELDS,
  CURRENT_FORMAL_WORKFLOW_FIELDS,
  inspectCurrentFormalLocationProperties,
} from './formal-location-current-schema.mjs';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2025-09-03';
const PLACES_API_BASE = 'https://places.googleapis.com/v1';
const LEGACY_PLACES_API_BASE = 'https://maps.googleapis.com/maps/api/place';
const REVIEW_TTL_DAYS = 30;
const APPLY_LOCK_ROOT = join(
  tmpdir(),
  'lingorm-bangkok-map-location-verification-locks'
);
export const FORMAL_FIELDS = [
  'Name',
  'Name ZH',
  'Thai / Alt Name',
  'Branch Group',
  'Category',
  'Google Maps URL',
  'Google Place ID',
  'Coordinates Approx',
  'Lat',
  'Lng',
  'Notes EN',
  'Notes ZH',
  'Origin',
  'Slug',
  'Source Tags',
  'Source URLs',
  'Status',
];
const ACTIVE_FORMAL_FIELDS = CURRENT_FORMAL_BASELINE_FIELDS;
const ACTIVE_FORMAL_WORKFLOW_FIELDS = CURRENT_FORMAL_WORKFLOW_FIELDS;
// There is a single Notion Locations database (the "Locations (PoC)"
// workbench used during the 2026-07 migration has been deleted); every
// runner action targets FORMAL_DATA_SOURCE_ID with the one NOTION_API_KEY
// credential, which has both read and write access.
const RUNNER_DATA_SOURCE_IDS = new Set([FORMAL_DATA_SOURCE_ID]);

function assertSupportedRunnerDataSource(dataSourceId) {
  if (!RUNNER_DATA_SOURCE_IDS.has(dataSourceId)) {
    throw new Error(
      `Refusing runner action: data source ${dataSourceId} is not an approved Locations data source`
    );
  }
}

function assertWriteTarget({ dataSourceId, expectedDataSourceId }) {
  assertSupportedRunnerDataSource(expectedDataSourceId);
  assertAllowedDataSource(dataSourceId, expectedDataSourceId);
}

function requireNotionApiKey(notionApiKey) {
  if (!notionApiKey) throw new Error('Missing NOTION_API_KEY');
  return notionApiKey;
}

const PLACE_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'businessStatus',
  'types',
].join(',');

const TEXT_SEARCH_FIELD_MASK = PLACE_FIELD_MASK
  .split(',')
  .map((field) => `places.${field}`)
  .join(',');

function normalizeId(value) {
  return String(value || '').replaceAll('-', '').toLowerCase();
}

function lockOwnerDescription(owner) {
  const host = owner?.hostname ? ` host=${owner.hostname}` : '';
  const pid = Number.isInteger(owner?.pid) ? ` pid=${owner.pid}` : '';
  const createdAt = owner?.createdAt ? ` since=${owner.createdAt}` : '';
  return `${host}${pid}${createdAt}`.trim() || 'unknown owner';
}

function pageApplyLockPaths(pageId, lockRoot) {
  const normalizedPageId = normalizeId(pageId);
  if (!/^[0-9a-f]{32}$/.test(normalizedPageId)) {
    throw new Error(`Invalid page ID for apply lock: ${pageId}`);
  }
  const lockPath = join(lockRoot, `${normalizedPageId}.lock`);
  return {
    normalizedPageId,
    lockPath,
    maintenancePath: `${lockPath}.maintenance`,
  };
}

async function readJsonFile(path) {
  try {
    const raw = await readFile(path, 'utf8');
    return { exists: true, raw, value: JSON.parse(raw), error: null };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, raw: null, value: null, error: null };
    }
    return {
      exists: true,
      raw: null,
      value: null,
      error,
    };
  }
}

function validApplyLockOwner(owner, normalizedPageId) {
  return Boolean(
    owner &&
      typeof owner === 'object' &&
      !Array.isArray(owner) &&
      owner.schemaVersion === 2 &&
      typeof owner.token === 'string' &&
      owner.token.length > 0 &&
      Number.isInteger(owner.pid) &&
      owner.pid > 0 &&
      owner.pageId === normalizedPageId &&
      typeof owner.hostname === 'string' &&
      owner.hostname.length > 0 &&
      Number.isFinite(Date.parse(owner.createdAt))
  );
}

function processIsAlive(pid, processKillImpl) {
  try {
    processKillImpl(pid, 0);
    return { known: true, alive: true };
  } catch (error) {
    if (error?.code === 'ESRCH') return { known: true, alive: false };
    if (error?.code === 'EPERM') return { known: true, alive: true };
    return { known: false, alive: null, error };
  }
}

async function assertNoLockMaintenance({
  maintenancePath,
  normalizedPageId,
}) {
  const maintenance = await readJsonFile(maintenancePath);
  if (!maintenance.exists) return;
  throw new Error(
    `Apply lock maintenance already in progress for page ${normalizedPageId} ` +
      `(${lockOwnerDescription(maintenance.value)})`
  );
}

export async function acquirePageApplyLock({
  pageId,
  lockRoot = APPLY_LOCK_ROOT,
  randomUUIDImpl = randomUUID,
  ownerPid = process.pid,
  hostnameImpl = hostname,
}) {
  const { normalizedPageId, lockPath, maintenancePath } =
    pageApplyLockPaths(pageId, lockRoot);
  await mkdir(lockRoot, { recursive: true, mode: 0o700 });
  await assertNoLockMaintenance({ maintenancePath, normalizedPageId });
  const token = randomUUIDImpl();
  const owner = {
    schemaVersion: 2,
    token,
    pid: ownerPid,
    pageId: normalizedPageId,
    hostname: hostnameImpl(),
    createdAt: new Date().toISOString(),
  };

  let handle;
  let created = false;
  try {
    handle = await open(lockPath, 'wx', 0o600);
    created = true;
    await handle.writeFile(JSON.stringify(owner));
    await handle.close();
    handle = null;
    try {
      await assertNoLockMaintenance({ maintenancePath, normalizedPageId });
    } catch (error) {
      const current = await readJsonFile(lockPath);
      if (current.value?.token === token) await unlink(lockPath).catch(() => {});
      throw error;
    }
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code !== 'EEXIST') {
      if (created) await unlink(lockPath).catch(() => {});
      throw error;
    }
    let existingOwner = null;
    try {
      existingOwner = JSON.parse(await readFile(lockPath, 'utf8'));
    } catch {
      // A malformed lock still blocks writes; fail closed.
    }
    throw new Error(
      `Apply lock already held for page ${normalizedPageId} (${lockOwnerDescription(existingOwner)}). ` +
        `Use lock inspect before attempting a confirmed stale-lock clear.`
    );
  }

  let released = false;
  const releaseSync = () => {
    if (released) return;
    try {
      const current = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (current.token === token) unlinkSync(lockPath);
    } catch {
      // The lock may already have been released.
    }
    released = true;
  };
  const release = async () => {
    if (released) return;
    try {
      const current = JSON.parse(await readFile(lockPath, 'utf8'));
      if (current.token === token) await unlink(lockPath);
    } catch {
      // The lock may already have been released.
    }
    released = true;
    process.off('exit', releaseSync);
  };
  process.once('exit', releaseSync);

  return {
    lockPath,
    owner,
    release,
  };
}

export async function inspectPageApplyLock({
  pageId,
  lockRoot = APPLY_LOCK_ROOT,
  hostnameImpl = hostname,
  processKillImpl = process.kill.bind(process),
}) {
  const { normalizedPageId, lockPath, maintenancePath } =
    pageApplyLockPaths(pageId, lockRoot);
  const [lock, maintenance] = await Promise.all([
    readJsonFile(lockPath),
    readJsonFile(maintenancePath),
  ]);
  const result = {
    pageId: normalizedPageId,
    lockPath,
    maintenancePath,
    maintenancePresent: maintenance.exists,
    state: 'absent',
    clearable: false,
    owner: null,
    reason: 'No apply lock exists',
  };
  if (maintenance.exists) {
    result.state = 'maintenance';
    result.reason = 'Lock maintenance is already in progress';
    result.owner = maintenance.value;
    return result;
  }
  if (!lock.exists) return result;
  if (
    lock.error ||
    !validApplyLockOwner(lock.value, normalizedPageId)
  ) {
    result.state = 'malformed';
    result.reason =
      lock.error?.message || 'Lock metadata is malformed or unsupported';
    return result;
  }
  result.owner = lock.value;
  if (lock.value.hostname !== hostnameImpl()) {
    result.state = 'remote';
    result.reason = 'Lock belongs to another hostname';
    return result;
  }
  const processState = processIsAlive(lock.value.pid, processKillImpl);
  if (!processState.known) {
    result.state = 'unknown';
    result.reason = `Could not determine owner process state: ${processState.error?.message || 'unknown error'}`;
    return result;
  }
  if (processState.alive) {
    result.state = 'active';
    result.reason = 'Owner process is still alive';
    return result;
  }
  result.state = 'stale';
  result.clearable = true;
  result.reason = 'Owner process no longer exists on this hostname';
  return result;
}

export async function clearPageApplyLock({
  pageId,
  confirm = false,
  lockRoot = APPLY_LOCK_ROOT,
  randomUUIDImpl = randomUUID,
  ownerPid = process.pid,
  hostnameImpl = hostname,
  processKillImpl = process.kill.bind(process),
  beforeUnlink = async () => {},
}) {
  if (!confirm) {
    throw new Error('Clearing an apply lock requires --confirm');
  }
  const { normalizedPageId, lockPath, maintenancePath } =
    pageApplyLockPaths(pageId, lockRoot);
  await mkdir(lockRoot, { recursive: true, mode: 0o700 });
  const maintenanceToken = randomUUIDImpl();
  const maintenanceOwner = {
    schemaVersion: 1,
    token: maintenanceToken,
    pid: ownerPid,
    pageId: normalizedPageId,
    hostname: hostnameImpl(),
    createdAt: new Date().toISOString(),
  };
  let maintenanceHandle;
  try {
    maintenanceHandle = await open(maintenancePath, 'wx', 0o600);
    await maintenanceHandle.writeFile(JSON.stringify(maintenanceOwner));
    await maintenanceHandle.close();
    maintenanceHandle = null;
  } catch (error) {
    await maintenanceHandle?.close().catch(() => {});
    if (error?.code === 'EEXIST') {
      const existing = await readJsonFile(maintenancePath);
      throw new Error(
        `Apply lock maintenance already in progress for page ${normalizedPageId} ` +
          `(${lockOwnerDescription(existing.value)})`
      );
    }
    throw error;
  }

  try {
    const inspected = await inspectPageApplyLock({
      pageId: normalizedPageId,
      lockRoot,
      hostnameImpl,
      processKillImpl,
    });
    if (inspected.state === 'maintenance') {
      const lock = await readJsonFile(lockPath);
      if (!lock.exists) {
        return {
          ...inspected,
          state: 'absent',
          reason: 'No apply lock exists',
          cleared: false,
        };
      }
      if (!validApplyLockOwner(lock.value, normalizedPageId)) {
        throw new Error('Apply lock is malformed; refusing to clear');
      }
      if (lock.value.hostname !== hostnameImpl()) {
        throw new Error('Apply lock belongs to another hostname; refusing to clear');
      }
      const processState = processIsAlive(lock.value.pid, processKillImpl);
      if (!processState.known) {
        throw new Error('Apply lock owner process state is unknown; refusing to clear');
      }
      if (processState.alive) {
        throw new Error('Apply lock owner process is still alive; refusing to clear');
      }
      inspected.owner = lock.value;
      inspected.state = 'stale';
      inspected.clearable = true;
      inspected.reason = 'Owner process no longer exists on this hostname';
    }

    if (inspected.state === 'absent') {
      return { ...inspected, cleared: false };
    }
    if (inspected.state !== 'stale' || !inspected.clearable) {
      throw new Error(
        `Apply lock state is ${inspected.state}; refusing to clear`
      );
    }
    const expectedToken = inspected.owner.token;
    await beforeUnlink({ lockPath, owner: inspected.owner });
    const current = await readJsonFile(lockPath);
    if (
      !current.exists ||
      !validApplyLockOwner(current.value, normalizedPageId) ||
      current.value.token !== expectedToken
    ) {
      throw new Error(
        'Apply lock changed during inspection; refusing to clear'
      );
    }
    await unlink(lockPath);
    return {
      ...inspected,
      cleared: true,
    };
  } finally {
    const maintenance = await readJsonFile(maintenancePath);
    if (maintenance.value?.token === maintenanceToken) {
      await unlink(maintenancePath).catch(() => {});
    }
  }
}

export function parsePageReference(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('--page is required');

  const compact = normalizeId(input);
  if (/^[0-9a-f]{32}$/.test(compact)) return compact;

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid Notion page ID or URL: ${input}`);
  }

  const candidates = [...url.pathname.matchAll(/[0-9a-f]{32}/gi)];
  const id = candidates.at(-1)?.[0]?.toLowerCase();
  if (!id) throw new Error(`Notion page URL does not contain a page ID: ${input}`);
  return id;
}

function richText(prop) {
  const parts = prop?.type === 'title' ? prop.title : prop?.rich_text;
  return (parts || []).map((part) => part.plain_text || '').join('');
}

function select(prop) {
  return prop?.select?.name || '';
}

function multiSelect(prop) {
  return (prop?.multi_select || []).map((option) => option.name);
}

function checkbox(prop) {
  return prop?.checkbox ? '__YES__' : '__NO__';
}

function number(prop) {
  return typeof prop?.number === 'number' ? prop.number : null;
}

function url(prop) {
  return prop?.url || '';
}

function date(prop) {
  return prop?.date?.start || '';
}

export function notionPageToRow(page) {
  const properties = page?.properties || {};
  return {
    Slug: richText(properties.Slug),
    Name: richText(properties.Name),
    'Name ZH': richText(properties['Name ZH']),
    'Thai / Alt Name': richText(properties['Thai / Alt Name']),
    Category: select(properties.Category),
    'Google Maps URL': url(properties['Google Maps URL']),
    'Google Place ID': richText(properties['Google Place ID']),
    'Coordinates Approx': checkbox(properties['Coordinates Approx']),
    Lat: number(properties.Lat),
    Lng: number(properties.Lng),
    'Notes EN': richText(properties['Notes EN']),
    'Notes ZH': richText(properties['Notes ZH']),
    'Source URLs': richText(properties['Source URLs']),
    'Source Tags': multiSelect(properties['Source Tags']),
    'Branch Group': richText(properties['Branch Group']),
    Origin: select(properties.Origin),
    Status: select(properties.Status),
    'Review Needed': checkbox(properties['Review Needed']),
    'Review Decision': select(properties['Review Decision']),
    'Coordinate Type': select(properties['Coordinate Type']),
    'Verification Note': richText(properties['Verification Note']),
    'Rejected Place IDs': richText(properties['Rejected Place IDs']),
    'Candidate Summary': richText(properties['Candidate Summary']),
    'Candidate Maps URL': url(properties['Candidate Maps URL']),
    'Candidate Payload': richText(properties['Candidate Payload']),
    'Apply Metadata': richText(properties['Apply Metadata']),
    'Last Verified': date(properties['Last Verified']),
    'Place ID Checked At': date(properties['Place ID Checked At']),
  };
}

async function readJsonResponse(response, label) {
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.status || body?.status || '';
    } catch {
      // HTTP status is sufficient when the response is not JSON.
    }
    throw new Error(
      `${label} failed with HTTP ${response.status}${detail ? ` (${detail})` : ''}`
    );
  }
  return response.json();
}

export async function fetchNotionPage({
  pageId,
  notionApiKey,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(`${NOTION_API_BASE}/pages/${pageId}`, {
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      'Notion-Version': NOTION_VERSION,
    },
  });
  return readJsonResponse(response, 'Notion page read');
}

export async function queryAllNotionDataSourcePages({
  dataSourceId,
  notionApiKey,
  fetchImpl = fetch,
}) {
  if (!notionApiKey) throw new Error('Missing NOTION_API_KEY');
  if (!String(dataSourceId || '').trim()) {
    throw new Error('Notion data source ID is required');
  }

  const results = [];
  const seenCursors = new Set();
  let startCursor = null;
  do {
    if (startCursor && seenCursors.has(startCursor)) {
      throw new Error('Notion query returned a repeated pagination cursor');
    }
    if (startCursor) seenCursors.add(startCursor);
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;
    const response = await fetchImpl(
      `${NOTION_API_BASE}/data_sources/${dataSourceId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${notionApiKey}`,
          'Notion-Version': NOTION_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    const page = await readJsonResponse(
      response,
      `Notion data source ${dataSourceId} query`
    );
    results.push(...(page.results || []));
    startCursor = page.has_more ? page.next_cursor : null;
    if (page.has_more && !startCursor) {
      throw new Error('Notion query has_more without next_cursor');
    }
  } while (startCursor);
  return results;
}

function validatorRow(page, expectedDataSourceId) {
  const dataSourceId = page.parent?.data_source_id;
  if (dataSourceId !== expectedDataSourceId) {
    throw new Error(
      `Notion query returned page ${page.id} from unexpected data source ${dataSourceId}`
    );
  }
  return {
    ...notionPageToRow(page),
    __pageId: page.id,
    __pageUrl: page.url,
    __dataSourceId: dataSourceId,
    __inTrash: Boolean(page.in_trash || page.archived),
  };
}

// Validates every live row in the single Notion Locations database against
// the target invariants (required fields, coordinates, apply metadata,
// candidate lifecycle — see validateTargetRows). Prior to the 2026-07-21
// single-source cutover this compared a "Locations (PoC)" workbench against
// the formal database plus a set of frozen migration-era baseline/approval
// JSON artifacts; both the PoC database and those artifacts have since been
// deleted, so this is now a straightforward live read-and-check.
export async function validateAllLocations({
  notionApiKey,
  fetchImpl = fetch,
  expectedCount = EXPECTED_LOCATION_COUNT,
}) {
  requireNotionApiKey(notionApiKey);

  const pages = await queryAllNotionDataSourcePages({
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    notionApiKey,
    fetchImpl,
  });
  const rows = pages.map((page) => validatorRow(page, FORMAL_DATA_SOURCE_ID));
  const { issues, statusCounts } = validateTargetRows(rows, { expectedCount });

  return {
    ok: issues.length === 0,
    issues,
    statusCounts,
    rowCount: rows.length,
    mode: 'live',
    writePerformed: false,
    dataSource: FORMAL_DATA_SOURCE_ID,
  };
}

export async function productionPreflightPage({
  pageReference,
  notionApiKey,
  fetchImpl = fetch,
}) {
  requireNotionApiKey(notionApiKey);

  const pageId = parsePageReference(pageReference);
  const page = await fetchNotionPage({
    pageId,
    notionApiKey,
    fetchImpl,
  });
  const dataSourceId = page.parent?.data_source_id;
  if (dataSourceId !== FORMAL_DATA_SOURCE_ID) {
    throw new Error(
      `Refusing production preflight: page data source ${dataSourceId} is not formal allowlist ${FORMAL_DATA_SOURCE_ID}`
    );
  }
  if (page.in_trash || page.archived) {
    throw new Error(
      'Refusing production preflight for an archived or trashed page'
    );
  }

  const row = notionPageToRow(page);
  if (!row.Name || !row.Slug || !row.Status) {
    throw new Error(
      'Formal Notion page is missing Name, Slug, or legacy Status'
    );
  }

  const properties = new Set(Object.keys(page.properties || {}));
  const missingFormalFields = ACTIVE_FORMAL_FIELDS.filter(
    (field) => !properties.has(field)
  );
  const presentWorkflowFields = ACTIVE_FORMAL_WORKFLOW_FIELDS.filter((field) =>
    properties.has(field)
  );
  const missingWorkflowFields = ACTIVE_FORMAL_WORKFLOW_FIELDS.filter(
    (field) => !properties.has(field)
  );
  const currentSchema = inspectCurrentFormalLocationProperties(
    page.properties
  );
  const proposedPatch = TARGET_STATUSES.has(row.Status)
    ? {}
    : buildStatusMigrationPatch(row);
  const canaryWriteReady =
    missingFormalFields.length === 0 &&
    missingWorkflowFields.length === 0 &&
    currentSchema.ok;

  return {
    mode: 'formal-read-only',
    writePerformed: false,
    page: {
      id: page.id,
      url: page.url,
      dataSourceId,
      name: row.Name,
      slug: row.Slug,
      status: row.Status,
    },
    schema: {
      formalFieldCount: ACTIVE_FORMAL_FIELDS.length,
      missingFormalFields,
      requiredWorkflowFieldCount: ACTIVE_FORMAL_WORKFLOW_FIELDS.length,
      presentWorkflowFields,
      missingWorkflowFields,
      expectedPropertyCount:
        ACTIVE_FORMAL_FIELDS.length + ACTIVE_FORMAL_WORKFLOW_FIELDS.length,
      wrongPropertyTypes: currentSchema.wrongTypes,
      unexpectedProperties: currentSchema.unexpected,
      statusOptions: currentSchema.statusOptions,
    },
    proposedPatch,
    gates: {
      formalReadBoundary: true,
      conservativeMigrationPreview: true,
      canaryWriteReady,
      formalWriteCredentialConsumed: false,
    },
  };
}

async function findDuplicatePlaceIds({
  placeId,
  currentPageId,
  notionApiKey,
  dataSourceId,
  fetchImpl,
}) {
  const response = await fetchImpl(
    `${NOTION_API_BASE}/data_sources/${dataSourceId}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${notionApiKey}`,
        'Notion-Version': NOTION_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        page_size: 100,
        filter: {
          property: 'Google Place ID',
          rich_text: { equals: placeId },
        },
      }),
    }
  );
  const body = await readJsonResponse(response, 'Notion duplicate Place ID query');
  const currentId = normalizeId(currentPageId);
  return (body.results || [])
    .filter((page) => normalizeId(page.id) !== currentId)
    .map((page) => ({
      id: page.id,
      name: richText(page.properties?.Name),
      slug: richText(page.properties?.Slug),
    }));
}

async function fetchExistingPlace({
  placeId,
  googlePlacesKey,
  fetchImpl,
  placesApiMode = 'legacy',
}) {
  if (placesApiMode === 'legacy') {
    return fetchLegacyExistingPlace({ placeId, googlePlacesKey, fetchImpl });
  }

  const response = await fetchImpl(
    `${PLACES_API_BASE}/places/${encodeURIComponent(placeId)}`,
    {
      headers: {
        'X-Goog-Api-Key': googlePlacesKey,
        'X-Goog-FieldMask': PLACE_FIELD_MASK,
      },
    }
  );
  if (response.status === 404) return null;
  if (response.ok) {
    return {
      place: await response.json(),
      apiMode: 'places_new',
    };
  }
  if (response.status !== 403) {
    await readJsonResponse(response, 'Google Place ID refresh');
  }

  return fetchLegacyExistingPlace({ placeId, googlePlacesKey, fetchImpl });
}

async function fetchLegacyExistingPlace({
  placeId,
  googlePlacesKey,
  fetchImpl,
}) {
  const legacyUrl = new URL(`${LEGACY_PLACES_API_BASE}/details/json`);
  legacyUrl.searchParams.set('place_id', placeId);
  legacyUrl.searchParams.set(
    'fields',
    'place_id,name,formatted_address,geometry,business_status,type'
  );
  legacyUrl.searchParams.set('key', googlePlacesKey);
  const legacyResponse = await fetchImpl(legacyUrl);
  const body = await readJsonResponse(
    legacyResponse,
    'Google legacy Place ID refresh'
  );
  if (['NOT_FOUND', 'ZERO_RESULTS'].includes(body.status)) return null;
  if (body.status !== 'OK') {
    throw new Error(`Google legacy Place ID refresh failed (${body.status})`);
  }
  return {
    place: normalizeLegacyPlace(body.result),
    apiMode: 'places_legacy',
  };
}

async function searchPlaces({
  query,
  googlePlacesKey,
  fetchImpl,
  placesApiMode = 'legacy',
}) {
  if (placesApiMode === 'legacy') {
    return searchLegacyPlaces({ query, googlePlacesKey, fetchImpl });
  }

  const response = await fetchImpl(`${PLACES_API_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': googlePlacesKey,
      'X-Goog-FieldMask': TEXT_SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      regionCode: 'TH',
      maxResultCount: 5,
    }),
  });
  if (response.ok) {
    const body = await response.json();
    return {
      places: body.places || [],
      apiMode: 'places_new',
    };
  }
  if (response.status !== 403) {
    await readJsonResponse(response, 'Google Places text search');
  }

  return searchLegacyPlaces({ query, googlePlacesKey, fetchImpl });
}

async function searchLegacyPlaces({ query, googlePlacesKey, fetchImpl }) {
  const legacyUrl = new URL(`${LEGACY_PLACES_API_BASE}/textsearch/json`);
  legacyUrl.searchParams.set('query', query);
  legacyUrl.searchParams.set('region', 'th');
  legacyUrl.searchParams.set('key', googlePlacesKey);
  const legacyResponse = await fetchImpl(legacyUrl);
  const body = await readJsonResponse(
    legacyResponse,
    'Google legacy Places text search'
  );
  if (body.status === 'ZERO_RESULTS') {
    return { places: [], apiMode: 'places_legacy' };
  }
  if (body.status !== 'OK') {
    throw new Error(`Google legacy Places text search failed (${body.status})`);
  }
  return {
    places: (body.results || []).slice(0, 5).map(normalizeLegacyPlace),
    apiMode: 'places_legacy',
  };
}

function normalizeLegacyPlace(place) {
  return {
    id: place?.place_id || '',
    displayName: { text: place?.name || '' },
    formattedAddress: place?.formatted_address || '',
    location: {
      latitude: place?.geometry?.location?.lat ?? null,
      longitude: place?.geometry?.location?.lng ?? null,
    },
    businessStatus: place?.business_status || '',
    types: place?.types || [],
  };
}

function buildSearchQuery(row) {
  return [...new Set([row.Name, row['Thai / Alt Name'], 'Bangkok'].filter(Boolean))]
    .join(' ')
    .trim();
}

function rejectedPlaceIds(row) {
  return new Set(
    String(row['Rejected Place IDs'] || '')
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function uniqueCandidates(candidates, rejected) {
  const byId = new Map();
  for (const candidate of candidates) {
    if (!candidate?.id || rejected.has(candidate.id)) continue;
    byId.set(candidate.id, candidate);
  }
  return [...byId.values()];
}

function candidateDistance(row, candidate) {
  const lat = candidate?.location?.latitude;
  const lng = candidate?.location?.longitude;
  if (
    !Number.isFinite(row.Lat) ||
    !Number.isFinite(row.Lng) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  return Math.round(haversineMeters(row.Lat, row.Lng, lat, lng));
}

function distanceRisk(distanceMeters) {
  if (distanceMeters === null) return 'unknown';
  if (distanceMeters <= 100) return 'low';
  if (distanceMeters <= 500) return 'medium';
  return 'high';
}

function plusDays(iso, days) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function formalSnapshot(row) {
  return Object.fromEntries(FORMAL_FIELDS.map((field) => [field, row[field]]));
}

function assertNoExistingCandidate(row) {
  const occupied = [
    'Candidate Payload',
    'Candidate Summary',
    'Candidate Maps URL',
  ].filter((field) => String(row[field] || '').trim());
  if (occupied.length > 0) {
    throw new Error(
      `Refusing overwrite: existing candidate workflow fields: ${occupied.join(', ')}`
    );
  }
}

export async function resolvePageDryRun({
  pageReference,
  notionApiKey,
  googlePlacesKey,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
  fetchImpl = fetch,
  now = new Date(),
  randomUUIDImpl = randomUUID,
  placesApiMode = 'legacy',
  rejectExistingCandidate = false,
}) {
  if (!notionApiKey) throw new Error('Missing NOTION_API_KEY');
  if (!googlePlacesKey) {
    throw new Error('Missing GOOGLE_PLACE_KEY (or GOOGLE_PLACES_KEY)');
  }
  assertSupportedRunnerDataSource(expectedDataSourceId);

  const pageId = parsePageReference(pageReference);
  const page = await fetchNotionPage({ pageId, notionApiKey, fetchImpl });
  const dataSourceId = page.parent?.data_source_id;
  assertAllowedDataSource(dataSourceId, expectedDataSourceId);
  if (page.in_trash || page.archived) {
    throw new Error('Refusing resolver run for an archived or trashed page');
  }

  const row = notionPageToRow(page);
  if (rejectExistingCandidate) assertNoExistingCandidate(row);
  const query = buildSearchQuery(row);
  if (!row.Name || !row.Slug || !query) {
    throw new Error('Notion page is missing Name, Slug, or resolver query input');
  }

  const rejected = rejectedPlaceIds(row);
  let candidateSource = 'text_search';
  let apiMode = null;
  let candidates = [];

  if (row['Google Place ID'] && !rejected.has(row['Google Place ID'])) {
    const refreshed = await fetchExistingPlace({
      placeId: row['Google Place ID'],
      googlePlacesKey,
      fetchImpl,
      placesApiMode,
    });
    if (refreshed) {
      candidateSource = 'existing_place_id';
      apiMode = refreshed.apiMode;
      candidates = [refreshed.place];
    }
  }

  if (candidates.length === 0) {
    const searchResult = await searchPlaces({
      query,
      googlePlacesKey,
      fetchImpl,
      placesApiMode,
    });
    apiMode = searchResult.apiMode;
    candidates = uniqueCandidates(
      searchResult.places,
      rejected
    );
  }

  const resolvedAt = new Date(now).toISOString();
  const reviewExpiresAt = plusDays(resolvedAt, REVIEW_TTL_DAYS);
  const reviewRunId = `review-${randomUUIDImpl()}`;

  let result;
  let selectedCandidate = null;
  let duplicatePages = [];
  let errorCode = null;

  if (candidates.length === 0) {
    result = 'no_candidate';
  } else if (candidates.length > 1) {
    result = 'ambiguous';
  } else {
    selectedCandidate = candidates[0];
    duplicatePages = await findDuplicatePlaceIds({
      placeId: selectedCandidate.id,
      currentPageId: page.id,
      notionApiKey,
      dataSourceId,
      fetchImpl,
    });
    if (duplicatePages.length > 0) {
      result = 'error';
      errorCode = 'duplicate_place_id';
    } else {
      result = 'place_id_candidate';
    }
  }

  const patch = buildCandidatePatch({
    row,
    dataSourceId,
    expectedDataSourceId,
    result,
    placeId: result === 'place_id_candidate' ? selectedCandidate.id : null,
    coordinateReviewRequired:
      result === 'place_id_candidate' &&
      distanceRisk(candidateDistance(row, selectedCandidate)) === 'high',
    candidateSource,
    verificationMethod:
      candidateSource === 'existing_place_id'
        ? 'places_refresh'
        : 'places_text_search',
    query,
    reviewRunId,
    resolvedAt,
    reviewExpiresAt,
    errorCode,
  });

  const displayedCandidates =
    result === 'ambiguous' ? candidates : selectedCandidate ? [selectedCandidate] : [];

  return {
    mode: 'dry-run',
    writePerformed: false,
    page: {
      id: page.id,
      url: page.url,
      dataSourceId,
      name: row.Name,
      slug: row.Slug,
      status: row.Status,
      reviewNeeded: row['Review Needed'],
      currentPlaceId: row['Google Place ID'],
      lat: row.Lat,
      lng: row.Lng,
      formalSnapshot: formalSnapshot(row),
    },
    resolver: {
      result,
      query,
      candidateSource,
      apiMode,
      reviewRunId,
      resolvedAt,
      reviewExpiresAt,
      candidates: displayedCandidates.map((candidate) => {
        const distanceMeters = candidateDistance(row, candidate);
        return {
          placeId: candidate.id,
          name: candidate.displayName?.text || '',
          address: candidate.formattedAddress || '',
          lat: candidate.location?.latitude ?? null,
          lng: candidate.location?.longitude ?? null,
          businessStatus: candidate.businessStatus || '',
          distanceMeters,
          distanceRisk: distanceRisk(distanceMeters),
          mapsUrl: mapsUrlForPlaceId(candidate.id),
        };
      }),
      duplicatePages,
    },
    proposedPatch: patch,
  };
}

function notionRichText(value, field) {
  const text = String(value || '');
  const chunks = text.match(/[\s\S]{1,2000}/g) || [];
  if (chunks.length > 100) {
    throw new Error(`${field} exceeds Notion's rich text element limit`);
  }
  return {
    rich_text: chunks.map((content) => ({
      type: 'text',
      text: { content },
    })),
  };
}

export function candidatePatchToNotionProperties(patch) {
  const expectedFields = new Set([
    'Review Needed',
    'Candidate Summary',
    'Candidate Maps URL',
    'Candidate Payload',
    'Review Decision',
  ]);
  const unknownFields = Object.keys(patch).filter(
    (field) => !expectedFields.has(field)
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `Resolver patch contains non-candidate fields: ${unknownFields.join(', ')}`
    );
  }
  for (const field of expectedFields) {
    if (!Object.hasOwn(patch, field)) {
      throw new Error(`Resolver patch missing candidate field: ${field}`);
    }
  }
  if (patch['Review Needed'] !== '__YES__') {
    throw new Error('Resolver write must keep Review Needed checked');
  }

  return {
    'Review Needed': { checkbox: true },
    'Candidate Summary': notionRichText(
      patch['Candidate Summary'],
      'Candidate Summary'
    ),
    'Candidate Maps URL': { url: patch['Candidate Maps URL'] || null },
    'Candidate Payload': notionRichText(
      patch['Candidate Payload'],
      'Candidate Payload'
    ),
    'Review Decision': {
      select: patch['Review Decision']
        ? { name: patch['Review Decision'] }
        : null,
    },
  };
}

export function reviewPatchToNotionProperties(patch) {
  const expectedFields = new Set([
    'Review Decision',
    'Coordinate Type',
    'Verification Note',
  ]);
  const unknownFields = Object.keys(patch).filter(
    (field) => !expectedFields.has(field)
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `Review patch contains unsupported fields: ${unknownFields.join(', ')}`
    );
  }
  for (const field of expectedFields) {
    if (!Object.hasOwn(patch, field)) {
      throw new Error(`Review patch missing field: ${field}`);
    }
  }
  if (!REVIEW_DECISIONS.has(patch['Review Decision'])) {
    throw new Error(
      `Unsupported Review Decision: ${patch['Review Decision'] || '(blank)'}`
    );
  }
  if (
    patch['Coordinate Type'] &&
    !COORDINATE_TYPES.has(patch['Coordinate Type'])
  ) {
    throw new Error(
      `Unsupported Coordinate Type: ${patch['Coordinate Type']}`
    );
  }

  return {
    'Review Decision': {
      select: { name: patch['Review Decision'] },
    },
    'Coordinate Type': {
      select: patch['Coordinate Type']
        ? { name: patch['Coordinate Type'] }
        : null,
    },
    'Verification Note': notionRichText(
      patch['Verification Note'],
      'Verification Note'
    ),
  };
}

function normalizeCoordinateCorrectionValue(
  value,
  field,
  minimum,
  maximum
) {
  const numberValue =
    typeof value === 'number'
      ? value
      : Number(String(value ?? '').trim());
  if (
    !Number.isFinite(numberValue) ||
    numberValue < minimum ||
    numberValue > maximum
  ) {
    throw new Error(
      `${field} must be a finite number between ${minimum} and ${maximum}`
    );
  }
  return Number(numberValue.toFixed(7));
}

function normalizeCoordinateSourceUrl(value) {
  const sourceUrl = String(value || '').trim();
  if (!sourceUrl) {
    throw new Error('A traceable coordinate source URL is required');
  }
  if (sourceUrl.length > 2000) {
    throw new Error('Coordinate source URL is too long');
  }
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error('Coordinate source URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Coordinate source URL must use http or https');
  }
  return parsed.href;
}

function listedSourceUrls(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function canonicalSourceUrl(value) {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

export function coordinateCorrectionPatchToNotionProperties(patch) {
  const allowedFields = new Set(['Lat', 'Lng', 'Source URLs']);
  const unknownFields = Object.keys(patch).filter(
    (field) => !allowedFields.has(field)
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `Coordinate correction patch contains unsupported fields: ${unknownFields.join(', ')}`
    );
  }
  for (const field of ['Lat', 'Lng']) {
    if (!Object.hasOwn(patch, field)) {
      throw new Error(`Coordinate correction patch missing field: ${field}`);
    }
  }
  const lat = normalizeCoordinateCorrectionValue(
    patch.Lat,
    'Lat',
    -90,
    90
  );
  const lng = normalizeCoordinateCorrectionValue(
    patch.Lng,
    'Lng',
    -180,
    180
  );
  const properties = {
    Lat: { number: lat },
    Lng: { number: lng },
  };
  if (Object.hasOwn(patch, 'Source URLs')) {
    properties['Source URLs'] = notionRichText(
      patch['Source URLs'],
      'Source URLs'
    );
  }
  return properties;
}

export function candidateResetPatchToNotionProperties(patch) {
  const expectedFields = new Set([
    'Review Needed',
    'Candidate Summary',
    'Candidate Maps URL',
    'Candidate Payload',
    'Review Decision',
    'Verification Note',
  ]);
  const unknownFields = Object.keys(patch).filter(
    (field) => !expectedFields.has(field)
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `Candidate reset patch contains unsupported fields: ${unknownFields.join(', ')}`
    );
  }
  for (const field of expectedFields) {
    if (!Object.hasOwn(patch, field)) {
      throw new Error(`Candidate reset patch missing field: ${field}`);
    }
  }
  if (patch['Review Needed'] !== '__YES__') {
    throw new Error('Candidate reset must keep Review Needed checked');
  }
  if (
    patch['Candidate Summary'] ||
    patch['Candidate Maps URL'] ||
    patch['Candidate Payload'] ||
    patch['Review Decision']
  ) {
    throw new Error('Candidate reset must clear all candidate workflow fields');
  }

  return {
    'Review Needed': { checkbox: true },
    'Candidate Summary': notionRichText('', 'Candidate Summary'),
    'Candidate Maps URL': { url: null },
    'Candidate Payload': notionRichText('', 'Candidate Payload'),
    'Review Decision': { select: null },
    'Verification Note': notionRichText(
      patch['Verification Note'],
      'Verification Note'
    ),
  };
}

const APPLY_PATCH_FIELDS = new Set([
  'Apply Metadata',
  'Verification Note',
  'Google Place ID',
  'Google Maps URL',
  'Status',
  'Review Needed',
  'Rejected Place IDs',
  'Candidate Summary',
  'Candidate Maps URL',
  'Candidate Payload',
  'Review Decision',
  'date:Last Verified:start',
  'date:Last Verified:is_datetime',
  'date:Place ID Checked At:start',
  'date:Place ID Checked At:is_datetime',
]);

const APPLY_RICH_TEXT_FIELDS = new Set([
  'Apply Metadata',
  'Verification Note',
  'Google Place ID',
  'Rejected Place IDs',
  'Candidate Summary',
  'Candidate Payload',
]);

const APPLY_URL_FIELDS = new Set([
  'Google Maps URL',
  'Candidate Maps URL',
]);

const APPLY_SELECT_FIELDS = new Set(['Status', 'Review Decision']);

function parseApplyMetadataEnvelope(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!text.startsWith('lv1:')) {
    throw new Error('Apply Metadata must use the lv1: envelope');
  }

  let metadata;
  try {
    metadata = JSON.parse(text.slice('lv1:'.length));
  } catch {
    throw new Error('Apply Metadata is not valid JSON');
  }
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    metadata.schemaVersion !== 1
  ) {
    throw new Error('Unsupported Apply Metadata schema');
  }
  if (!String(metadata.actionRunId || '').startsWith('action-')) {
    throw new Error('Apply Metadata actionRunId is invalid');
  }
  if (!REVIEW_DECISIONS.has(metadata.decision)) {
    throw new Error('Apply Metadata decision is invalid');
  }
  if (!['pending', 'completed', 'failed'].includes(metadata.state)) {
    throw new Error('Apply Metadata state is invalid');
  }
  if (!String(metadata.basisRevision || '').startsWith('sha256:')) {
    throw new Error('Apply Metadata basisRevision is invalid');
  }
  if (!Number.isFinite(Date.parse(metadata.updatedAt))) {
    throw new Error('Apply Metadata updatedAt is invalid');
  }
  return metadata;
}

export function applyPatchToNotionProperties(patch) {
  const unknownFields = Object.keys(patch).filter(
    (field) => !APPLY_PATCH_FIELDS.has(field)
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `Apply patch contains unsupported fields: ${unknownFields.join(', ')}`
    );
  }
  if (!Object.hasOwn(patch, 'Apply Metadata')) {
    throw new Error('Apply patch is missing Apply Metadata');
  }

  const metadata = parseApplyMetadataEnvelope(patch['Apply Metadata']);
  if (!metadata) throw new Error('Apply Metadata cannot be blank');
  if (metadata.state === 'pending' && Object.keys(patch).length !== 1) {
    throw new Error('Pending apply patch may update only Apply Metadata');
  }
  if (metadata.state === 'failed') {
    throw new Error('Failed apply patches are not implemented');
  }

  const properties = {};
  for (const [field, value] of Object.entries(patch)) {
    if (field.endsWith(':is_datetime')) {
      const dateField = field.replace(':is_datetime', ':start');
      if (value !== 1 || !Object.hasOwn(patch, dateField)) {
        throw new Error(`${field} must accompany a date start value`);
      }
      continue;
    }
    if (field.startsWith('date:')) {
      const propertyName = field.slice('date:'.length, -':start'.length);
      if (!Number.isFinite(Date.parse(value))) {
        throw new Error(`${field} must contain an ISO timestamp`);
      }
      properties[propertyName] = { date: { start: value } };
    } else if (APPLY_RICH_TEXT_FIELDS.has(field)) {
      properties[field] = notionRichText(value, field);
    } else if (APPLY_URL_FIELDS.has(field)) {
      properties[field] = { url: value || null };
    } else if (APPLY_SELECT_FIELDS.has(field)) {
      properties[field] = {
        select: value ? { name: value } : null,
      };
    } else if (field === 'Review Needed') {
      if (!['__YES__', '__NO__'].includes(value)) {
        throw new Error('Review Needed must use __YES__ or __NO__');
      }
      properties[field] = { checkbox: value === '__YES__' };
    }
  }
  return properties;
}

function parseCandidateEnvelope(value) {
  const text = String(value || '');
  if (!text.startsWith('lv2:')) {
    throw new Error('Proposed Candidate Payload must use the lv2: envelope');
  }
  let payload;
  try {
    payload = JSON.parse(text.slice('lv2:'.length));
  } catch {
    throw new Error('Proposed Candidate Payload is not valid JSON');
  }
  return validateCandidatePayload(payload);
}

function assertFormalSnapshotUnchanged(row, expectedSnapshot) {
  const actualSnapshot = formalSnapshot(row);
  if (JSON.stringify(actualSnapshot) !== JSON.stringify(expectedSnapshot)) {
    const changed = FORMAL_FIELDS.filter(
      (field) =>
        JSON.stringify(actualSnapshot[field]) !==
        JSON.stringify(expectedSnapshot[field])
    );
    throw new Error(
      `Formal fields changed during resolve run: ${changed.join(', ')}`
    );
  }
}

function assertProposedRevisions(row, dataSourceId, patch) {
  const payload = parseCandidateEnvelope(patch['Candidate Payload']);
  if (payload.basisRevision !== basisRevision(row)) {
    throw new Error('basisRevision changed before resolver write');
  }
  const currentWorkflowRevision = workflowRevision({
    status: row.Status,
    dataSourceId,
    inTrash: false,
  });
  if (payload.workflowRevision !== currentWorkflowRevision) {
    throw new Error('workflowRevision changed before resolver write');
  }
}

function assertCandidatePatchApplied(row, patch, expectedFormalSnapshot) {
  assertFormalSnapshotUnchanged(row, expectedFormalSnapshot);
  const comparisons = {
    'Review Needed': row['Review Needed'],
    'Candidate Summary': row['Candidate Summary'] || null,
    'Candidate Maps URL': row['Candidate Maps URL'] || null,
    'Candidate Payload': row['Candidate Payload'] || null,
    'Review Decision': row['Review Decision'] || null,
  };
  const expected = {
    'Review Needed': patch['Review Needed'],
    'Candidate Summary': patch['Candidate Summary'] || null,
    'Candidate Maps URL': patch['Candidate Maps URL'] || null,
    'Candidate Payload': patch['Candidate Payload'] || null,
    'Review Decision': patch['Review Decision'] || null,
  };
  const mismatches = Object.keys(expected).filter(
    (field) => comparisons[field] !== expected[field]
  );
  if (mismatches.length > 0) {
    throw new Error(
      `Post-write candidate verification failed: ${mismatches.join(', ')}`
    );
  }
}

async function updateNotionCandidateFields({
  pageId,
  dataSourceId,
  expectedDataSourceId,
  notionApiKey,
  patch,
  fetchImpl,
}) {
  assertWriteTarget({
    dataSourceId,
    expectedDataSourceId,
  });
  const response = await fetchImpl(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      'Notion-Version': NOTION_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      properties: candidatePatchToNotionProperties(patch),
    }),
  });
  return readJsonResponse(response, 'Notion candidate write');
}

async function updateNotionReviewFields({
  pageId,
  dataSourceId,
  expectedDataSourceId,
  notionApiKey,
  patch,
  fetchImpl,
}) {
  assertWriteTarget({
    dataSourceId,
    expectedDataSourceId,
  });
  const response = await fetchImpl(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      'Notion-Version': NOTION_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      properties: reviewPatchToNotionProperties(patch),
    }),
  });
  return readJsonResponse(response, 'Notion review write');
}

async function updateNotionCoordinateCorrectionFields({
  pageId,
  dataSourceId,
  expectedDataSourceId,
  notionApiKey,
  patch,
  fetchImpl,
}) {
  assertWriteTarget({
    dataSourceId,
    expectedDataSourceId,
  });
  const response = await fetchImpl(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      'Notion-Version': NOTION_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      properties: coordinateCorrectionPatchToNotionProperties(patch),
    }),
  });
  return readJsonResponse(response, 'Notion coordinate correction write');
}

async function updateNotionCandidateResetFields({
  pageId,
  dataSourceId,
  expectedDataSourceId,
  notionApiKey,
  patch,
  fetchImpl,
}) {
  assertWriteTarget({
    dataSourceId,
    expectedDataSourceId,
  });
  const response = await fetchImpl(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      'Notion-Version': NOTION_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      properties: candidateResetPatchToNotionProperties(patch),
    }),
  });
  return readJsonResponse(response, 'Notion candidate reset write');
}

async function updateNotionApplyFields({
  pageId,
  dataSourceId,
  expectedDataSourceId,
  notionApiKey,
  patch,
  fetchImpl,
  label,
}) {
  assertWriteTarget({
    dataSourceId,
    expectedDataSourceId,
  });
  const response = await fetchImpl(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      'Notion-Version': NOTION_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      properties: applyPatchToNotionProperties(patch),
    }),
  });
  return readJsonResponse(response, label);
}

async function readValidatedPage({
  pageId,
  notionApiKey,
  expectedDataSourceId,
  fetchImpl,
}) {
  const page = await fetchNotionPage({ pageId, notionApiKey, fetchImpl });
  const dataSourceId = page.parent?.data_source_id;
  assertAllowedDataSource(dataSourceId, expectedDataSourceId);
  if (page.in_trash || page.archived) {
    throw new Error('Refusing runner action for an archived or trashed page');
  }
  return {
    page,
    dataSourceId,
    row: notionPageToRow(page),
  };
}

function candidatePayloadForApply(row) {
  if (row['Review Decision'] === 'Deactivate') return null;
  return parseCandidateEnvelope(row['Candidate Payload']);
}

function buildReviewPreview({
  current,
  decision,
  coordinateType,
  verificationNote,
  newEvidence,
  nowIso,
  mode,
}) {
  const normalizedDecision = String(decision || '').trim();
  const normalizedCoordinateType = String(coordinateType || '').trim();
  const existingVerificationNote = String(
    current.row['Verification Note'] || ''
  ).trim();
  const hasNewEvidenceInput = newEvidence !== undefined;
  const normalizedNewEvidence = String(newEvidence || '').trim();
  const normalizedVerificationNote = hasNewEvidenceInput
    ? [existingVerificationNote, normalizedNewEvidence]
        .filter(Boolean)
        .join('\n')
    : String(verificationNote || '').trim();
  if (!REVIEW_DECISIONS.has(normalizedDecision)) {
    throw new Error(
      `Unsupported Review Decision: ${normalizedDecision || '(blank)'}`
    );
  }
  if (
    normalizedCoordinateType &&
    !COORDINATE_TYPES.has(normalizedCoordinateType)
  ) {
    throw new Error(
      `Unsupported Coordinate Type: ${normalizedCoordinateType}`
    );
  }
  if (
    hasNewEvidenceInput &&
    normalizedDecision !== 'Need Research' &&
    !normalizedNewEvidence
  ) {
    throw new Error('New verification evidence is required for this decision');
  }

  const proposedPatch = {
    'Review Decision': normalizedDecision,
    'Coordinate Type': ['Accept Candidate', 'Keep Current'].includes(
      normalizedDecision
    )
      ? normalizedCoordinateType
      : current.row['Coordinate Type'],
    'Verification Note': normalizedVerificationNote,
  };
  if (
    existingVerificationNote &&
    normalizedVerificationNote !== existingVerificationNote &&
    !normalizedVerificationNote.startsWith(
      `${existingVerificationNote}\n`
    )
  ) {
    throw new Error(
      'Verification Note is append-only; keep the existing note and append the new evidence'
    );
  }
  reviewPatchToNotionProperties(proposedPatch);

  const proposedRow = {
    ...current.row,
    ...proposedPatch,
  };
  buildCompletedApplyPatch({
    row: proposedRow,
    dataSourceId: current.dataSourceId,
    expectedDataSourceId: current.dataSourceId,
    allowLegacySourceStatus:
      current.dataSourceId === FORMAL_DATA_SOURCE_ID,
    actionRunId: 'review-preview',
    now: nowIso,
  });

  let candidate = null;
  if (
    normalizedDecision !== 'Deactivate' &&
    proposedRow['Candidate Payload']
  ) {
    candidate = parseCandidateEnvelope(proposedRow['Candidate Payload']);
  }
  return {
    mode,
    writePerformed: false,
    page: {
      id: current.page.id,
      url: current.page.url,
      dataSourceId: current.dataSourceId,
      name: current.row.Name,
      slug: current.row.Slug,
      status: current.row.Status,
      reviewNeeded: current.row['Review Needed'],
      formalSnapshot: formalSnapshot(current.row),
    },
    review: {
      decision: normalizedDecision,
      coordinateType: proposedPatch['Coordinate Type'],
      verificationNote: normalizedVerificationNote,
      priorVerificationNote: existingVerificationNote,
      newEvidence: hasNewEvidenceInput ? normalizedNewEvidence : null,
      reviewRunId: candidate?.reviewRunId || null,
      candidateResult: candidate?.result || null,
    },
    proposedPatch,
    guard: {
      basisRevision: basisRevision(current.row),
      workflowRevision: workflowRevision({
        status: current.row.Status,
        dataSourceId: current.dataSourceId,
        inTrash: false,
      }),
      candidatePayload: current.row['Candidate Payload'],
      reviewNeeded: current.row['Review Needed'],
      priorReviewDecision: current.row['Review Decision'],
      priorCoordinateType: current.row['Coordinate Type'],
      priorVerificationNote: current.row['Verification Note'],
    },
  };
}

function assertReviewPreviewStillCurrent(current, preview) {
  assertFormalSnapshotUnchanged(
    current.row,
    preview.page.formalSnapshot
  );
  const currentGuard = {
    basisRevision: basisRevision(current.row),
    workflowRevision: workflowRevision({
      status: current.row.Status,
      dataSourceId: current.dataSourceId,
      inTrash: false,
    }),
    candidatePayload: current.row['Candidate Payload'],
    reviewNeeded: current.row['Review Needed'],
    priorReviewDecision: current.row['Review Decision'],
    priorCoordinateType: current.row['Coordinate Type'],
    priorVerificationNote: current.row['Verification Note'],
  };
  if (JSON.stringify(currentGuard) !== JSON.stringify(preview.guard)) {
    throw new Error(
      'Review inputs changed after preview; reload the page and review again'
    );
  }
}

function assertReviewPatchApplied(row, patch, formalSnapshotBefore) {
  assertFormalSnapshotUnchanged(row, formalSnapshotBefore);
  const mismatches = Object.entries(patch)
    .filter(([field, value]) => (row[field] || '') !== (value || ''))
    .map(([field]) => field);
  if (mismatches.length > 0) {
    throw new Error(
      `Post-write review verification failed: ${mismatches.join(', ')}`
    );
  }
}

export async function reviewPageDryRun({
  pageReference,
  decision,
  coordinateType,
  verificationNote,
  newEvidence,
  notionApiKey,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (!notionApiKey) throw new Error('Missing NOTION_API_KEY');
  assertSupportedRunnerDataSource(expectedDataSourceId);

  const pageId = parsePageReference(pageReference);
  const current = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  return buildReviewPreview({
    current,
    decision,
    coordinateType,
    verificationNote,
    newEvidence,
    nowIso: new Date(now).toISOString(),
    mode: 'dry-run',
  });
}

async function reviewPageConfirmUnlocked({
  pageReference,
  decision,
  coordinateType,
  verificationNote,
  newEvidence,
  notionApiKey,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
  fetchImpl = fetch,
  now = new Date(),
  onPreview = () => {},
}) {
  requireNotionApiKey(notionApiKey);
  assertWriteTarget({
    dataSourceId: expectedDataSourceId,
    expectedDataSourceId,
  });
  const preview = await reviewPageDryRun({
    pageReference,
    decision,
    coordinateType,
    verificationNote,
    newEvidence,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
    now,
  });
  Object.freeze(preview.proposedPatch);
  await onPreview(preview);

  const pageId = parsePageReference(pageReference);
  const beforeWrite = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  assertReviewPreviewStillCurrent(beforeWrite, preview);

  let recoveredAfterWriteError = false;
  try {
    await updateNotionReviewFields({
      pageId,
      dataSourceId: beforeWrite.dataSourceId,
      expectedDataSourceId,
      notionApiKey,
      patch: preview.proposedPatch,
      fetchImpl,
    });
  } catch (writeError) {
    try {
      const recovered = await readValidatedPage({
        pageId,
        notionApiKey,
        expectedDataSourceId,
        fetchImpl,
      });
      assertReviewPatchApplied(
        recovered.row,
        preview.proposedPatch,
        preview.page.formalSnapshot
      );
      recoveredAfterWriteError = true;
    } catch {
      throw new Error(
        `Notion review write failed and could not be recovered: ${writeError.message}`
      );
    }
  }

  const confirmed = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  assertReviewPatchApplied(
    confirmed.row,
    preview.proposedPatch,
    preview.page.formalSnapshot
  );

  return {
    ...preview,
    mode: 'confirm',
    writePerformed: true,
    verification: {
      reviewPatchMatched: true,
      formalFieldsUnchanged: true,
      recoveredAfterWriteError,
    },
  };
}

export async function reviewPageConfirm(options) {
  const pageId = parsePageReference(options?.pageReference);
  const pageLock = await acquirePageApplyLock({
    pageId,
    lockRoot: options?.lockRoot,
  });
  try {
    return await reviewPageConfirmUnlocked(options);
  } finally {
    await pageLock.release();
  }
}

const COORDINATE_CORRECTION_EMPTY_FIELDS = [
  'Candidate Summary',
  'Candidate Maps URL',
  'Candidate Payload',
  'Review Decision',
];

function coordinateCorrectionWorkflowSnapshot(row) {
  return {
    reviewNeeded: row['Review Needed'],
    candidateSummary: row['Candidate Summary'],
    candidateMapsUrl: row['Candidate Maps URL'],
    candidatePayload: row['Candidate Payload'],
    reviewDecision: row['Review Decision'],
    applyMetadata: row['Apply Metadata'],
  };
}

function assertCoordinateCorrectionReady(row) {
  if (row['Review Needed'] !== '__YES__') {
    throw new Error(
      'Coordinate correction requires Review Needed to be checked'
    );
  }
  const occupied = COORDINATE_CORRECTION_EMPTY_FIELDS.filter((field) =>
    String(row[field] || '').trim()
  );
  if (occupied.length > 0) {
    throw new Error(
      `Clear Candidate and Review fields before correcting coordinates: ${occupied.join(', ')}`
    );
  }
  const metadata = parseApplyMetadataEnvelope(row['Apply Metadata']);
  if (metadata?.state === 'pending') {
    throw new Error(
      'Coordinate correction is blocked while Apply Metadata is pending'
    );
  }
}

function buildCoordinateCorrectionPreview({
  current,
  lat,
  lng,
  sourceUrl,
  sourceConfirmed,
  nowIso,
  mode,
}) {
  assertCoordinateCorrectionReady(current.row);
  if (sourceConfirmed !== true) {
    throw new Error(
      'Confirm that the coordinates come from a traceable non-Places source'
    );
  }
  const normalizedLat = normalizeCoordinateCorrectionValue(
    lat,
    'Lat',
    -90,
    90
  );
  const normalizedLng = normalizeCoordinateCorrectionValue(
    lng,
    'Lng',
    -180,
    180
  );
  if (
    current.row.Lat === normalizedLat &&
    current.row.Lng === normalizedLng
  ) {
    throw new Error('Lat/Lng already match the proposed coordinates');
  }

  const normalizedSourceUrl = normalizeCoordinateSourceUrl(sourceUrl);
  const existingSources = listedSourceUrls(current.row['Source URLs']);
  const sourceAlreadyRecorded = existingSources.some(
    (existingSource) =>
      canonicalSourceUrl(existingSource) === normalizedSourceUrl
  );
  const nextSources = sourceAlreadyRecorded
    ? current.row['Source URLs']
    : [...existingSources, normalizedSourceUrl].join('\n');
  const proposedPatch = {
    Lat: normalizedLat,
    Lng: normalizedLng,
    ...(sourceAlreadyRecorded
      ? {}
      : { 'Source URLs': nextSources }),
  };
  const distanceMeters =
    Number.isFinite(current.row.Lat) &&
    Number.isFinite(current.row.Lng)
      ? Math.round(
          haversineMeters(
            current.row.Lat,
            current.row.Lng,
            normalizedLat,
            normalizedLng
          )
        )
      : null;

  return {
    mode,
    writePerformed: false,
    page: {
      id: current.page.id,
      url: current.page.url,
      dataSourceId: current.dataSourceId,
      name: current.row.Name,
      slug: current.row.Slug,
      status: current.row.Status,
      reviewNeeded: current.row['Review Needed'],
      reviewDecision: current.row['Review Decision'],
      verificationNote: current.row['Verification Note'],
      formalSnapshot: formalSnapshot(current.row),
    },
    coordinateCorrection: {
      now: nowIso,
      sourceUrl: normalizedSourceUrl,
      sourceAlreadyRecorded,
      distanceMeters,
    },
    apply: { now: nowIso },
    proposedPatch,
    expectedFormalChanges: { ...proposedPatch },
    guard: {
      basisRevision: basisRevision(current.row),
      workflowRevision: workflowRevision({
        status: current.row.Status,
        dataSourceId: current.dataSourceId,
        inTrash: false,
      }),
      workflow: coordinateCorrectionWorkflowSnapshot(current.row),
    },
  };
}

function assertCoordinateCorrectionPreviewStillCurrent(
  current,
  preview
) {
  assertFormalSnapshotUnchanged(
    current.row,
    preview.page.formalSnapshot
  );
  const guard = {
    basisRevision: basisRevision(current.row),
    workflowRevision: workflowRevision({
      status: current.row.Status,
      dataSourceId: current.dataSourceId,
      inTrash: false,
    }),
    workflow: coordinateCorrectionWorkflowSnapshot(current.row),
  };
  if (JSON.stringify(guard) !== JSON.stringify(preview.guard)) {
    throw new Error(
      'Coordinate correction inputs changed after preview; preview again'
    );
  }
  assertCoordinateCorrectionReady(current.row);
}

function assertCoordinateCorrectionApplied(row, preview) {
  const expectedFormalSnapshot = {
    ...preview.page.formalSnapshot,
    ...preview.proposedPatch,
  };
  assertFormalSnapshotUnchanged(row, expectedFormalSnapshot);
  if (
    JSON.stringify(coordinateCorrectionWorkflowSnapshot(row)) !==
    JSON.stringify(preview.guard.workflow)
  ) {
    throw new Error(
      'Coordinate correction unexpectedly changed workflow fields'
    );
  }
}

export async function coordinateCorrectionPageDryRun({
  pageReference,
  lat,
  lng,
  sourceUrl,
  sourceConfirmed,
  notionApiKey,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (!notionApiKey) throw new Error('Missing NOTION_API_KEY');
  assertSupportedRunnerDataSource(expectedDataSourceId);
  const pageId = parsePageReference(pageReference);
  const current = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  return buildCoordinateCorrectionPreview({
    current,
    lat,
    lng,
    sourceUrl,
    sourceConfirmed,
    nowIso: new Date(now).toISOString(),
    mode: 'dry-run',
  });
}

async function coordinateCorrectionPageConfirmUnlocked({
  pageReference,
  lat,
  lng,
  sourceUrl,
  sourceConfirmed,
  notionApiKey,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
  fetchImpl = fetch,
  now = new Date(),
  onPreview = () => {},
  onBeforeWrite = () => {},
}) {
  requireNotionApiKey(notionApiKey);
  assertWriteTarget({
    dataSourceId: expectedDataSourceId,
    expectedDataSourceId,
  });
  const preview = await coordinateCorrectionPageDryRun({
    pageReference,
    lat,
    lng,
    sourceUrl,
    sourceConfirmed,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
    now,
  });
  Object.freeze(preview.proposedPatch);
  await onPreview(preview);

  const pageId = parsePageReference(pageReference);
  const beforeWrite = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  assertCoordinateCorrectionPreviewStillCurrent(beforeWrite, preview);
  await onBeforeWrite(preview);

  let recoveredAfterWriteError = false;
  try {
    await updateNotionCoordinateCorrectionFields({
      pageId,
      dataSourceId: beforeWrite.dataSourceId,
      expectedDataSourceId,
      notionApiKey,
      patch: preview.proposedPatch,
      fetchImpl,
    });
  } catch (writeError) {
    try {
      const recovered = await readValidatedPage({
        pageId,
        notionApiKey,
        expectedDataSourceId,
        fetchImpl,
      });
      assertCoordinateCorrectionApplied(recovered.row, preview);
      recoveredAfterWriteError = true;
    } catch {
      throw new Error(
        `Notion coordinate correction failed and could not be recovered: ${writeError.message}`
      );
    }
  }

  const confirmed = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  assertCoordinateCorrectionApplied(confirmed.row, preview);
  return {
    ...preview,
    mode: 'confirm',
    writePerformed: true,
    verification: {
      coordinatePatchMatched: true,
      workflowFieldsUnchanged: true,
      recoveredAfterWriteError,
    },
  };
}

export async function coordinateCorrectionPageConfirm(options) {
  const pageId = parsePageReference(options?.pageReference);
  const pageLock = await acquirePageApplyLock({
    pageId,
    lockRoot: options?.lockRoot,
  });
  try {
    return await coordinateCorrectionPageConfirmUnlocked(options);
  } finally {
    await pageLock.release();
  }
}

const CANDIDATE_RESET_FIELDS = [
  'Candidate Summary',
  'Candidate Maps URL',
  'Candidate Payload',
  'Review Decision',
];

function candidateResetGuard(row, dataSourceId) {
  return {
    basisRevision: basisRevision(row),
    workflowRevision: workflowRevision({
      status: row.Status,
      dataSourceId,
      inTrash: false,
    }),
    reviewNeeded: row['Review Needed'],
    candidateSummary: row['Candidate Summary'],
    candidateMapsUrl: row['Candidate Maps URL'],
    candidatePayload: row['Candidate Payload'],
    reviewDecision: row['Review Decision'],
    coordinateType: row['Coordinate Type'],
    verificationNote: row['Verification Note'],
    rejectedPlaceIds: row['Rejected Place IDs'],
    applyMetadata: row['Apply Metadata'],
  };
}

function buildCandidateResetPreview({
  current,
  reason,
  nowIso,
  mode,
}) {
  const normalizedReason = String(reason || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!normalizedReason) {
    throw new Error('Candidate reset reason is required');
  }
  if (normalizedReason.length > 500) {
    throw new Error('Candidate reset reason must be 500 characters or fewer');
  }
  const occupiedFields = CANDIDATE_RESET_FIELDS.filter((field) =>
    String(current.row[field] || '').trim()
  );
  if (occupiedFields.length === 0) {
    throw new Error('No Candidate workflow fields exist to reset');
  }
  const applyMetadata = parseApplyMetadataEnvelope(
    current.row['Apply Metadata']
  );
  if (applyMetadata?.state === 'pending') {
    throw new Error('Cannot reset Candidate while Apply Metadata is pending');
  }

  let reviewRunId = 'unreadable';
  try {
    if (current.row['Candidate Payload']) {
      reviewRunId =
        parseCandidateEnvelope(current.row['Candidate Payload'])
          .reviewRunId || 'unreadable';
    }
  } catch {
    // Invalid Candidate payloads are an intended recovery case.
  }
  const auditEntry =
    `[${nowIso}] candidate-reset reviewRunId=${reviewRunId} reason=${normalizedReason}`;
  const priorVerificationNote = String(
    current.row['Verification Note'] || ''
  ).trim();
  const proposedPatch = {
    'Review Needed': '__YES__',
    'Candidate Summary': null,
    'Candidate Maps URL': null,
    'Candidate Payload': null,
    'Review Decision': null,
    'Verification Note': [priorVerificationNote, auditEntry]
      .filter(Boolean)
      .join('\n'),
  };
  candidateResetPatchToNotionProperties(proposedPatch);

  return {
    mode,
    writePerformed: false,
    page: {
      id: current.page.id,
      url: current.page.url,
      dataSourceId: current.dataSourceId,
      name: current.row.Name,
      slug: current.row.Slug,
      status: current.row.Status,
      reviewNeeded: current.row['Review Needed'],
      formalSnapshot: formalSnapshot(current.row),
    },
    reset: {
      reason: normalizedReason,
      reviewRunId,
      occupiedFields,
      auditEntry,
    },
    proposedPatch,
    guard: candidateResetGuard(current.row, current.dataSourceId),
  };
}

function assertCandidateResetPreviewStillCurrent(current, preview) {
  assertFormalSnapshotUnchanged(
    current.row,
    preview.page.formalSnapshot
  );
  if (
    JSON.stringify(
      candidateResetGuard(current.row, current.dataSourceId)
    ) !== JSON.stringify(preview.guard)
  ) {
    throw new Error(
      'Candidate reset inputs changed after preview; reload and preview again'
    );
  }
}

function assertCandidateResetApplied(row, preview) {
  assertFormalSnapshotUnchanged(row, preview.page.formalSnapshot);
  const mismatches = Object.entries(preview.proposedPatch)
    .filter(([field, value]) => (row[field] || '') !== (value || ''))
    .map(([field]) => field);
  if (mismatches.length > 0) {
    throw new Error(
      `Post-write candidate reset verification failed: ${mismatches.join(', ')}`
    );
  }
  const preservedFields = [
    'Coordinate Type',
    'Rejected Place IDs',
    'Apply Metadata',
  ];
  const preservedMismatches = preservedFields.filter((field) => {
    const guardField = {
      'Coordinate Type': 'coordinateType',
      'Rejected Place IDs': 'rejectedPlaceIds',
      'Apply Metadata': 'applyMetadata',
    }[field];
    return row[field] !== preview.guard[guardField];
  });
  if (preservedMismatches.length > 0) {
    throw new Error(
      `Candidate reset changed preserved fields: ${preservedMismatches.join(', ')}`
    );
  }
}

export async function candidateResetPageDryRun({
  pageReference,
  reason,
  notionApiKey,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (!notionApiKey) throw new Error('Missing NOTION_API_KEY');
  assertSupportedRunnerDataSource(expectedDataSourceId);
  const pageId = parsePageReference(pageReference);
  const current = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  return buildCandidateResetPreview({
    current,
    reason,
    nowIso: new Date(now).toISOString(),
    mode: 'dry-run',
  });
}

async function candidateResetPageConfirmUnlocked({
  pageReference,
  reason,
  notionApiKey,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
  fetchImpl = fetch,
  now = new Date(),
  onPreview = () => {},
}) {
  requireNotionApiKey(notionApiKey);
  assertWriteTarget({
    dataSourceId: expectedDataSourceId,
    expectedDataSourceId,
  });
  const preview = await candidateResetPageDryRun({
    pageReference,
    reason,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
    now,
  });
  Object.freeze(preview.proposedPatch);
  await onPreview(preview);

  const pageId = parsePageReference(pageReference);
  const beforeWrite = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  assertCandidateResetPreviewStillCurrent(beforeWrite, preview);

  let recoveredAfterWriteError = false;
  try {
    await updateNotionCandidateResetFields({
      pageId,
      dataSourceId: beforeWrite.dataSourceId,
      expectedDataSourceId,
      notionApiKey,
      patch: preview.proposedPatch,
      fetchImpl,
    });
  } catch (writeError) {
    try {
      const recovered = await readValidatedPage({
        pageId,
        notionApiKey,
        expectedDataSourceId,
        fetchImpl,
      });
      assertCandidateResetApplied(recovered.row, preview);
      recoveredAfterWriteError = true;
    } catch {
      throw new Error(
        `Notion candidate reset failed and could not be recovered: ${writeError.message}`
      );
    }
  }

  const confirmed = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  assertCandidateResetApplied(confirmed.row, preview);
  return {
    ...preview,
    mode: 'confirm',
    writePerformed: true,
    verification: {
      candidateFieldsCleared: true,
      preservedFieldsUnchanged: true,
      formalFieldsUnchanged: true,
      recoveredAfterWriteError,
    },
  };
}

export async function candidateResetPageConfirm(options) {
  const pageId = parsePageReference(options?.pageReference);
  const pageLock = await acquirePageApplyLock({
    pageId,
    lockRoot: options?.lockRoot,
  });
  try {
    return await candidateResetPageConfirmUnlocked(options);
  } finally {
    await pageLock.release();
  }
}

async function assertNoApplyDuplicatePlaceId({
  current,
  notionApiKey,
  fetchImpl,
}) {
  if (
    !['Accept Candidate', 'Reject Candidate'].includes(
      current.row['Review Decision']
    )
  ) {
    return;
  }
  const payload = candidatePayloadForApply(current.row);
  if (payload?.result !== 'place_id_candidate') return;
  const duplicatePages = await findDuplicatePlaceIds({
    placeId: payload.placeId,
    currentPageId: current.page.id,
    notionApiKey,
    dataSourceId: current.dataSourceId,
    fetchImpl,
  });
  if (duplicatePages.length > 0) {
    const conflicts = duplicatePages
      .map((page) => page.slug || page.name || page.id)
      .join(', ');
    throw new Error(
      `Candidate Place ID conflicts with another location: ${conflicts}`
    );
  }
}

function buildApplyPreview({
  current,
  actionRunId,
  nowIso,
  mode,
  resumedFromPending = false,
}) {
  const candidatePayload = candidatePayloadForApply(current.row);
  const pendingPatch = buildPendingApplyPatch({
    row: current.row,
    dataSourceId: current.dataSourceId,
    expectedDataSourceId: current.dataSourceId,
    actionRunId,
    now: nowIso,
  });
  const completedPatch = buildCompletedApplyPatch({
    row: current.row,
    dataSourceId: current.dataSourceId,
    expectedDataSourceId: current.dataSourceId,
    allowLegacySourceStatus:
      current.dataSourceId === FORMAL_DATA_SOURCE_ID,
    actionRunId,
    now: nowIso,
  });

  return {
    mode,
    writePerformed: false,
    page: {
      id: current.page.id,
      url: current.page.url,
      dataSourceId: current.dataSourceId,
      name: current.row.Name,
      slug: current.row.Slug,
      status: current.row.Status,
      reviewNeeded: current.row['Review Needed'],
      reviewDecision: current.row['Review Decision'],
      coordinateType: current.row['Coordinate Type'],
      verificationNote: current.row['Verification Note'],
      rejectedPlaceIds: current.row['Rejected Place IDs'],
      formalSnapshot: formalSnapshot(current.row),
    },
    apply: {
      actionRunId,
      reviewRunId: candidatePayload?.reviewRunId || null,
      candidateResult: candidatePayload?.result || null,
      now: nowIso,
      resumedFromPending,
    },
    pendingPatch,
    completedPatch,
    expectedFormalChanges: Object.fromEntries(
      Object.entries(completedPatch).filter(([field]) =>
        FORMAL_FIELDS.includes(field)
      )
    ),
  };
}

function assertApplyPreviewStillCurrent(current, preview) {
  const rebuilt = buildApplyPreview({
    current,
    actionRunId: preview.apply.actionRunId,
    nowIso: preview.apply.now,
    mode: preview.mode,
    resumedFromPending: preview.apply.resumedFromPending,
  });
  if (
    JSON.stringify(rebuilt.pendingPatch) !==
      JSON.stringify(preview.pendingPatch) ||
    JSON.stringify(rebuilt.completedPatch) !==
      JSON.stringify(preview.completedPatch)
  ) {
    throw new Error(
      'Apply inputs changed after preview; review the page and run apply again'
    );
  }
}

function expectedFormalSnapshot(beforeSnapshot, completedPatch) {
  const expected = { ...beforeSnapshot };
  for (const field of FORMAL_FIELDS) {
    if (Object.hasOwn(completedPatch, field)) {
      expected[field] = completedPatch[field];
    }
  }
  return expected;
}

function notionDateMinute(value) {
  const date = new Date(value);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

function comparableApplyValue(row, field) {
  if (field.startsWith('date:') && field.endsWith(':start')) {
    const value = row[field.slice('date:'.length, -':start'.length)];
    return value ? notionDateMinute(value) : null;
  }
  if (field.endsWith(':is_datetime')) return 1;
  if (
    APPLY_RICH_TEXT_FIELDS.has(field) ||
    APPLY_URL_FIELDS.has(field) ||
    APPLY_SELECT_FIELDS.has(field)
  ) {
    return row[field] || null;
  }
  return row[field];
}

function assertApplyPatchApplied(row, patch, beforeFormalSnapshot) {
  const expectedSnapshot = expectedFormalSnapshot(
    beforeFormalSnapshot,
    patch
  );
  assertFormalSnapshotUnchanged(row, expectedSnapshot);

  const mismatches = [];
  for (const [field, expectedValue] of Object.entries(patch)) {
    const comparableExpected = field.startsWith('date:') &&
      field.endsWith(':start')
      ? notionDateMinute(expectedValue)
      : expectedValue === null || expectedValue === ''
        ? null
        : expectedValue;
    if (comparableApplyValue(row, field) !== comparableExpected) {
      mismatches.push(field);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Post-write apply verification failed: ${mismatches.join(', ')}`
    );
  }
}

function assertPendingMatchesCurrentRequest(current, metadata) {
  if (metadata.state !== 'pending') {
    throw new Error(`Cannot resume Apply Metadata state=${metadata.state}`);
  }
  const candidatePayload = candidatePayloadForApply(current.row);
  const reviewRunId = candidatePayload?.reviewRunId || null;
  if (
    metadata.decision !== current.row['Review Decision'] ||
    metadata.reviewRunId !== reviewRunId
  ) {
    throw new Error(
      'Existing pending action does not match the current review request'
    );
  }
  const expectedPending = buildPendingApplyPatch({
    row: current.row,
    dataSourceId: current.dataSourceId,
    expectedDataSourceId: current.dataSourceId,
    actionRunId: metadata.actionRunId,
    now: metadata.updatedAt,
  });
  if (expectedPending['Apply Metadata'] !== current.row['Apply Metadata']) {
    throw new Error(
      'Existing pending action no longer matches the current basis revision'
    );
  }
}

function hasActiveApplyRequest(row) {
  return Boolean(
    String(row['Review Decision'] || '').trim() ||
      String(row['Candidate Payload'] || '').trim()
  );
}

function completedMetadataMatchesCurrentRequest(current, metadata) {
  if (!hasActiveApplyRequest(current.row)) return true;
  if (current.row['Review Decision'] !== metadata.decision) return false;
  const candidatePayload = candidatePayloadForApply(current.row);
  return (candidatePayload?.reviewRunId || null) === metadata.reviewRunId;
}

function assertCompletedActionStillApplied(current, metadata) {
  if (metadata.state !== 'completed') {
    throw new Error('Apply Metadata is not completed');
  }
  if (
    !String(current.row['Verification Note'] || '').includes(
      `actionRunId=${metadata.actionRunId}`
    )
  ) {
    throw new Error('Completed action is missing from Verification Note');
  }
  const expectedState = {
    'Accept Candidate': ['Published', '__NO__'],
    'Keep Current': ['Published', '__NO__'],
    'Reject Candidate': [current.row.Status, '__YES__'],
    'Need Research': [current.row.Status, '__YES__'],
    'Could Not Find': ['Inactive', '__NO__'],
    Deactivate: ['Inactive', '__NO__'],
  }[metadata.decision];
  if (
    current.row.Status !== expectedState[0] ||
    current.row['Review Needed'] !== expectedState[1]
  ) {
    throw new Error('Completed action no longer matches the page workflow state');
  }
  if (
    metadata.decision !== 'Need Research' &&
    [
      'Candidate Summary',
      'Candidate Maps URL',
      'Candidate Payload',
      'Review Decision',
    ].some((field) => String(current.row[field] || '').trim())
  ) {
    throw new Error('Completed action did not clear candidate workflow fields');
  }
}

async function resolvePageWriteUnlocked({
  pageReference,
  notionApiKey,
  googlePlacesKey,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
  fetchImpl = fetch,
  now = new Date(),
  randomUUIDImpl = randomUUID,
  onPreview = () => {},
}) {
  requireNotionApiKey(notionApiKey);
  assertWriteTarget({
    dataSourceId: expectedDataSourceId,
    expectedDataSourceId,
  });
  const preview = await resolvePageDryRun({
    pageReference,
    notionApiKey,
    googlePlacesKey,
    expectedDataSourceId,
    fetchImpl,
    now,
    randomUUIDImpl,
    placesApiMode: 'legacy',
    rejectExistingCandidate: true,
  });
  Object.freeze(preview.proposedPatch);
  await onPreview(preview);

  const pageId = parsePageReference(pageReference);
  const beforeWrite = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  assertNoExistingCandidate(beforeWrite.row);
  assertFormalSnapshotUnchanged(
    beforeWrite.row,
    preview.page.formalSnapshot
  );
  assertProposedRevisions(
    beforeWrite.row,
    beforeWrite.dataSourceId,
    preview.proposedPatch
  );

  let recoveredAfterWriteError = false;
  try {
    await updateNotionCandidateFields({
      pageId,
      dataSourceId: beforeWrite.dataSourceId,
      expectedDataSourceId,
      notionApiKey,
      patch: preview.proposedPatch,
      fetchImpl,
    });
  } catch (writeError) {
    try {
      const recovered = await readValidatedPage({
        pageId,
        notionApiKey,
        expectedDataSourceId,
        fetchImpl,
      });
      assertCandidatePatchApplied(
        recovered.row,
        preview.proposedPatch,
        preview.page.formalSnapshot
      );
      recoveredAfterWriteError = true;
    } catch {
      throw new Error(
        `Notion candidate write failed and could not be recovered: ${writeError.message}`
      );
    }
  }

  const confirmed = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  assertCandidatePatchApplied(
    confirmed.row,
    preview.proposedPatch,
    preview.page.formalSnapshot
  );

  return {
    ...preview,
    mode: 'write',
    writePerformed: true,
    verification: {
      candidatePatchMatched: true,
      formalFieldsUnchanged: true,
      recoveredAfterWriteError,
    },
  };
}

export async function resolvePageWrite(options) {
  const pageId = parsePageReference(options?.pageReference);
  const pageLock = await acquirePageApplyLock({
    pageId,
    lockRoot: options?.lockRoot,
  });
  try {
    return await resolvePageWriteUnlocked(options);
  } finally {
    await pageLock.release();
  }
}

export async function applyPageDryRun({
  pageReference,
  notionApiKey,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
  fetchImpl = fetch,
  now = new Date(),
  randomUUIDImpl = randomUUID,
}) {
  if (!notionApiKey) throw new Error('Missing NOTION_API_KEY');
  assertSupportedRunnerDataSource(expectedDataSourceId);

  const pageId = parsePageReference(pageReference);
  const current = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  await assertNoApplyDuplicatePlaceId({
    current,
    notionApiKey,
    fetchImpl,
  });
  const nowIso = new Date(now).toISOString();
  const actionRunId = `action-${randomUUIDImpl()}`;
  return buildApplyPreview({
    current,
    actionRunId,
    nowIso,
    mode: 'dry-run',
  });
}

async function applyPageConfirmUnlocked({
  pageReference,
  notionApiKey,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID,
  fetchImpl = fetch,
  now = new Date(),
  randomUUIDImpl = randomUUID,
  approvedActionRunId = null,
  onPreview = () => {},
  onBeforePendingWrite = () => {},
}) {
  requireNotionApiKey(notionApiKey);
  assertWriteTarget({
    dataSourceId: expectedDataSourceId,
    expectedDataSourceId,
  });

  const pageId = parsePageReference(pageReference);
  const initial = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  const existingMetadata = parseApplyMetadataEnvelope(
    initial.row['Apply Metadata']
  );

  if (
    existingMetadata?.state === 'completed' &&
    completedMetadataMatchesCurrentRequest(initial, existingMetadata)
  ) {
    assertCompletedActionStillApplied(initial, existingMetadata);
    return {
      mode: 'confirm',
      writePerformed: false,
      alreadyCompleted: true,
      page: {
        id: initial.page.id,
        url: initial.page.url,
        dataSourceId: initial.dataSourceId,
        name: initial.row.Name,
        slug: initial.row.Slug,
        status: initial.row.Status,
        reviewNeeded: initial.row['Review Needed'],
      },
      apply: {
        actionRunId: existingMetadata.actionRunId,
        reviewRunId: existingMetadata.reviewRunId,
        candidateResult: null,
        now: existingMetadata.updatedAt,
        resumedFromPending: false,
      },
      verification: {
        pendingPatchMatched: true,
        completedPatchMatched: true,
        formalFieldsMatched: true,
        recoveredPendingWrite: false,
        recoveredCompletedWrite: false,
      },
    };
  }
  if (existingMetadata?.state === 'failed') {
    throw new Error(
      'Existing failed action requires explicit recovery before a new apply'
    );
  }
  await assertNoApplyDuplicatePlaceId({
    current: initial,
    notionApiKey,
    fetchImpl,
  });

  if (
    approvedActionRunId !== null &&
    !String(approvedActionRunId).startsWith('action-')
  ) {
    throw new Error('Approved actionRunId is invalid');
  }
  let actionRunId =
    approvedActionRunId || `action-${randomUUIDImpl()}`;
  let nowIso = new Date(now).toISOString();
  let resumedFromPending = false;
  if (existingMetadata?.state === 'pending') {
    assertPendingMatchesCurrentRequest(initial, existingMetadata);
    actionRunId = existingMetadata.actionRunId;
    nowIso = existingMetadata.updatedAt;
    resumedFromPending = true;
  }

  const preview = buildApplyPreview({
    current: initial,
    actionRunId,
    nowIso,
    mode: 'confirm',
    resumedFromPending,
  });
  Object.freeze(preview.pendingPatch);
  Object.freeze(preview.completedPatch);
  await onPreview(preview);

  const beforePending = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  await assertNoApplyDuplicatePlaceId({
    current: beforePending,
    notionApiKey,
    fetchImpl,
  });
  if (resumedFromPending) {
    const currentMetadata = parseApplyMetadataEnvelope(
      beforePending.row['Apply Metadata']
    );
    if (currentMetadata?.actionRunId !== actionRunId) {
      throw new Error('Pending action changed before resume');
    }
    assertPendingMatchesCurrentRequest(beforePending, currentMetadata);
  } else if (
    beforePending.row['Apply Metadata'] !== initial.row['Apply Metadata']
  ) {
    throw new Error('Apply Metadata changed after preview');
  }
  assertApplyPreviewStillCurrent(beforePending, preview);
  await onBeforePendingWrite(preview);

  let recoveredPendingWrite = false;
  let pendingPage = beforePending;
  if (!resumedFromPending) {
    try {
      await updateNotionApplyFields({
        pageId,
        dataSourceId: beforePending.dataSourceId,
        expectedDataSourceId,
        notionApiKey,
        patch: preview.pendingPatch,
        fetchImpl,
        label: 'Notion pending apply write',
      });
    } catch (writeError) {
      try {
        const recovered = await readValidatedPage({
          pageId,
          notionApiKey,
          expectedDataSourceId,
          fetchImpl,
        });
        assertApplyPatchApplied(
          recovered.row,
          preview.pendingPatch,
          preview.page.formalSnapshot
        );
        pendingPage = recovered;
        recoveredPendingWrite = true;
      } catch {
        throw new Error(
          `Notion pending apply write failed: ${writeError.message}`
        );
      }
    }
    if (!recoveredPendingWrite) {
      pendingPage = await readValidatedPage({
        pageId,
        notionApiKey,
        expectedDataSourceId,
        fetchImpl,
      });
    }
  }
  assertApplyPatchApplied(
    pendingPage.row,
    preview.pendingPatch,
    preview.page.formalSnapshot
  );
  assertApplyPreviewStillCurrent(pendingPage, preview);
  await assertNoApplyDuplicatePlaceId({
    current: pendingPage,
    notionApiKey,
    fetchImpl,
  });

  let recoveredCompletedWrite = false;
  try {
    await updateNotionApplyFields({
      pageId,
      dataSourceId: pendingPage.dataSourceId,
      expectedDataSourceId,
      notionApiKey,
      patch: preview.completedPatch,
      fetchImpl,
      label: 'Notion completed apply write',
    });
  } catch (writeError) {
    try {
      const recovered = await readValidatedPage({
        pageId,
        notionApiKey,
        expectedDataSourceId,
        fetchImpl,
      });
      assertApplyPatchApplied(
        recovered.row,
        preview.completedPatch,
        preview.page.formalSnapshot
      );
      recoveredCompletedWrite = true;
    } catch {
      throw new Error(
        `Notion completed apply write failed; pending action preserved: ${writeError.message}`
      );
    }
  }

  const confirmed = await readValidatedPage({
    pageId,
    notionApiKey,
    expectedDataSourceId,
    fetchImpl,
  });
  assertApplyPatchApplied(
    confirmed.row,
    preview.completedPatch,
    preview.page.formalSnapshot
  );

  return {
    ...preview,
    writePerformed: true,
    alreadyCompleted: false,
    page: {
      ...preview.page,
      status: confirmed.row.Status,
      reviewNeeded: confirmed.row['Review Needed'],
    },
    verification: {
      pendingPatchMatched: true,
      completedPatchMatched: true,
      formalFieldsMatched: true,
      recoveredPendingWrite,
      recoveredCompletedWrite,
    },
  };
}

export async function applyPageConfirm(options) {
  const pageId = parsePageReference(options?.pageReference);
  const pageLock = await acquirePageApplyLock({
    pageId,
    lockRoot: options?.lockRoot,
  });
  try {
    return await applyPageConfirmUnlocked(options);
  } finally {
    await pageLock.release();
  }
}

export function parseRunnerArgs(args) {
  const [command, ...rest] = args;
  if (command === '--help' || command === '-h') return { help: true };
  if (command === 'lock') {
    const [operation, ...lockArgs] = rest;
    if (!['inspect', 'clear'].includes(operation)) {
      throw new Error(
        'Usage: location:verify -- lock <inspect|clear> --page <page-id-or-url> [--confirm]'
      );
    }
    let pageReference = '';
    let confirm = false;
    for (let index = 0; index < lockArgs.length; index += 1) {
      const arg = lockArgs[index];
      if (arg === '--page') {
        pageReference = lockArgs[index + 1] || '';
        index += 1;
      } else if (arg.startsWith('--page=')) {
        pageReference = arg.slice('--page='.length);
      } else if (arg === '--confirm') {
        confirm = true;
      } else {
        throw new Error(`Unknown lock argument: ${arg}`);
      }
    }
    if (!pageReference) throw new Error('--page is required');
    if (operation === 'inspect' && confirm) {
      throw new Error('--confirm is only valid for lock clear');
    }
    if (operation === 'clear' && !confirm) {
      throw new Error('lock clear requires --confirm');
    }
    return {
      command,
      operation,
      pageReference,
      confirm,
    };
  }
  if (command === 'validate') {
    if (rest.length !== 1 || rest[0] !== '--all') {
      throw new Error('Usage: location:verify -- validate --all');
    }
    return { command, mode: 'all' };
  }
  if (command === 'production-preflight') {
    let pageReference = '';
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === '--page') {
        pageReference = rest[index + 1] || '';
        index += 1;
      } else if (arg.startsWith('--page=')) {
        pageReference = arg.slice('--page='.length);
      } else if (arg === '--dry-run') {
        // Explicitly accepted for readability; read-only is always the default.
      } else if (arg === '--write' || arg === '--confirm') {
        throw new Error(
          'production-preflight is read-only; --write and --confirm are not supported'
        );
      } else {
        throw new Error(`Unknown production-preflight argument: ${arg}`);
      }
    }
    if (!pageReference) throw new Error('--page is required');
    return {
      command,
      pageReference,
      mode: 'dry-run',
    };
  }
  if (!['resolve', 'apply'].includes(command)) {
    throw new Error(
      'Usage: location:verify -- <resolve|apply|validate|production-preflight|lock> [options]'
    );
  }

  let pageReference = '';
  let requestedMode = null;
  let placesApiMode = 'legacy';
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--page') {
      pageReference = rest[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--page=')) {
      pageReference = arg.slice('--page='.length);
    } else if (arg === '--dry-run') {
      if (requestedMode && requestedMode !== 'dry-run') {
        throw new Error('Choose exactly one execution mode');
      }
      requestedMode = 'dry-run';
    } else if (arg === '--write') {
      if (command !== 'resolve') {
        throw new Error('--write is only valid for resolve');
      }
      if (requestedMode && requestedMode !== 'write') {
        throw new Error('Choose exactly one execution mode');
      }
      requestedMode = 'write';
    } else if (arg === '--confirm') {
      if (command !== 'apply') {
        throw new Error('--confirm is only valid for apply');
      }
      if (requestedMode && requestedMode !== 'confirm') {
        throw new Error('Choose exactly one execution mode');
      }
      requestedMode = 'confirm';
    } else if (arg === '--places-api') {
      if (command !== 'resolve') {
        throw new Error('--places-api is only valid for resolve');
      }
      placesApiMode = rest[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--places-api=')) {
      if (command !== 'resolve') {
        throw new Error('--places-api is only valid for resolve');
      }
      placesApiMode = arg.slice('--places-api='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!pageReference) throw new Error('--page is required');
  if (placesApiMode !== 'legacy') {
    throw new Error('--places-api must be legacy');
  }
  return {
    command,
    pageReference,
    mode: requestedMode || 'dry-run',
    placesApiMode,
  };
}

function formatValue(value) {
  return value === null || value === '' ? '(none)' : String(value);
}

export function formatResolvePreview(result, { writeIntent = false } = {}) {
  const lines = [
    writeIntent
      ? 'LOCATION VERIFICATION — RESOLVE WRITE PREVIEW'
      : 'LOCATION VERIFICATION — RESOLVE DRY-RUN',
    '',
    'Notion page',
    `  Name: ${result.page.name}`,
    `  Slug: ${result.page.slug}`,
    `  Page: ${result.page.url}`,
    `  Data source: ${result.page.dataSourceId}`,
    `  Status: ${result.page.status}`,
    `  Review Needed: ${result.page.reviewNeeded}`,
    `  Current Place ID: ${formatValue(result.page.currentPlaceId)}`,
    '',
    'Resolver',
    `  Result: ${result.resolver.result}`,
    `  Source: ${result.resolver.candidateSource}`,
    `  API mode: ${result.resolver.apiMode}`,
    `  Query: ${result.resolver.query}`,
    `  reviewRunId: ${result.resolver.reviewRunId}`,
    `  Review expires: ${result.resolver.reviewExpiresAt}`,
  ];

  if (result.resolver.candidates.length > 0) {
    lines.push('', 'Google Maps candidates — temporary interactive display');
    lines.push('  Attribution: Google Maps');
    for (const [index, candidate] of result.resolver.candidates.entries()) {
      lines.push(
        `  ${index + 1}. ${candidate.name || '(name unavailable)'}`,
        `     Place ID: ${candidate.placeId}`,
        `     Address: ${formatValue(candidate.address)}`,
        `     Coordinates: ${formatValue(candidate.lat)}, ${formatValue(candidate.lng)}`,
        `     Business status: ${formatValue(candidate.businessStatus)}`,
        `     Distance from current coordinates: ${
          candidate.distanceMeters === null ? '(unknown)' : `${candidate.distanceMeters} m`
        }`,
        `     Distance risk: ${candidate.distanceRisk}`,
        `     Google Maps: ${formatValue(candidate.mapsUrl)}`
      );
    }
  }

  if (result.resolver.duplicatePages.length > 0) {
    lines.push('', 'Duplicate Place ID block');
    for (const page of result.resolver.duplicatePages) {
      lines.push(`  - ${page.name} (${page.slug || page.id})`);
    }
  }

  lines.push(
    '',
    'Proposed Notion patch',
    JSON.stringify(result.proposedPatch, null, 2),
    '',
    writeIntent
      ? 'NOTION_WRITE_PERFORMED=pending (--write explicitly requested)'
      : 'NOTION_WRITE_PERFORMED=false',
    'Do not redirect this interactive output to a file; it may contain transient Places content.'
  );
  return `${lines.join('\n')}\n`;
}

export function formatDryRun(result) {
  return formatResolvePreview(result);
}

export function formatWriteResult(result) {
  return [
    '',
    'LOCATION VERIFICATION — RESOLVE WRITE COMPLETE',
    `  Page: ${result.page.url}`,
    `  reviewRunId: ${result.resolver.reviewRunId}`,
    `  Result: ${result.resolver.result}`,
    `  Candidate patch matched: ${result.verification.candidatePatchMatched}`,
    `  Formal fields unchanged: ${result.verification.formalFieldsUnchanged}`,
    `  Recovered after write error: ${result.verification.recoveredAfterWriteError}`,
    'NOTION_WRITE_PERFORMED=true',
    '',
  ].join('\n');
}

export function formatApplyPreview(
  result,
  { confirmIntent = false } = {}
) {
  return [
    confirmIntent
      ? 'LOCATION VERIFICATION — APPLY CONFIRM PREVIEW'
      : 'LOCATION VERIFICATION — APPLY DRY-RUN',
    '',
    'Notion page',
    `  Name: ${result.page.name}`,
    `  Slug: ${result.page.slug}`,
    `  Page: ${result.page.url}`,
    `  Data source: ${result.page.dataSourceId}`,
    `  Status: ${result.page.status}`,
    `  Review Needed: ${result.page.reviewNeeded}`,
    `  Review Decision: ${result.page.reviewDecision}`,
    `  Coordinate Type: ${result.page.coordinateType}`,
    '',
    'Apply',
    `  actionRunId: ${result.apply.actionRunId}`,
    `  reviewRunId: ${result.apply.reviewRunId}`,
    `  Candidate result: ${result.apply.candidateResult}`,
    `  Timestamp: ${result.apply.now}`,
    '',
    'Pending Notion patch',
    JSON.stringify(result.pendingPatch, null, 2),
    '',
    'Completed Notion patch',
    JSON.stringify(result.completedPatch, null, 2),
    '',
    'Expected formal-field changes',
    JSON.stringify(result.expectedFormalChanges, null, 2),
    '',
    confirmIntent
      ? 'NOTION_WRITE_PERFORMED=pending (--confirm explicitly requested)'
      : 'NOTION_WRITE_PERFORMED=false',
    '',
  ].join('\n');
}

export function formatApplyDryRun(result) {
  return formatApplyPreview(result);
}

export function formatApplyConfirmResult(result) {
  if (result.alreadyCompleted) {
    return [
      '',
      'LOCATION VERIFICATION — APPLY ALREADY COMPLETE',
      `  Page: ${result.page.url}`,
      `  actionRunId: ${result.apply.actionRunId}`,
      `  reviewRunId: ${result.apply.reviewRunId || '(none)'}`,
      `  Status: ${result.page.status}`,
      `  Review Needed: ${result.page.reviewNeeded}`,
      'NOTION_WRITE_PERFORMED=false (idempotent replay)',
      '',
    ].join('\n');
  }
  return [
    '',
    'LOCATION VERIFICATION — APPLY CONFIRM COMPLETE',
    `  Page: ${result.page.url}`,
    `  actionRunId: ${result.apply.actionRunId}`,
    `  reviewRunId: ${result.apply.reviewRunId || '(none)'}`,
    `  Status: ${result.page.status}`,
    `  Review Needed: ${result.page.reviewNeeded}`,
    `  Resumed from pending: ${result.apply.resumedFromPending}`,
    `  Recovered pending write: ${result.verification.recoveredPendingWrite}`,
    `  Recovered completed write: ${result.verification.recoveredCompletedWrite}`,
    '  Completed patch matched: true',
    '  Formal fields matched: true',
    'NOTION_WRITE_PERFORMED=true',
    '',
  ].join('\n');
}

export function formatValidationReport(result) {
  const lines = [
    'LOCATION VERIFICATION — VALIDATE',
    '',
    'Execution',
    '  Mode: read-only',
    `  Data source: ${result.dataSource}`,
    '',
    'Counts',
    `  Locations: ${result.rowCount}`,
    '',
    'Status distribution',
  ];
  for (const [status, count] of Object.entries(result.statusCounts).sort()) {
    lines.push(`  ${status}: ${count}`);
  }
  lines.push('', `Issues: ${result.issues.length}`);
  for (const item of result.issues) {
    const location = [item.slug, item.field].filter(Boolean).join(' / ');
    lines.push(
      `  - [${item.layer}:${item.code}]${location ? ` ${location}:` : ''} ${item.message}`
    );
  }
  lines.push(
    '',
    'NOTION_WRITE_PERFORMED=false',
    `VALIDATION_RESULT=${result.ok ? 'PASS' : 'FAIL'}`,
    ''
  );
  return lines.join('\n');
}

export function formatProductionPreflight(result) {
  const missing = (values) =>
    values.length > 0 ? values.join(', ') : '(none)';
  return [
    'LOCATION VERIFICATION — PRODUCTION PREFLIGHT',
    '',
    'Execution',
    '  Mode: read-only',
    '  Credential: NOTION_API_KEY',
    `  Formal data source: ${result.page.dataSourceId}`,
    `  Page: ${result.page.url}`,
    `  Name: ${result.page.name}`,
    `  Slug: ${result.page.slug}`,
    `  Legacy Status: ${result.page.status}`,
    '',
    'Schema readiness',
    `  Formal fields: ${result.schema.formalFieldCount - result.schema.missingFormalFields.length}/${result.schema.formalFieldCount}`,
    `  Missing formal fields: ${missing(result.schema.missingFormalFields)}`,
    `  Target workflow fields: ${result.schema.presentWorkflowFields.length}/${result.schema.requiredWorkflowFieldCount}`,
    `  Missing target workflow fields: ${missing(result.schema.missingWorkflowFields)}`,
    '',
    'Proposed conservative initialization',
    JSON.stringify(result.proposedPatch, null, 2),
    '',
    `  Formal read boundary: ${result.gates.formalReadBoundary ? 'PASS' : 'FAIL'}`,
    `  Migration preview: ${result.gates.conservativeMigrationPreview ? 'PASS' : 'FAIL'}`,
    `  Canary write readiness: ${result.gates.canaryWriteReady ? 'READY' : 'BLOCKED'}`,
    '  Formal write credential consumed: false',
    '',
    'PRODUCTION_WRITE_ENABLED=false',
    'NOTION_WRITE_PERFORMED=false',
    `PREFLIGHT_RESULT=${result.gates.canaryWriteReady ? 'READY' : 'BLOCKED'}`,
    '',
  ].join('\n');
}

function formatLockOwner(lines, owner) {
  if (!owner) return;
  lines.push(
    `  Hostname: ${owner.hostname || '(unknown)'}`,
    `  PID: ${Number.isInteger(owner.pid) ? owner.pid : '(unknown)'}`,
    `  Created at: ${owner.createdAt || '(unknown)'}`
  );
}

export function formatLockInspection(result) {
  const lines = [
    'LOCATION VERIFICATION — LOCK INSPECT',
    '',
    `  Page ID: ${result.pageId}`,
    `  Lock path: ${result.lockPath}`,
    `  State: ${result.state}`,
    `  Clearable: ${result.clearable}`,
    `  Reason: ${result.reason}`,
  ];
  formatLockOwner(lines, result.owner);
  lines.push(
    '',
    'LOCAL_LOCK_WRITE_PERFORMED=false',
    'NOTION_READ_PERFORMED=false',
    'NOTION_WRITE_PERFORMED=false',
    ''
  );
  return lines.join('\n');
}

export function formatLockClearResult(result) {
  const lines = [
    'LOCATION VERIFICATION — LOCK CLEAR',
    '',
    `  Page ID: ${result.pageId}`,
    `  Lock path: ${result.lockPath}`,
    `  Previous state: ${result.state}`,
    `  Apply lock removed: ${result.cleared}`,
  ];
  formatLockOwner(lines, result.owner);
  lines.push(
    '',
    `LOCAL_APPLY_LOCK_REMOVED=${result.cleared}`,
    'NOTION_READ_PERFORMED=false',
    'NOTION_WRITE_PERFORMED=false',
    ''
  );
  return lines.join('\n');
}

function usage() {
  return [
    'Usage:',
    '  npm run location:verify -- resolve --page <page-id-or-url> --dry-run [--places-api legacy]',
    '  npm run location:verify -- resolve --page <page-id-or-url> --write',
    '  npm run location:verify -- apply --page <page-id-or-url> --dry-run',
    '  npm run location:verify -- apply --page <page-id-or-url> --confirm',
    '  npm run location:verify -- validate --all',
    '  npm run location:verify -- production-preflight --page <formal-page-id-or-url> --dry-run',
    '  npm run location:verify -- lock inspect --page <page-id-or-url>',
    '  npm run location:verify -- lock clear --page <page-id-or-url> --confirm',
    '',
    'Dry-run is the default. Resolve dry-run and --write use legacy Places;',
    'candidate write refuses overwrite. Apply --confirm writes pending, then applies and',
    'verifies the completed decision; interrupted pending actions are resumed.',
    'production-preflight only reads the formal allowlist and has no write mode.',
  ].join('\n');
}

async function main() {
  const options = parseRunnerArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (options.command === 'validate') {
    const result = await validateAllLocations({
      notionApiKey: process.env.NOTION_API_KEY,
    });
    process.stdout.write(formatValidationReport(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (options.command === 'production-preflight') {
    const result = await productionPreflightPage({
      pageReference: options.pageReference,
      notionApiKey: process.env.NOTION_API_KEY,
    });
    process.stdout.write(formatProductionPreflight(result));
    if (!result.gates.canaryWriteReady) process.exitCode = 2;
    return;
  }

  if (options.command === 'lock') {
    const pageId = parsePageReference(options.pageReference);
    if (options.operation === 'inspect') {
      const result = await inspectPageApplyLock({ pageId });
      process.stdout.write(formatLockInspection(result));
      return;
    }
    const result = await clearPageApplyLock({
      pageId,
      confirm: options.confirm,
    });
    process.stdout.write(formatLockClearResult(result));
    return;
  }

  if (options.command === 'apply') {
    const common = {
      pageReference: options.pageReference,
      notionApiKey: process.env.NOTION_API_KEY,
    };
    if (options.mode === 'confirm') {
      const result = await applyPageConfirm({
        ...common,
        onPreview: (preview) => {
          process.stdout.write(
            formatApplyPreview(preview, { confirmIntent: true })
          );
        },
      });
      process.stdout.write(formatApplyConfirmResult(result));
      return;
    }
    const result = await applyPageDryRun(common);
    process.stdout.write(formatApplyDryRun(result));
    return;
  }

  const common = {
    pageReference: options.pageReference,
    notionApiKey: process.env.NOTION_API_KEY,
    googlePlacesKey:
      process.env.GOOGLE_PLACE_KEY || process.env.GOOGLE_PLACES_KEY,
    placesApiMode: options.placesApiMode,
  };
  if (options.mode === 'write') {
    const result = await resolvePageWrite({
      ...common,
      onPreview: (preview) => {
        process.stdout.write(
          formatResolvePreview(preview, { writeIntent: true })
        );
      },
    });
    process.stdout.write(formatWriteResult(result));
    return;
  }

  const result = await resolvePageDryRun(common);
  process.stdout.write(formatDryRun(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`location-verification-runner: ${error.message}`);
    process.exitCode = 1;
  });
}
