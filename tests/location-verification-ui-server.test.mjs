import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLocationVerificationUiServer,
  parseUiServerArgs,
} from '../scripts/location-verification-ui-server.mjs';

const PAGE_ID = '3a1c23158ea2810ea1ddffc9c982fd21';
const OTHER_PAGE_ID = '3a1c23158ea2810ea1ddffc9c982fd22';
const SESSION = 'test-local-session';

function queueItem(overrides = {}) {
  return {
    id: PAGE_ID,
    url: `https://www.notion.so/${PAGE_ID}`,
    name: 'Tribe Sky Beach Club',
    nameZh: '',
    alternateName: '',
    slug: 'tribe-sky-beach-club',
    category: 'Restaurant',
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
      name: 'Tribe Sky Beach Club',
      slug: 'tribe-sky-beach-club',
      status: 'Paused',
      reviewNeeded: '__YES__',
      currentPlaceId: 'ChIJcurrent',
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
          distanceMeters: 0,
          distanceRisk: 'low',
          mapsUrl:
            'https://www.google.com/maps/search/?api=1&query_place_id=ChIJcurrent',
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
        target: 'formal',
        dataSourceId: 'formal-data-source',
        allowedPageId: null,
        readOnly: true,
        ...configuration,
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
          counts: { formal: 99 },
          layers: {
            baseline: true,
            approvals: true,
            target: true,
            slug: true,
            poc: true,
            formal: true,
          },
          reconciliation: {},
          statusCounts: {},
          issues: [],
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

test('UI arguments keep the listener on loopback and formal mode needs no write flags', () => {
  assert.deepEqual(parseUiServerArgs([]), {
    host: '127.0.0.1',
    port: 4317,
    target: 'poc',
    pageReference: null,
  });
  assert.deepEqual(
    parseUiServerArgs(['--target', 'formal', '--port', '4318']),
    {
      host: '127.0.0.1',
      port: 4318,
      target: 'formal',
      pageReference: null,
    }
  );
});

test('removed write-capable arguments are rejected', () => {
  assert.throws(
    () => parseUiServerArgs(['--target', 'formal', '--formal-workflow']),
    /Unknown argument/
  );
  assert.throws(
    () =>
      parseUiServerArgs([
        '--target',
        'formal',
        '--allow-formal-write',
        'candidate',
      ]),
    /Unknown argument/
  );
  assert.throws(
    () =>
      parseUiServerArgs([
        '--target',
        'formal',
        '--approved-by',
        'maintainer',
      ]),
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
  assert.equal(result.preview.resolver.candidates[0].placeId, 'ChIJcurrent');
  assert.equal(result.preview.resolver.candidates[0].distanceMeters, 0);
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

test('full reconciliation remains available and read-only', async () => {
  const server = createTestServer();
  const response = await post(server, '/api/validate', {});
  assert.equal(response.status, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().layers.formal, true);
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
