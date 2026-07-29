#!/usr/bin/env node

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FORMAL_DATA_SOURCE_ID,
  assertAllowedDataSource,
  validateCandidatePayload,
} from './location-verification-core.mjs';
import {
  CURRENT_FORMAL_LOCATION_PROPERTIES,
  CURRENT_FORMAL_TYPE_OPTIONS,
  currentFormalSchemaIssueMessages,
  inspectCurrentFormalDataSourceProperties,
  inspectCurrentFormalLocationProperties,
} from './formal-location-current-schema.mjs';
import {
  fetchNotionDataSource,
  fetchNotionPage,
  notionPageToRow,
  parsePageReference,
  queryAllNotionDataSourcePages,
  resolvePageDryRun,
  validateAllLocations,
} from './location-verification-runner.mjs';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_PORT = 4317;
const MAX_BODY_BYTES = 64 * 1024;
const UI_ROOT = new URL('../tools/location-verification-ui/', import.meta.url);

const SECURITY_HEADERS = Object.freeze({
  'cache-control': 'no-store, max-age=0',
  'content-security-policy':
    "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

function parseCandidate(value) {
  const text = String(value || '').trim();
  if (!text) return { present: false, valid: true };
  if (!text.startsWith('lv2:')) {
    return { present: true, valid: false, error: 'Unsupported envelope' };
  }
  try {
    const payload = validateCandidatePayload(
      JSON.parse(text.slice('lv2:'.length))
    );
    return {
      present: true,
      valid: true,
      result: payload.result,
      reviewRunId: payload.reviewRunId,
      reviewExpiresAt: payload.reviewExpiresAt || null,
      expired: payload.reviewExpiresAt
        ? Date.parse(payload.reviewExpiresAt) <= Date.now()
        : false,
      placeId: payload.placeId || null,
      coordinateReviewRequired:
        payload.coordinateReviewRequired === true,
    };
  } catch {
    return { present: true, valid: false, error: 'Invalid payload' };
  }
}

function schemaMismatchDetails(schema) {
  return currentFormalSchemaIssueMessages(schema).join('; ');
}

function schemaSummary(properties, schema) {
  return {
    ok: schema.ok,
    propertyCount: Object.keys(properties || {}).length,
    expectedPropertyCount: CURRENT_FORMAL_LOCATION_PROPERTIES.length,
    missingProperties: schema.missing,
    unexpectedProperties: schema.unexpected,
    wrongPropertyTypes: schema.wrongTypes,
    statusOptions: schema.statusOptions,
    typeOptions: schema.typeOptions,
    countryOptions: schema.countryOptions,
    destinationOptions: schema.destinationOptions,
    allowedTypes: CURRENT_FORMAL_TYPE_OPTIONS.map((option) => ({
      name: option.name,
      color: option.color,
    })),
  };
}

export function currentFormalSchemaSummary(properties) {
  return schemaSummary(
    properties,
    inspectCurrentFormalDataSourceProperties(properties)
  );
}

function assertCurrentFormalSchema(
  properties,
  { requireCompleteDefinitions = false } = {}
) {
  const schema = requireCompleteDefinitions
    ? inspectCurrentFormalDataSourceProperties(properties)
    : inspectCurrentFormalLocationProperties(properties);
  if (!schema.ok) {
    throw new Error(
      `Formal Locations schema mismatch: ${schemaMismatchDetails(schema)}`
    );
  }
  return schemaSummary(properties, schema);
}

export function notionPageToQueueItem(
  page,
  expectedDataSourceId = FORMAL_DATA_SOURCE_ID
) {
  const dataSourceId = page?.parent?.data_source_id;
  assertAllowedDataSource(dataSourceId, expectedDataSourceId);
  assertCurrentFormalSchema(page?.properties);
  const row = notionPageToRow(page);
  return {
    id: parsePageReference(page.id),
    url: page.url,
    recordRevision: page.last_edited_time || null,
    name: row.Name,
    nameZh: row['Name ZH'],
    alternateName: row['Thai / Alt Name'],
    slug: row.Slug,
    category: row.Category,
    countryCode: row['Country Code'],
    destinationKey: row['Destination Key'],
    type: row.Type,
    typeMissing: !String(row.Type || '').trim(),
    status: row.Status,
    reviewNeeded: row['Review Needed'] === '__YES__',
    verificationNote: row['Verification Note'],
    currentPlaceId: row['Google Place ID'],
    currentMapsUrl: row['Google Maps URL'],
    lat: row.Lat,
    lng: row.Lng,
    notesEn: row['Notes EN'],
    notesZh: row['Notes ZH'],
    sourceUrls: row['Source URLs'],
    sourceTags: row['Source Tags'],
    lastVerified: row['Last Verified'] || null,
  };
}

function sortReviewQueue(items) {
  const statusOrder = new Map([
    ['Paused', 0],
    ['Published', 1],
    ['Inactive', 2],
  ]);
  return items
    .filter((item) => item.reviewNeeded)
    .sort(
      (a, b) =>
        (statusOrder.get(a.status) ?? 99) -
          (statusOrder.get(b.status) ?? 99) ||
        a.name.localeCompare(b.name, 'zh-Hant')
  );
}

function sanitizeSuggestionField(suggestion) {
  return {
    currentValue: suggestion?.currentValue || null,
    recommendedValue: suggestion?.recommendedValue || null,
    comparison: suggestion?.comparison || 'unavailable',
    observedValue: suggestion?.observedValue || null,
    reason: suggestion?.reason || '',
    options: Array.isArray(suggestion?.options)
      ? suggestion.options.map((option) => ({
          value: option.value,
          label: option.label,
          confidence: option.confidence,
          evidence: option.evidence,
        }))
      : [],
  };
}

function sanitizeResolvePreview(result) {
  return {
    page: {
      id: parsePageReference(result.page.id),
      url: result.page.url,
      recordRevision: result.page.recordRevision || null,
      name: result.page.name,
      slug: result.page.slug,
      status: result.page.status,
      reviewNeeded: result.page.reviewNeeded === '__YES__',
      currentPlaceId: result.page.currentPlaceId || null,
      countryCode: result.page.countryCode || '',
      destinationKey: result.page.destinationKey || '',
      category: result.page.category || '',
      type: result.page.type || '',
      lat: result.page.lat,
      lng: result.page.lng,
    },
    resolver: {
      result: result.resolver.result,
      query: result.resolver.query,
      candidateSource: result.resolver.candidateSource,
      apiMode: result.resolver.apiMode,
      reviewRunId: result.resolver.reviewRunId,
      reviewExpiresAt: result.resolver.reviewExpiresAt,
      coordinateReviewRequired:
        result.proposedPatch['Candidate Payload']
          ? parseCandidate(result.proposedPatch['Candidate Payload'])
              .coordinateReviewRequired === true
          : false,
      candidates: result.resolver.candidates.map((candidate) => ({
        placeId: candidate.placeId,
        name: candidate.name,
        address: candidate.address,
        lat: candidate.lat,
        lng: candidate.lng,
        businessStatus: candidate.businessStatus,
        types: Array.isArray(candidate.types) ? candidate.types : [],
        distanceMeters: candidate.distanceMeters,
        distanceRisk: candidate.distanceRisk,
        mapsUrl: candidate.mapsUrl,
        locationSuggestions: {
          countryCode: sanitizeSuggestionField(
            candidate.locationSuggestions?.countryCode
          ),
          destinationKey: sanitizeSuggestionField(
            candidate.locationSuggestions?.destinationKey
          ),
        },
      })),
      duplicatePages: result.resolver.duplicatePages.map((page) => ({
        id: page.id,
        name: page.name,
        slug: page.slug,
        url: page.url,
      })),
    },
  };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function isLoopbackRequest(request) {
  const remoteAddress = request.socket.remoteAddress || '';
  if (
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress)
  ) {
    return false;
  }
  const host = String(request.headers.host || '').toLowerCase();
  return (
    /^127\.0\.0\.1(?::\d+)?$/.test(host) ||
    /^localhost(?::\d+)?$/.test(host)
  );
}

function hasAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.origin === `http://${request.headers.host}`;
  } catch {
    return false;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  const contentType = String(request.headers['content-type'] || '');
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new Error('Content-Type must be application/json');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body is too large');
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Request body is not valid JSON');
  }
}

function requirePageId(body) {
  return parsePageReference(body.pageId);
}

function requireSession(request, sessionToken) {
  if (!safeEqual(request.headers['x-location-session'], sessionToken)) {
    const error = new Error('Invalid local session');
    error.status = 401;
    throw error;
  }
}

async function serveAsset(response, pathname, assetRoot) {
  const assetNames = new Map([
    ['/', 'index.html'],
    ['/app.js', 'app.js'],
    ['/workflow.js', 'workflow.js'],
    ['/styles.css', 'styles.css'],
  ]);
  const assetName = assetNames.get(pathname);
  if (!assetName) return false;
  const url = new URL(assetName, assetRoot);
  const body = await readFile(url);
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  }[extname(assetName)];
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': contentType,
  });
  response.end(body);
  return true;
}

function validationSummary(result) {
  return {
    ok: result.ok,
    rowCount: result.rowCount,
    statusCounts: result.statusCounts,
    issues: result.issues,
    warnings: result.warnings || [],
    typeCounts: result.typeCounts || {},
    checks: result.checks || null,
    schema: result.schema || null,
  };
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

export function createDefaultUiOperations({
  notionApiKey = process.env.NOTION_API_KEY,
  googlePlacesKey =
    process.env.GOOGLE_PLACE_KEY || process.env.GOOGLE_PLACES_KEY,
  pageReference,
  fetchImpl = fetch,
} = {}) {
  if (!notionApiKey) throw new Error('Missing NOTION_API_KEY');
  if (!googlePlacesKey) throw new Error('Missing GOOGLE_PLACE_KEY');

  const expectedDataSourceId = FORMAL_DATA_SOURCE_ID;
  let latestSchemaSummary = null;
  const allowedPageId = pageReference
    ? parsePageReference(pageReference)
    : null;
  const assertAllowedPage = (value) => {
    const pageId = parsePageReference(value);
    if (allowedPageId && pageId !== allowedPageId) {
      throw forbidden(
        `This read-only UI session is scoped to page ${allowedPageId}`
      );
    }
    return pageId;
  };
  const getPage = async (reference) => {
    const pageId = assertAllowedPage(reference);
    const page = await fetchNotionPage({
      pageId,
      notionApiKey,
      fetchImpl,
    });
    return notionPageToQueueItem(page, expectedDataSourceId);
  };
  const preflightSchema = async () => {
    const dataSource = await fetchNotionDataSource({
      dataSourceId: expectedDataSourceId,
      notionApiKey,
      fetchImpl,
    });
    latestSchemaSummary = assertCurrentFormalSchema(
      dataSource.properties,
      { requireCompleteDefinitions: true }
    );
    return latestSchemaSummary;
  };

  return {
    configuration: Object.freeze({
      dataSourceId: expectedDataSourceId,
      allowedPageId,
      readOnly: true,
    }),
    schemaSummary: () => latestSchemaSummary,
    async listQueue() {
      await preflightSchema();
      if (allowedPageId) {
        return sortReviewQueue([await getPage(allowedPageId)]);
      }
      const pages = await queryAllNotionDataSourcePages({
        dataSourceId: expectedDataSourceId,
        notionApiKey,
        fetchImpl,
      });
      return sortReviewQueue(
        pages
          .filter((page) => !page.in_trash && !page.archived)
          .map((page) =>
            notionPageToQueueItem(page, expectedDataSourceId)
          )
      );
    },
    getPage,
    async resolvePreview(reference) {
      await preflightSchema();
      const pageId = assertAllowedPage(reference);
      const page = await getPage(pageId);
      if (!page.reviewNeeded) {
        throw forbidden(
          'This location is no longer in the Review Needed queue'
        );
      }
      return resolvePageDryRun({
        pageReference: pageId,
        googlePlacesKey,
        placesApiMode: 'legacy',
        notionApiKey,
        expectedDataSourceId,
        fetchImpl,
      });
    },
    validateAll: () =>
      validateAllLocations({
        notionApiKey,
        fetchImpl,
      }),
  };
}

export function createLocationVerificationUiServer({
  operations = createDefaultUiOperations(),
  sessionToken = randomBytes(32).toString('base64url'),
  assetRoot = UI_ROOT,
} = {}) {
  const configuration = {
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    allowedPageId: null,
    readOnly: true,
    ...(operations.configuration || {}),
  };
  const assertPageInScope = (pageId) => {
    if (
      configuration.allowedPageId &&
      pageId !== configuration.allowedPageId
    ) {
      throw forbidden('This UI session is not authorized for that page');
    }
  };
  const handler = async (request, response) => {
    try {
      if (!isLoopbackRequest(request) || !hasAllowedOrigin(request)) {
        sendJson(response, 403, { error: 'Loopback access only' });
        return;
      }
      const url = new URL(
        request.url || '/',
        `http://${request.headers.host}`
      );

      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
        if (await serveAsset(response, url.pathname, assetRoot)) return;
        sendJson(response, 404, { error: 'Not found' });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
        const queue = await operations.listQueue();
        sendJson(response, 200, {
          sessionToken,
          apiMode: 'legacy',
          dataSourceId: configuration.dataSourceId,
          allowedPageId: configuration.allowedPageId,
          writePolicy: {
            mode: 'read-only',
            stages: [],
          },
          schema: operations.schemaSummary?.() || null,
          queue,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/queue') {
        requireSession(request, sessionToken);
        const queue = await operations.listQueue();
        sendJson(response, 200, {
          schema: operations.schemaSummary?.() || null,
          queue,
        });
        return;
      }

      if (request.method !== 'POST') {
        sendJson(response, 404, { error: 'Not found' });
        return;
      }
      requireSession(request, sessionToken);
      const body = await readJsonBody(request);

      if (url.pathname === '/api/resolve/preview') {
        const pageId = requirePageId(body);
        assertPageInScope(pageId);
        const result = await operations.resolvePreview(pageId);
        sendJson(response, 200, {
          preview: sanitizeResolvePreview(result),
        });
        return;
      }

      if (url.pathname === '/api/validate') {
        sendJson(
          response,
          200,
          validationSummary(await operations.validateAll())
        );
        return;
      }

      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(response, error?.status || 400, {
        error: error instanceof Error ? error.message : 'Request failed',
      });
    }
  };

  return {
    handler,
    sessionToken,
    server: createServer(handler),
  };
}

export function parseUiServerArgs(args) {
  let port = DEFAULT_PORT;
  let pageReference = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--port') {
      port = Number(args[index + 1]);
      index += 1;
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length));
    } else if (arg === '--page') {
      pageReference = args[index + 1];
      index += 1;
    } else if (arg.startsWith('--page=')) {
      pageReference = arg.slice('--page='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be an integer from 1 to 65535');
  }
  return {
    host: LOOPBACK_HOST,
    port,
    pageReference,
  };
}

export async function startLocationVerificationUiServer(options = {}) {
  const { host = LOOPBACK_HOST, port = DEFAULT_PORT } = options;
  if (host !== LOOPBACK_HOST) {
    throw new Error('Location verification UI may bind only to 127.0.0.1');
  }
  const operations =
    options.operations || createDefaultUiOperations(options);
  const app = createLocationVerificationUiServer({
    ...options,
    operations,
  });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, host, resolve);
  });
  return {
    ...app,
    host,
    port: app.server.address().port,
    url: `http://${host}:${app.server.address().port}/`,
  };
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  try {
    const options = parseUiServerArgs(process.argv.slice(2));
    const app = await startLocationVerificationUiServer(options);
    process.stdout.write(
      `Location verification UI: ${app.url}\n` +
        'Formal Locations Review Needed queue; read-only Candidate dry-runs.\n' +
        'No Notion writes are exposed. Localhost only. Press Ctrl+C to stop.\n'
    );
  } catch (error) {
    process.stderr.write(
      `Location verification UI failed: ${error.message}\n`
    );
    process.exitCode = 1;
  }
}
