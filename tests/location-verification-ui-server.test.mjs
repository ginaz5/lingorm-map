import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultUiOperations,
  createLocationVerificationUiServer,
  currentFormalSchemaSummary,
  notionPageToQueueItem,
  parseUiServerArgs,
} from '../scripts/location-verification-ui-server.mjs';
import { FORMAL_DATA_SOURCE_ID } from '../scripts/location-verification-core.mjs';
import {
  CURRENT_FORMAL_COUNTRY_OPTIONS,
  CURRENT_FORMAL_DESTINATION_OPTIONS,
  CURRENT_FORMAL_LOCATION_PROPERTIES,
  CURRENT_FORMAL_LOCATION_PROPERTY_TYPES,
  CURRENT_FORMAL_STATUS_OPTIONS,
  CURRENT_FORMAL_TYPE_OPTIONS,
} from '../scripts/formal-location-current-schema.mjs';

const PAGE_ID = '3a1c23158ea2810ea1ddffc9c982fd21';
const OTHER_PAGE_ID = '3a1c23158ea2810ea1ddffc9c982fd22';
const SESSION = 'test-local-session';

function richText(value) {
  return {
    type: 'rich_text',
    rich_text: value ? [{ plain_text: value }] : [],
  };
}

function select(value) {
  return {
    type: 'select',
    select: value ? { name: value } : null,
  };
}

function currentFormalPage(type = 'LingOrm') {
  return {
    id: PAGE_ID,
    url: `https://www.notion.so/${PAGE_ID}`,
    last_edited_time: '2026-07-28T08:00:00.000Z',
    parent: { data_source_id: FORMAL_DATA_SOURCE_ID },
    archived: false,
    in_trash: false,
    properties: {
      Name: {
        type: 'title',
        title: [{ plain_text: 'Tribe Sky Beach Club' }],
      },
      'Name ZH': richText('Tribe 天空沙灘俱樂部'),
      'Thai / Alt Name': richText(''),
      Category: select('Bar / Rooftop Club'),
      'Google Maps URL': {
        type: 'url',
        url: 'https://www.google.com/maps/search/?api=1&query=Tribe',
      },
      'Google Place ID': richText('ChIJcurrent'),
      Lat: { type: 'number', number: 13.7 },
      Lng: { type: 'number', number: 100.5 },
      'Notes EN': richText('Rooftop venue'),
      'Notes ZH': richText('天台場地'),
      Slug: richText('tribe-sky-beach-club'),
      'Source Tags': {
        type: 'multi_select',
        multi_select: [{ name: 'Threads' }],
      },
      'Source URLs': richText('https://threads.example/tribe'),
      Status: select('Paused'),
      'Country Code': select('TH'),
      'Destination Key': select('bangkok'),
      Type: select(type),
      'Review Needed': { type: 'checkbox', checkbox: true },
      'Verification Note': richText(''),
      'Last Verified': { type: 'date', date: null },
    },
  };
}

function currentFormalDataSourceProperties() {
  const properties = Object.fromEntries(
    CURRENT_FORMAL_LOCATION_PROPERTIES.map((name) => [
      name,
      { type: CURRENT_FORMAL_LOCATION_PROPERTY_TYPES[name] },
    ])
  );
  properties.Status.select = {
    options: CURRENT_FORMAL_STATUS_OPTIONS.map((option) => ({ ...option })),
  };
  properties.Type.select = {
    options: CURRENT_FORMAL_TYPE_OPTIONS.map((option) => ({ ...option })),
  };
  properties['Country Code'].select = {
    options: CURRENT_FORMAL_COUNTRY_OPTIONS.map((option) => ({ ...option })),
  };
  properties['Destination Key'].select = {
    options: CURRENT_FORMAL_DESTINATION_OPTIONS.map((option) => ({
      ...option,
    })),
  };
  return properties;
}

function queueItem(overrides = {}) {
  return {
    id: PAGE_ID,
    url: `https://www.notion.so/${PAGE_ID}`,
    recordRevision: '2026-07-28T08:00:00.000Z',
    name: 'Tribe Sky Beach Club',
    nameZh: '',
    alternateName: '',
    slug: 'tribe-sky-beach-club',
    category: 'Restaurant',
    countryCode: 'TH',
    destinationKey: 'bangkok',
    type: 'LingOrm',
    typeMissing: false,
    status: 'Paused',
    reviewNeeded: true,
    verificationNote: '',
    currentPlaceId: 'ChIJcurrent',
    currentMapsUrl:
      'https://www.google.com/maps/search/?api=1&query_place_id=ChIJcurrent',
    lat: 13.7,
    lng: 100.5,
    notesEn: '',
    notesZh: '',
    sourceUrls: '',
    sourceTags: ['Threads'],
    lastVerified: null,
    ...overrides,
  };
}

function resolveResult() {
  return {
    mode: 'dry-run',
    writePerformed: false,
    page: {
      id: PAGE_ID,
      url: `https://www.notion.so/${PAGE_ID}`,
      recordRevision: '2026-07-28T08:00:00.000Z',
      name: 'Tribe Sky Beach Club',
      slug: 'tribe-sky-beach-club',
      status: 'Paused',
      reviewNeeded: '__YES__',
      currentPlaceId: 'ChIJcurrent',
      countryCode: 'TH',
      destinationKey: 'bangkok',
      category: 'Restaurant',
      type: 'JKR Picks',
      lat: 13.7,
      lng: 100.5,
    },
    resolver: {
      result: 'place_id_candidate',
      query: 'Tribe Sky Beach Club Bangkok',
      candidateSource: 'existing_place_id',
      apiMode: 'places_legacy',
      reviewRunId: 'review-test',
      reviewExpiresAt: '2026-08-18T10:00:00.000Z',
      candidates: [
        {
          placeId: 'ChIJcurrent',
          name: 'Temporary Google name',
          address: 'Temporary Google address',
          lat: 13.7,
          lng: 100.5,
          businessStatus: 'OPERATIONAL',
          types: ['restaurant', 'food'],
          distanceMeters: 0,
          distanceRisk: 'low',
          mapsUrl:
            'https://www.google.com/maps/search/?api=1&query_place_id=ChIJcurrent',
          locationSuggestions: {
            countryCode: {
              currentValue: 'TH',
              recommendedValue: 'TH',
              comparison: 'same',
              observedValue: 'TH',
              reason: 'Country evidence',
              options: [
                {
                  value: 'TH',
                  label: 'Thailand / 泰國',
                  confidence: 'high',
                  evidence: 'Thailand (country)',
                },
              ],
            },
            destinationKey: {
              currentValue: 'bangkok',
              recommendedValue: 'bangkok',
              comparison: 'same',
              observedValue: null,
              reason: 'Destination evidence',
              options: [
                {
                  value: 'bangkok',
                  label: 'Bangkok / 曼谷',
                  confidence: 'high',
                  evidence: 'Bangkok (administrative_area_level_1)',
                },
              ],
            },
          },
        },
      ],
      duplicatePages: [
        {
          id: OTHER_PAGE_ID,
          name: 'Possible duplicate',
          slug: 'possible-duplicate',
          url: `https://www.notion.so/${OTHER_PAGE_ID}`,
        },
      ],
    },
    proposedPatch: {},
  };
}

function fakeOperations(configuration = {}) {
  const calls = {
    listQueue: 0,
    resolvePreview: 0,
    validateAll: 0,
  };
  const queue = [queueItem()];
  return {
    calls,
    operations: {
      configuration: {
        dataSourceId: 'formal-data-source',
        allowedPageId: null,
        readOnly: true,
        ...configuration,
      },
      schemaSummary() {
        return {
          ok: true,
          propertyCount: 20,
          expectedPropertyCount: 20,
          allowedTypes: [
            { name: 'LingOrm', color: 'blue' },
            { name: 'JKR Picks', color: 'green' },
            { name: 'JKR Fan Projects', color: 'pink' },
            { name: 'Admin Picks', color: 'default' },
          ],
        };
      },
      async listQueue() {
        calls.listQueue += 1;
        return queue;
      },
      async resolvePreview(pageId) {
        calls.resolvePreview += 1;
        assert.equal(pageId, PAGE_ID);
        return resolveResult();
      },
      async validateAll() {
        calls.validateAll += 1;
        return {
          ok: true,
          rowCount: 99,
          statusCounts: {},
          typeCounts: { LingOrm: 1 },
          issues: [],
          warnings: [],
          checks: {
            schema: { ok: true },
            policy: {
              ok: true,
              policyId: 'test-policy',
              minimumRowCount: 98,
              protectedSlugCount: 98,
              issueCount: 0,
            },
            live: { ok: true, issueCount: 0, warningCount: 0 },
            snapshot: {
              ok: true,
              liveRowCount: 99,
              committedRowCount: 99,
              addedSlugCount: 0,
              removedSlugCount: 0,
              changedSlugCount: 0,
              changedFieldCount: 0,
            },
          },
        };
      },
    },
  };
}

function createTestServer(configuration) {
  const fake = fakeOperations(configuration);
  return {
    ...fake,
    app: createLocationVerificationUiServer({
      operations: fake.operations,
      sessionToken: SESSION,
    }),
  };
}

async function invoke(
  handler,
  {
    method = 'GET',
    path = '/',
    body,
    rawBody,
    session = SESSION,
    host = '127.0.0.1:4317',
    origin,
    remoteAddress = '127.0.0.1',
  } = {}
) {
  const payload =
    rawBody !== undefined
      ? Buffer.from(rawBody)
      : body === undefined
        ? null
        : Buffer.from(JSON.stringify(body));
  const request = {
    method,
    url: path,
    headers: {
      host,
      ...(payload ? { 'content-type': 'application/json' } : {}),
      ...(session ? { 'x-location-session': session } : {}),
      ...(origin ? { origin } : {}),
    },
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      if (payload) yield payload;
    },
  };
  let status = 0;
  let headers = {};
  let responseBody = Buffer.alloc(0);
  const response = {
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = nextHeaders;
    },
    end(value) {
      responseBody = value ? Buffer.from(value) : Buffer.alloc(0);
    },
  };
  await handler(request, response);
  return {
    status,
    headers,
    text: responseBody.toString('utf8'),
    json() {
      return JSON.parse(responseBody.toString('utf8'));
    },
  };
}

function post(server, path, body, session = SESSION) {
  return invoke(server.app.handler, {
    method: 'POST',
    path,
    body,
    session,
  });
}

test('queue mapping exposes Type context and treats blank Type as a warning', () => {
  const item = notionPageToQueueItem(currentFormalPage());
  assert.equal(item.type, 'LingOrm');
  assert.equal(item.typeMissing, false);
  assert.equal(item.countryCode, 'TH');
  assert.equal(item.destinationKey, 'bangkok');
  assert.deepEqual(item.sourceTags, ['Threads']);
  assert.equal(item.recordRevision, '2026-07-28T08:00:00.000Z');

  const blank = notionPageToQueueItem(currentFormalPage(''));
  assert.equal(blank.type, '');
  assert.equal(blank.typeMissing, true);
});

test('default queue operation validates data-source options before reading pages', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method || 'GET',
    });
    if (!options.method) {
      return new Response(JSON.stringify({
        properties: currentFormalDataSourceProperties(),
      }));
    }
    return new Response(JSON.stringify({
      results: [currentFormalPage()],
      has_more: false,
      next_cursor: null,
    }));
  };
  const operations = createDefaultUiOperations({
    notionApiKey: 'notion-test-key',
    googlePlacesKey: 'places-test-key',
    fetchImpl,
  });

  const queue = await operations.listQueue();
  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'POST']);
  assert.equal(queue[0].type, 'LingOrm');
  assert.equal(operations.schemaSummary().propertyCount, 20);
});

test('default queue operation fails before querying pages when Type options drift', async () => {
  const calls = [];
  const properties = currentFormalDataSourceProperties();
  properties.Type.select.options = [
    { name: 'LingOrm', color: 'blue' },
    { name: 'Bookmark', color: 'default' },
  ];
  const operations = createDefaultUiOperations({
    notionApiKey: 'notion-test-key',
    googlePlacesKey: 'places-test-key',
    fetchImpl: async (url, options = {}) => {
      calls.push({
        url: String(url),
        method: options.method || 'GET',
      });
      return new Response(JSON.stringify({ properties }));
    },
  });

  await assert.rejects(
    () => operations.listQueue(),
    /Type options/
  );
  assert.deepEqual(calls.map(({ method }) => method), ['GET']);
});

test('schema summary reports the exact Type option contract', () => {
  const summary = currentFormalSchemaSummary(
    currentFormalDataSourceProperties()
  );
  assert.equal(summary.ok, true);
  assert.deepEqual(
    summary.allowedTypes.map(({ name }) => name),
    ['LingOrm', 'JKR Picks', 'JKR Fan Projects', 'Admin Picks']
  );
  assert.equal(summary.countryOptions.ok, true);
  assert.equal(summary.destinationOptions.ok, true);
});

test('UI arguments keep the listener on loopback with no target flag needed', () => {
  assert.deepEqual(parseUiServerArgs([]), {
    host: '127.0.0.1',
    port: 4317,
    pageReference: null,
  });
  assert.deepEqual(parseUiServerArgs(['--port', '4318']), {
    host: '127.0.0.1',
    port: 4318,
    pageReference: null,
  });
});

test('removed write-capable and target arguments are rejected', () => {
  assert.throws(
    () => parseUiServerArgs(['--target', 'formal']),
    /Unknown argument/
  );
  assert.throws(
    () => parseUiServerArgs(['--formal-workflow']),
    /Unknown argument/
  );
  assert.throws(
    () => parseUiServerArgs(['--allow-formal-write', 'candidate']),
    /Unknown argument/
  );
  assert.throws(
    () => parseUiServerArgs(['--approved-by', 'maintainer']),
    /Unknown argument/
  );
});

test('bootstrap explicitly exposes a read-only formal queue', async () => {
  const server = createTestServer();
  const response = await invoke(server.app.handler, {
    path: '/api/bootstrap',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().writePolicy, {
    mode: 'read-only',
    stages: [],
  });
  assert.equal(response.json().apiMode, 'legacy');
  assert.equal(response.json().schema.propertyCount, 20);
  assert.equal(response.json().queue.length, 1);
  assert.equal(response.json().queue[0].reviewNeeded, true);
  for (const field of [
    'coordinateType',
    'candidateSummary',
    'candidateMapsUrl',
    'candidate',
    'placeIdCheckedAt',
  ]) {
    assert.equal(
      Object.hasOwn(response.json().queue[0], field),
      false,
      field
    );
  }
  assert.equal(server.calls.listQueue, 1);
});

test('Candidate dry-run returns decision evidence without a write ticket', async () => {
  const server = createTestServer();
  const response = await post(server, '/api/resolve/preview', {
    pageId: PAGE_ID,
  });
  assert.equal(response.status, 200);
  const result = response.json();
  assert.equal(result.ticket, undefined);
  assert.equal(result.preview.resolver.apiMode, 'places_legacy');
  assert.equal(result.preview.page.id, PAGE_ID);
  assert.equal(result.preview.page.countryCode, 'TH');
  assert.equal(result.preview.page.destinationKey, 'bangkok');
  assert.equal(result.preview.resolver.candidates[0].placeId, 'ChIJcurrent');
  assert.equal(result.preview.resolver.candidates[0].distanceMeters, 0);
  assert.deepEqual(result.preview.resolver.candidates[0].types, [
    'restaurant',
    'food',
  ]);
  assert.equal(
    result.preview.resolver.candidates[0].locationSuggestions.countryCode
      .recommendedValue,
    'TH'
  );
  assert.equal(
    result.preview.resolver.candidates[0].locationSuggestions.destinationKey
      .recommendedValue,
    'bangkok'
  );
  assert.equal(result.preview.resolver.duplicatePages.length, 1);
  assert.equal(result.preview.candidatePatch, undefined);
  assert.equal(server.calls.resolvePreview, 1);
});

test('every former mutation or mutation-preview route is absent', async () => {
  const server = createTestServer();
  const paths = [
    '/api/resolve/confirm',
    '/api/candidate-reset/preview',
    '/api/candidate-reset/confirm',
    '/api/coordinates/preview',
    '/api/coordinates/confirm',
    '/api/review/preview',
    '/api/review/confirm',
    '/api/apply/preview',
    '/api/apply/confirm',
  ];
  for (const path of paths) {
    const response = await post(server, path, { pageId: PAGE_ID });
    assert.equal(response.status, 404, path);
    assert.equal(response.json().error, 'Not found', path);
  }
  assert.equal(server.calls.resolvePreview, 0);
});

test('queue and POST endpoints require the local session token', async () => {
  const server = createTestServer();
  const queueResponse = await invoke(server.app.handler, {
    path: '/api/queue',
    session: null,
  });
  assert.equal(queueResponse.status, 401);
  const previewResponse = await post(
    server,
    '/api/resolve/preview',
    { pageId: PAGE_ID },
    'wrong-session'
  );
  assert.equal(previewResponse.status, 401);
});

test('page allowlist is enforced before a Candidate dry-run', async () => {
  const server = createTestServer({ allowedPageId: PAGE_ID });
  const response = await post(server, '/api/resolve/preview', {
    pageId: OTHER_PAGE_ID,
  });
  assert.equal(response.status, 403);
  assert.match(response.json().error, /not authorized/);
  assert.equal(server.calls.resolvePreview, 0);
});

test('validation remains available and read-only', async () => {
  const server = createTestServer();
  const response = await post(server, '/api/validate', {});
  assert.equal(response.status, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().rowCount, 99);
  assert.equal(response.json().checks.snapshot.ok, true);
  assert.equal(server.calls.validateAll, 1);
});

test('server rejects non-loopback access and cross-origin requests', async () => {
  const server = createTestServer();
  const remote = await invoke(server.app.handler, {
    path: '/api/bootstrap',
    remoteAddress: '192.0.2.1',
  });
  assert.equal(remote.status, 403);
  const crossOrigin = await invoke(server.app.handler, {
    path: '/api/bootstrap',
    origin: 'https://example.com',
  });
  assert.equal(crossOrigin.status, 403);
});

test('responses include no-store and restrictive security headers', async () => {
  const server = createTestServer();
  const response = await invoke(server.app.handler, {
    path: '/api/bootstrap',
  });
  assert.equal(response.headers['cache-control'], 'no-store, max-age=0');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.match(
    response.headers['content-security-policy'],
    /connect-src 'self'/
  );
});
