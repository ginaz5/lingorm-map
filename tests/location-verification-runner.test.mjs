import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acquirePageApplyLock,
  applyPageConfirm,
  applyPageDryRun,
  applyPatchToNotionProperties,
  buildCandidateLocationSuggestions,
  candidateResetPageConfirm,
  candidateResetPageDryRun,
  candidateResetPatchToNotionProperties,
  candidatePatchToNotionProperties,
  clearPageApplyLock,
  coordinateCorrectionPageConfirm,
  coordinateCorrectionPageDryRun,
  coordinateCorrectionPatchToNotionProperties,
  formatValidationReport,
  inspectPageApplyLock,
  notionPageToRow,
  parsePageReference,
  parseRunnerArgs,
  productionPreflightPage,
  queryAllNotionDataSourcePages,
  resolvePageDryRun,
  resolvePageWrite,
  reviewPageConfirm,
  reviewPageDryRun,
  reviewPatchToNotionProperties,
  validateAllLocations,
} from '../scripts/location-verification-runner.mjs';
import {
  buildPendingApplyPatch,
  buildPlaceIdCandidatePatch,
} from '../scripts/location-verification-core.mjs';
import {
  CURRENT_FORMAL_COUNTRY_OPTIONS,
  CURRENT_FORMAL_DESTINATION_OPTIONS,
  CURRENT_FORMAL_LOCATION_PROPERTIES,
  CURRENT_FORMAL_LOCATION_PROPERTY_TYPES,
  CURRENT_FORMAL_STATUS_OPTIONS,
  CURRENT_FORMAL_TYPE_OPTIONS,
} from '../scripts/formal-location-current-schema.mjs';
import { buildSnapshotCsv } from '../scripts/export-snapshot.mjs';

// Arbitrary data source ID used only in fail-closed tests to represent a
// page that lives outside the single allowlisted Locations database.
const OTHER_DATA_SOURCE_ID = 'eefc0f40-698c-4870-97b7-e8860091f668';
const FORMAL_DATA_SOURCE_ID = 'e55c2315-8ea2-837d-9637-07c1118486c8';
const PAGE_ID = '3a1c2315-8ea2-810c-9814-d95050c65916';

function deadProcess() {
  const error = new Error('No such process');
  error.code = 'ESRCH';
  throw error;
}

async function writeApplyLock(
  lockRoot,
  {
    token = 'stale-token',
    pid = 999999,
    hostnameValue = hostname(),
    pageId = parsePageReference(PAGE_ID),
  } = {}
) {
  await mkdir(lockRoot, { recursive: true });
  const lockPath = join(lockRoot, `${pageId}.lock`);
  await writeFile(
    lockPath,
    JSON.stringify({
      schemaVersion: 2,
      token,
      pid,
      pageId,
      hostname: hostnameValue,
      createdAt: '2026-07-19T10:30:00.000Z',
    })
  );
  return lockPath;
}

function title(value) {
  return {
    type: 'title',
    title: [{ plain_text: value }],
  };
}

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

function page(overrides = {}) {
  return {
    id: PAGE_ID,
    url: `https://www.notion.so/${PAGE_ID.replaceAll('-', '')}`,
    parent: {
      type: 'data_source_id',
      data_source_id: FORMAL_DATA_SOURCE_ID,
    },
    archived: false,
    in_trash: false,
    last_edited_time: '2026-07-28T08:00:00.000Z',
    properties: {
      Name: title('漢王廟 (Han Wang Miao)'),
      Slug: richText('han-wang-miao'),
      'Name ZH': richText('漢王廟'),
      'Thai / Alt Name': richText(''),
      Category: select('Neighbourhood'),
      'Country Code': select('TH'),
      'Destination Key': select('bangkok'),
      Type: select('LingOrm'),
      'Google Maps URL': {
        type: 'url',
        url: 'https://www.google.com/maps/search/?api=1&query=Han+Wang+Miao',
      },
      'Google Place ID': richText('ChIJcurrent'),
      'Coordinates Approx': { type: 'checkbox', checkbox: false },
      Lat: { type: 'number', number: 13.73288 },
      Lng: { type: 'number', number: 100.51218 },
      'Notes EN': richText(''),
      'Notes ZH': richText(''),
      'Source URLs': richText(''),
      'Source Tags': {
        type: 'multi_select',
        multi_select: [{ name: 'Threads' }],
      },
      'Branch Group': richText(''),
      Origin: select('manual'),
      Status: select('Paused'),
      'Review Needed': { type: 'checkbox', checkbox: true },
      'Review Decision': select(''),
      'Coordinate Type': select(''),
      'Verification Note': richText(''),
      'Rejected Place IDs': richText(''),
      'Candidate Summary': richText(''),
      'Candidate Maps URL': { type: 'url', url: null },
      'Candidate Payload': richText(''),
      'Apply Metadata': richText(''),
      'Last Verified': { type: 'date', date: null },
      'Place ID Checked At': { type: 'date', date: null },
    },
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function applyNotionProperties(sourcePage, properties) {
  const updated = structuredClone(sourcePage);
  for (const [name, value] of Object.entries(properties)) {
    const current = updated.properties[name] || {};
    if (Object.hasOwn(value, 'checkbox')) {
      updated.properties[name] = {
        ...current,
        type: 'checkbox',
        checkbox: value.checkbox,
      };
    } else if (Object.hasOwn(value, 'rich_text')) {
      updated.properties[name] = {
        ...current,
        type: 'rich_text',
        rich_text: value.rich_text.map((part) => ({
          ...part,
          plain_text: part.text.content,
        })),
      };
    } else if (Object.hasOwn(value, 'url')) {
      updated.properties[name] = {
        ...current,
        type: 'url',
        url: value.url,
      };
    } else if (Object.hasOwn(value, 'select')) {
      updated.properties[name] = {
        ...current,
        type: 'select',
        select: value.select,
      };
    } else if (Object.hasOwn(value, 'date')) {
      const normalizedDate = value.date?.start
        ? new Date(value.date.start)
        : null;
      normalizedDate?.setUTCSeconds(0, 0);
      updated.properties[name] = {
        ...current,
        type: 'date',
        date: normalizedDate
          ? { ...value.date, start: normalizedDate.toISOString() }
          : value.date,
      };
    } else if (Object.hasOwn(value, 'number')) {
      updated.properties[name] = {
        ...current,
        type: 'number',
        number: value.number,
      };
    }
  }
  return updated;
}

function reviewReadyPage({
  reviewExpiresAt = '2026-08-18T01:00:00.000Z',
  decision = 'Keep Current',
  candidatePlaceId = 'ChIJcurrent',
} = {}) {
  const ready = page();
  const candidatePatch = buildPlaceIdCandidatePatch({
    row: notionPageToRow(ready),
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    placeId: candidatePlaceId,
    candidateSource: 'existing_place_id',
    verificationMethod: 'places_refresh',
    query: '漢王廟 (Han Wang Miao) Bangkok',
    reviewRunId: 'review-ready',
    resolvedAt: '2026-07-19T01:00:00.000Z',
    reviewExpiresAt,
  });
  const withCandidate = applyNotionProperties(
    ready,
    candidatePatchToNotionProperties(candidatePatch)
  );
  withCandidate.properties['Review Decision'] = select(decision);
  withCandidate.properties['Coordinate Type'] = select('Exact');
  withCandidate.properties['Verification Note'] = richText(
    '人工確認 Google Maps 候選與漢王廟為同一地點；候選 Place ID 與目前一致，保留目前正式資料。'
  );
  return withCandidate;
}

function applyFetchHarness(initialPage, { duplicatePages = [] } = {}) {
  let remotePage = structuredClone(initialPage);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    const method = options.method || 'GET';
    calls.push({ url: value, method, body: options.body || null });
    if (value.includes('/v1/pages/') && method === 'GET') {
      return jsonResponse(remotePage);
    }
    if (value.includes('/data_sources/') && method === 'POST') {
      return jsonResponse({ results: [remotePage, ...duplicatePages] });
    }
    if (value.includes('/v1/pages/') && method === 'PATCH') {
      const body = JSON.parse(options.body);
      remotePage = applyNotionProperties(remotePage, body.properties);
      return jsonResponse(remotePage);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return {
    fetchImpl,
    calls,
    getPage: () => remotePage,
  };
}

test('page references accept raw IDs and Notion URLs', () => {
  assert.equal(parsePageReference(PAGE_ID), PAGE_ID.replaceAll('-', ''));
  assert.equal(
    parsePageReference(
      'https://app.notion.com/p/3a1c23158ea2810c9814d95050c65916?pvs=1'
    ),
    PAGE_ID.replaceAll('-', '')
  );
});

test('Notion page properties are converted to canonical runner row values', () => {
  const row = notionPageToRow(page());
  assert.equal(row.Name, '漢王廟 (Han Wang Miao)');
  assert.equal(row.Slug, 'han-wang-miao');
  assert.equal(row.Status, 'Paused');
  assert.equal(row['Country Code'], 'TH');
  assert.equal(row['Destination Key'], 'bangkok');
  assert.equal(row.Type, 'LingOrm');
  assert.equal(row['Review Needed'], '__YES__');
  assert.deepEqual(row['Source Tags'], ['Threads']);
});

test('Candidate address evidence suggests supported Country Code and Destination Key options', () => {
  const suggestions = buildCandidateLocationSuggestions({
    currentCountryCode: 'TH',
    currentDestinationKey: '',
    candidate: {
      formattedAddress: 'Silom, Bang Rak, Bangkok 10500, Thailand',
      addressComponents: [
        {
          longText: 'Bangkok',
          shortText: 'Bangkok',
          types: ['administrative_area_level_1'],
        },
        {
          longText: 'Thailand',
          shortText: 'TH',
          types: ['country'],
        },
      ],
    },
  });

  assert.equal(suggestions.countryCode.recommendedValue, 'TH');
  assert.equal(suggestions.countryCode.comparison, 'same');
  assert.deepEqual(
    suggestions.countryCode.options.map((option) => option.value),
    ['TH']
  );
  assert.equal(suggestions.destinationKey.recommendedValue, 'bangkok');
  assert.equal(suggestions.destinationKey.comparison, 'missing');
  assert.equal(
    suggestions.destinationKey.options[0].confidence,
    'high'
  );
});

test('Candidate address evidence maps TW, HK, and MO destinations', () => {
  const cases = [
    {
      countryCode: 'TW',
      destinationKey: 'kaohsiung',
      formattedAddress: 'No. 1, Kaohsiung City, Taiwan',
      area: {
        longText: '高雄市',
        shortText: '高雄市',
        types: ['administrative_area_level_1'],
      },
      country: {
        longText: 'Taiwan',
        shortText: 'TW',
        types: ['country'],
      },
    },
    {
      countryCode: 'HK',
      destinationKey: 'hong-kong',
      formattedAddress: 'Tsim Sha Tsui, Hong Kong',
      area: {
        longText: 'Hong Kong',
        shortText: 'HK',
        types: ['administrative_area_level_1'],
      },
      country: {
        longText: 'Hong Kong',
        shortText: 'HK',
        types: ['country'],
      },
    },
    {
      countryCode: 'MO',
      destinationKey: 'macau',
      formattedAddress: 'Avenida de Almeida Ribeiro, Macao',
      area: {
        longText: 'Macao',
        shortText: 'Macao',
        types: ['administrative_area_level_1'],
      },
      country: {
        longText: 'Macao',
        shortText: 'MO',
        types: ['country'],
      },
    },
  ];

  for (const item of cases) {
    const suggestions = buildCandidateLocationSuggestions({
      candidate: {
        formattedAddress: item.formattedAddress,
        addressComponents: [item.area, item.country],
      },
    });
    assert.equal(
      suggestions.countryCode.recommendedValue,
      item.countryCode
    );
    assert.equal(
      suggestions.destinationKey.recommendedValue,
      item.destinationKey
    );
  }
});

test('Candidate taxonomy suggestions fail closed for unsupported or unmapped addresses', () => {
  const suggestions = buildCandidateLocationSuggestions({
    currentCountryCode: 'TH',
    currentDestinationKey: 'khao-yai',
    candidate: {
      formattedAddress: 'Pak Chong, Nakhon Ratchasima, Thailand',
      addressComponents: [
        {
          longText: 'Nakhon Ratchasima',
          shortText: 'Nakhon Ratchasima',
          types: ['administrative_area_level_1'],
        },
        {
          longText: 'Thailand',
          shortText: 'TH',
          types: ['country'],
        },
      ],
    },
  });

  assert.equal(suggestions.countryCode.recommendedValue, 'TH');
  assert.equal(suggestions.destinationKey.recommendedValue, null);
  assert.deepEqual(suggestions.destinationKey.options, []);
  assert.equal(suggestions.destinationKey.comparison, 'unavailable');

  const unsupportedCountry = buildCandidateLocationSuggestions({
    currentCountryCode: '',
    currentDestinationKey: '',
    candidate: {
      formattedAddress: 'Pattaya Street, Singapore',
      addressComponents: [
        {
          longText: 'Pattaya',
          shortText: 'Pattaya',
          types: ['route'],
        },
        {
          longText: 'Singapore',
          shortText: 'SG',
          types: ['country'],
        },
      ],
    },
  });
  assert.equal(unsupportedCountry.countryCode.observedValue, 'SG');
  assert.equal(unsupportedCountry.countryCode.recommendedValue, null);
  assert.deepEqual(unsupportedCountry.destinationKey.options, []);
});

test('resolve dry-run defaults to legacy Place ID refresh and never writes Notion', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/v1/pages/')) return jsonResponse(page());
    if (String(url).includes('/place/details/json')) {
      return jsonResponse({
        status: 'OK',
        result: {
          place_id: 'ChIJcurrent',
          name: 'Han Wang Shrine',
          formatted_address: 'Bangkok',
          address_components: [
            {
              long_name: 'Bangkok',
              short_name: 'Bangkok',
              types: ['administrative_area_level_1'],
            },
            {
              long_name: 'Thailand',
              short_name: 'TH',
              types: ['country'],
            },
          ],
          geometry: {
            location: { lat: 13.7329, lng: 100.5122 },
          },
          business_status: 'OPERATIONAL',
          types: ['place_of_worship'],
        },
      });
    }
    if (String(url).includes('/data_sources/')) {
      return jsonResponse({ results: [page()] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await resolvePageDryRun({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    googlePlacesKey: 'google-test-key',
    fetchImpl,
    now: new Date('2026-07-19T08:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000001',
  });

  assert.equal(result.mode, 'dry-run');
  assert.equal(result.writePerformed, false);
  assert.equal(result.resolver.result, 'place_id_candidate');
  assert.equal(result.resolver.candidateSource, 'existing_place_id');
  assert.equal(result.resolver.apiMode, 'places_legacy');
  assert.equal(result.page.countryCode, 'TH');
  assert.equal(result.page.destinationKey, 'bangkok');
  assert.equal(
    result.resolver.candidates[0].locationSuggestions.countryCode
      .recommendedValue,
    'TH'
  );
  assert.equal(
    result.resolver.candidates[0].locationSuggestions.destinationKey
      .recommendedValue,
    'bangkok'
  );
  assert.match(
    new URL(
      calls.find(({ url }) => url.includes('/place/details/json')).url
    ).searchParams.get('fields'),
    /address_components/
  );
  assert.equal(result.proposedPatch['Candidate Summary'], '[Candidate Ready]');
  assert.match(result.proposedPatch['Candidate Maps URL'], /query_place_id=ChIJcurrent/);

  const payload = JSON.parse(
    result.proposedPatch['Candidate Payload'].slice('lv2:'.length)
  );
  assert.equal(payload.placeId, 'ChIJcurrent');
  assert.equal(payload.coordinateReviewRequired, false);
  assert.equal(
    payload.reviewRunId,
    'review-00000000-0000-4000-8000-000000000001'
  );
  assert.equal(
    calls.some(({ options }) => (options.method || 'GET') === 'PATCH'),
    false
  );
});

test('resolve marks a single candidate over 500 metres away as requiring coordinate correction', async () => {
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/v1/pages/')) return jsonResponse(page());
    if (value.includes('/place/details/json')) {
      return jsonResponse({
        status: 'OK',
        result: {
          place_id: 'ChIJcurrent',
          name: 'Han Wang Shrine',
          formatted_address: 'Bangkok',
          geometry: {
            location: { lat: 13.71, lng: 100.54 },
          },
          business_status: 'OPERATIONAL',
        },
      });
    }
    if (value.includes('/data_sources/')) {
      return jsonResponse({ results: [page()] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await resolvePageDryRun({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    googlePlacesKey: 'google-test-key',
    fetchImpl,
    now: new Date('2026-07-19T08:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000091',
  });
  const payload = JSON.parse(
    result.proposedPatch['Candidate Payload'].slice('lv2:'.length)
  );

  assert.equal(result.resolver.candidates[0].distanceRisk, 'high');
  assert.equal(payload.coordinateReviewRequired, true);
  assert.equal(
    result.proposedPatch['Candidate Summary'],
    '[Candidate Ready] [Coordinate Correction Required]'
  );
});

test('resolve dry-run falls back to legacy Places when Places New is forbidden', async () => {
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/v1/pages/')) return jsonResponse(page());
    if (value.includes('places.googleapis.com/v1/places/ChIJcurrent')) {
      return jsonResponse(
        { error: { status: 'PERMISSION_DENIED' } },
        403
      );
    }
    if (value.includes('/place/details/json')) {
      return jsonResponse({
        status: 'OK',
        result: {
          place_id: 'ChIJcurrent',
          name: 'Han Wang Shrine',
          formatted_address: 'Bangkok',
          geometry: {
            location: { lat: 13.7329, lng: 100.5122 },
          },
          business_status: 'OPERATIONAL',
          types: ['place_of_worship'],
        },
      });
    }
    if (value.includes('/data_sources/')) {
      return jsonResponse({ results: [page()] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await resolvePageDryRun({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    googlePlacesKey: 'google-test-key',
    fetchImpl,
    now: new Date('2026-07-19T08:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000003',
    placesApiMode: 'auto',
  });

  assert.equal(result.resolver.result, 'place_id_candidate');
  assert.equal(result.resolver.apiMode, 'places_legacy');
  assert.equal(result.resolver.candidates[0].placeId, 'ChIJcurrent');
});

test('duplicate Place IDs are blocked before a candidate patch can be written', async () => {
  const duplicate = page({
    id: '4b2d3426-9fb3-921d-a925-ea6151d76027',
    properties: {
      ...page().properties,
      Name: title('Different location'),
      Slug: richText('different-location'),
    },
  });
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/v1/pages/')) return jsonResponse(page());
    if (value.includes('/v1/places/ChIJcurrent')) {
      return jsonResponse({
        id: 'ChIJcurrent',
        displayName: { text: 'Example Candidate' },
        location: { latitude: 13.7, longitude: 100.5 },
      });
    }
    if (value.includes('/data_sources/')) {
      return jsonResponse({ results: [page(), duplicate] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await resolvePageDryRun({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    googlePlacesKey: 'google-test-key',
    fetchImpl,
    now: new Date('2026-07-19T08:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000004',
    placesApiMode: 'auto',
  });

  const payload = JSON.parse(
    result.proposedPatch['Candidate Payload'].slice('lv2:'.length)
  );
  assert.equal(result.resolver.result, 'error');
  assert.equal(payload.errorCode, 'duplicate_place_id');
  assert.equal(Object.hasOwn(payload, 'placeId'), false);
  assert.equal(result.resolver.duplicatePages[0].slug, 'different-location');
});

test('resolve dry-run fails closed for a page outside the allowlisted Locations database', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return jsonResponse(
      page({
        parent: {
          type: 'data_source_id',
          data_source_id: OTHER_DATA_SOURCE_ID,
        },
      })
    );
  };

  await assert.rejects(
    resolvePageDryRun({
      pageReference: PAGE_ID,
      notionApiKey: 'notion-test-key',
      googlePlacesKey: 'google-test-key',
      fetchImpl,
    }),
    /not allowlisted/
  );
  assert.equal(calls.length, 1);
});

test('resolve dry-run can inspect an explicitly allowlisted formal page without writing', async () => {
  const formalPage = page({
    parent: {
      type: 'data_source_id',
      data_source_id: FORMAL_DATA_SOURCE_ID,
    },
  });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    const method = options.method || 'GET';
    calls.push({ url: value, method });
    if (value.includes('/v1/pages/') && method === 'GET') {
      return jsonResponse(formalPage);
    }
    if (value.includes('/place/details/json')) {
      return jsonResponse({
        status: 'OK',
        result: {
          place_id: 'ChIJcurrent',
          name: 'Han Wang Shrine',
          formatted_address: 'Bangkok',
          geometry: {
            location: { lat: 13.7329, lng: 100.5122 },
          },
          business_status: 'OPERATIONAL',
        },
      });
    }
    if (value.includes('/data_sources/')) {
      return jsonResponse({ results: [formalPage] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await resolvePageDryRun({
    pageReference: PAGE_ID,
    notionApiKey: 'formal-read-key',
    googlePlacesKey: 'google-test-key',
    expectedDataSourceId: FORMAL_DATA_SOURCE_ID,
    fetchImpl,
    now: new Date('2026-07-19T08:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000099',
  });

  assert.equal(result.page.dataSourceId, FORMAL_DATA_SOURCE_ID);
  assert.equal(result.writePerformed, false);
  assert.equal(result.resolver.apiMode, 'places_legacy');
  assert.equal(calls.some(({ method }) => method === 'PATCH'), false);
});

test('multiple Text Search results produce ambiguous payload without a Place ID', async () => {
  const pageWithoutPlaceId = page();
  pageWithoutPlaceId.properties['Google Place ID'] = richText('');

  const fetchImpl = async (url) => {
    if (String(url).includes('/v1/pages/')) {
      return jsonResponse(pageWithoutPlaceId);
    }
    if (String(url).endsWith('/places:searchText')) {
      return jsonResponse({
        places: [
          {
            id: 'ChIJone',
            displayName: { text: 'One' },
            location: { latitude: 13.7, longitude: 100.5 },
          },
          {
            id: 'ChIJtwo',
            displayName: { text: 'Two' },
            location: { latitude: 13.8, longitude: 100.6 },
          },
        ],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await resolvePageDryRun({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    googlePlacesKey: 'google-test-key',
    fetchImpl,
    now: new Date('2026-07-19T08:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000002',
    placesApiMode: 'auto',
  });

  const payload = JSON.parse(
    result.proposedPatch['Candidate Payload'].slice('lv2:'.length)
  );
  assert.equal(result.resolver.result, 'ambiguous');
  assert.equal(result.proposedPatch['Candidate Summary'], '[Multiple Candidates]');
  assert.equal(Object.hasOwn(payload, 'placeId'), false);
  assert.equal(result.resolver.candidates.length, 2);
  assert.match(
    result.resolver.candidates[0].mapsUrl,
    /query_place_id=ChIJone/
  );
  assert.match(
    result.resolver.candidates[1].mapsUrl,
    /query_place_id=ChIJtwo/
  );
  assert.notEqual(
    result.resolver.candidates[0].mapsUrl,
    result.resolver.candidates[1].mapsUrl
  );
});

test('legacy Text Search enriches Candidate suggestions with Place Details address components', async () => {
  const pageWithoutPlaceId = page();
  pageWithoutPlaceId.properties['Google Place ID'] = richText('');
  let detailsCalls = 0;

  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/v1/pages/')) {
      return jsonResponse(pageWithoutPlaceId);
    }
    if (value.includes('/place/textsearch/json')) {
      return jsonResponse({
        status: 'OK',
        results: [
          {
            place_id: 'ChIJsearched',
            name: 'Searched place',
            formatted_address: 'Bangkok, Thailand',
            geometry: {
              location: { lat: 13.7, lng: 100.5 },
            },
            business_status: 'OPERATIONAL',
          },
        ],
      });
    }
    if (value.includes('/place/details/json')) {
      detailsCalls += 1;
      return jsonResponse({
        status: 'OK',
        result: {
          place_id: 'ChIJsearched',
          name: 'Searched place',
          formatted_address: 'Bangkok, Thailand',
          address_components: [
            {
              long_name: 'Bangkok',
              short_name: 'Bangkok',
              types: ['administrative_area_level_1'],
            },
            {
              long_name: 'Thailand',
              short_name: 'TH',
              types: ['country'],
            },
          ],
          geometry: {
            location: { lat: 13.7, lng: 100.5 },
          },
          business_status: 'OPERATIONAL',
        },
      });
    }
    if (value.includes('/data_sources/')) {
      return jsonResponse({ results: [pageWithoutPlaceId] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await resolvePageDryRun({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    googlePlacesKey: 'google-test-key',
    fetchImpl,
    now: new Date('2026-07-19T08:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000004',
  });

  assert.equal(detailsCalls, 1);
  assert.equal(result.resolver.result, 'place_id_candidate');
  assert.equal(
    result.resolver.candidates[0].locationSuggestions.countryCode
      .recommendedValue,
    'TH'
  );
  assert.equal(
    result.resolver.candidates[0].locationSuggestions.destinationKey
      .recommendedValue,
    'bangkok'
  );
});

test('candidate patch converter permits only the five resolver workflow fields', () => {
  const properties = candidatePatchToNotionProperties({
    'Review Needed': '__YES__',
    'Candidate Summary': '[Candidate Ready]',
    'Candidate Maps URL': 'https://example.com/candidate',
    'Candidate Payload': 'lv2:{"schemaVersion":2}',
    'Review Decision': null,
  });
  assert.deepEqual(Object.keys(properties).sort(), [
    'Candidate Maps URL',
    'Candidate Payload',
    'Candidate Summary',
    'Review Decision',
    'Review Needed',
  ]);
  assert.throws(
    () =>
      candidatePatchToNotionProperties({
        'Review Needed': '__YES__',
        'Candidate Summary': '[Candidate Ready]',
        'Candidate Maps URL': 'https://example.com/candidate',
        'Candidate Payload': 'lv2:{"schemaVersion":2}',
        'Review Decision': null,
        Status: 'Published',
      }),
    /non-candidate fields: Status/
  );
});

test('review patch converter permits only the three human decision fields', () => {
  const properties = reviewPatchToNotionProperties({
    'Review Decision': 'Keep Current',
    'Coordinate Type': 'Exact',
    'Verification Note': 'Verified by operator',
  });
  assert.deepEqual(Object.keys(properties).sort(), [
    'Coordinate Type',
    'Review Decision',
    'Verification Note',
  ]);
  assert.throws(
    () =>
      reviewPatchToNotionProperties({
        'Review Decision': 'Keep Current',
        'Coordinate Type': 'Exact',
        'Verification Note': 'Verified by operator',
        Status: 'Published',
      }),
    /unsupported fields: Status/
  );
});

test('Notion rich text converter safely chunks append-only notes', () => {
  const note = '證'.repeat(2500);
  const properties = reviewPatchToNotionProperties({
    'Review Decision': 'Keep Current',
    'Coordinate Type': 'Exact',
    'Verification Note': note,
  });
  assert.equal(properties['Verification Note'].rich_text.length, 2);
  assert.equal(
    properties['Verification Note'].rich_text
      .map((item) => item.text.content)
      .join(''),
    note
  );
});

test('review dry-run validates a decision without writing Notion', async () => {
  const initial = reviewReadyPage();
  initial.properties['Review Decision'] = select('');
  initial.properties['Coordinate Type'] = select('');
  initial.properties['Verification Note'] = richText('');
  const harness = applyFetchHarness(initial);

  const result = await reviewPageDryRun({
    pageReference: PAGE_ID,
    decision: 'Keep Current',
    coordinateType: 'Exact',
    verificationNote: '人工確認為同一地點。',
    notionApiKey: 'notion-test-key',
    fetchImpl: harness.fetchImpl,
    now: new Date('2026-07-19T09:00:00.000Z'),
  });

  assert.equal(result.mode, 'dry-run');
  assert.equal(result.writePerformed, false);
  assert.equal(result.review.decision, 'Keep Current');
  assert.equal(result.review.coordinateType, 'Exact');
  assert.equal(
    harness.calls.some((call) => call.method === 'PATCH'),
    false
  );
});

test('review newEvidence appends history and is required outside Need Research', async () => {
  const initial = reviewReadyPage();
  const harness = applyFetchHarness(initial);
  const existing = notionPageToRow(initial)['Verification Note'];

  const result = await reviewPageDryRun({
    pageReference: PAGE_ID,
    decision: 'Keep Current',
    coordinateType: 'Exact',
    newEvidence: '本次再次核對地圖與地址。',
    notionApiKey: 'notion-test-key',
    fetchImpl: harness.fetchImpl,
    now: new Date('2026-07-19T09:00:00.000Z'),
  });
  assert.equal(
    result.proposedPatch['Verification Note'],
    `${existing}\n本次再次核對地圖與地址。`
  );
  assert.equal(result.review.newEvidence, '本次再次核對地圖與地址。');

  await assert.rejects(
    reviewPageDryRun({
      pageReference: PAGE_ID,
      decision: 'Keep Current',
      coordinateType: 'Exact',
      newEvidence: '',
      notionApiKey: 'notion-test-key',
      fetchImpl: harness.fetchImpl,
    }),
    /New verification evidence is required/
  );
});

test('review confirm writes only the three human decision fields and verifies them', async () => {
  const initial = reviewReadyPage();
  initial.properties['Review Decision'] = select('');
  initial.properties['Coordinate Type'] = select('');
  initial.properties['Verification Note'] = richText('');
  const harness = applyFetchHarness(initial);
  const lockRoot = await mkdtemp(join(tmpdir(), 'lv-review-lock-'));

  try {
    const result = await reviewPageConfirm({
      pageReference: PAGE_ID,
      decision: 'Keep Current',
      coordinateType: 'Exact',
      verificationNote: '人工確認為同一地點。',
      notionApiKey: 'notion-test-key',
      fetchImpl: harness.fetchImpl,
      now: new Date('2026-07-19T09:00:00.000Z'),
      lockRoot,
    });

    assert.equal(result.mode, 'confirm');
    assert.equal(result.writePerformed, true);
    assert.equal(result.verification.reviewPatchMatched, true);
    const patchCall = harness.calls.find((call) => call.method === 'PATCH');
    assert.deepEqual(
      Object.keys(JSON.parse(patchCall.body).properties).sort(),
      ['Coordinate Type', 'Review Decision', 'Verification Note']
    );
    const finalRow = notionPageToRow(harness.getPage());
    assert.equal(finalRow['Review Decision'], 'Keep Current');
    assert.equal(finalRow['Coordinate Type'], 'Exact');
    assert.equal(finalRow['Verification Note'], '人工確認為同一地點。');
    assert.equal(finalRow.Status, 'Paused');
  } finally {
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test('review write against the formal Locations database uses NOTION_API_KEY directly', async () => {
  let formalPage = page({
    parent: {
      type: 'data_source_id',
      data_source_id: FORMAL_DATA_SOURCE_ID,
    },
  });
  const formalCandidate = buildPlaceIdCandidatePatch({
    row: notionPageToRow(formalPage),
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    expectedDataSourceId: FORMAL_DATA_SOURCE_ID,
    placeId: 'ChIJcurrent',
    candidateSource: 'existing_place_id',
    verificationMethod: 'places_refresh',
    query: '漢王廟 (Han Wang Miao) Bangkok',
    reviewRunId: 'formal-review-ready',
    resolvedAt: '2026-07-19T01:00:00.000Z',
    reviewExpiresAt: '2026-08-18T01:00:00.000Z',
  });
  formalPage = applyNotionProperties(
    formalPage,
    candidatePatchToNotionProperties(formalCandidate)
  );
  formalPage.properties['Review Decision'] = select('');
  formalPage.properties['Coordinate Type'] = select('');
  formalPage.properties['Verification Note'] = richText('');

  const harness = applyFetchHarness(formalPage);
  const result = await reviewPageConfirm({
    pageReference: PAGE_ID,
    decision: 'Need Research',
    coordinateType: '',
    newEvidence: '',
    notionApiKey: 'notion-test-key',
    fetchImpl: async (url, options = {}) => {
      assert.equal(options.headers?.Authorization, 'Bearer notion-test-key');
      return harness.fetchImpl(url, options);
    },
  });
  assert.equal(result.writePerformed, true);
  assert.equal(
    notionPageToRow(harness.getPage())['Review Decision'],
    'Need Research'
  );
});

test('review preview preserves existing Verification Note history', async () => {
  const initial = reviewReadyPage();
  const harness = applyFetchHarness(initial);

  await assert.rejects(
    reviewPageDryRun({
      pageReference: PAGE_ID,
      decision: 'Keep Current',
      coordinateType: 'Exact',
      verificationNote: 'replacement',
      notionApiKey: 'notion-test-key',
      fetchImpl: harness.fetchImpl,
    }),
    /append-only/
  );
});

test('coordinate correction dry-run validates source and previews only intended formal fields', async () => {
  const initial = page();
  const harness = applyFetchHarness(initial);
  const sourceUrl =
    'https://www.openstreetmap.org/way/608350816';
  const result = await coordinateCorrectionPageDryRun({
    pageReference: PAGE_ID,
    lat: '13.72709',
    lng: '100.54728',
    sourceUrl,
    sourceConfirmed: true,
    notionApiKey: 'notion-test-key',
    fetchImpl: harness.fetchImpl,
    now: new Date('2026-07-20T10:00:00.000Z'),
  });

  assert.equal(result.writePerformed, false);
  assert.deepEqual(result.proposedPatch, {
    Lat: 13.72709,
    Lng: 100.54728,
    'Source URLs': sourceUrl,
  });
  assert.equal(result.coordinateCorrection.sourceAlreadyRecorded, false);
  assert.equal(result.coordinateCorrection.distanceMeters > 0, true);
  assert.equal(
    harness.calls.some((call) => call.method === 'PATCH'),
    false
  );

  await assert.rejects(
    coordinateCorrectionPageDryRun({
      pageReference: PAGE_ID,
      lat: 13.72709,
      lng: 100.54728,
      sourceUrl,
      sourceConfirmed: false,
      notionApiKey: 'notion-test-key',
      fetchImpl: harness.fetchImpl,
    }),
    /traceable non-Places source/
  );
});

test('coordinate correction confirm writes Lat/Lng and appends a new source without changing workflow', async () => {
  const initial = page();
  const harness = applyFetchHarness(initial);
  const lockRoot = await mkdtemp(
    join(tmpdir(), 'lv-coordinate-lock-')
  );
  try {
    const result = await coordinateCorrectionPageConfirm({
      pageReference: PAGE_ID,
      lat: 13.72709,
      lng: 100.54728,
      sourceUrl: 'https://www.openstreetmap.org/way/608350816',
      sourceConfirmed: true,
      notionApiKey: 'notion-test-key',
      fetchImpl: harness.fetchImpl,
      now: new Date('2026-07-20T10:00:00.000Z'),
      lockRoot,
    });
    assert.equal(result.writePerformed, true);
    const patchCall = harness.calls.find(
      (call) => call.method === 'PATCH'
    );
    assert.deepEqual(
      Object.keys(JSON.parse(patchCall.body).properties).sort(),
      ['Lat', 'Lng', 'Source URLs']
    );
    const finalRow = notionPageToRow(harness.getPage());
    assert.equal(finalRow.Lat, 13.72709);
    assert.equal(finalRow.Lng, 100.54728);
    assert.equal(
      finalRow['Source URLs'],
      'https://www.openstreetmap.org/way/608350816'
    );
    assert.equal(finalRow['Google Place ID'], 'ChIJcurrent');
    assert.match(finalRow['Google Maps URL'], /Han\+Wang\+Miao/);
    assert.equal(finalRow.Status, 'Paused');
    assert.equal(finalRow['Review Needed'], '__YES__');
    assert.equal(finalRow['Candidate Payload'], '');
  } finally {
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test('coordinate correction can patch only Lat/Lng when the source is already recorded', async () => {
  const sourceUrl =
    'https://www.openstreetmap.org/way/608350816';
  const initial = page();
  initial.properties['Source URLs'] = richText(sourceUrl);
  const harness = applyFetchHarness(initial);
  const preview = await coordinateCorrectionPageDryRun({
    pageReference: PAGE_ID,
    lat: 13.72709,
    lng: 100.54728,
    sourceUrl,
    sourceConfirmed: true,
    notionApiKey: 'notion-test-key',
    fetchImpl: harness.fetchImpl,
  });
  assert.deepEqual(preview.proposedPatch, {
    Lat: 13.72709,
    Lng: 100.54728,
  });
  assert.deepEqual(
    coordinateCorrectionPatchToNotionProperties(
      preview.proposedPatch
    ),
    {
      Lat: { number: 13.72709 },
      Lng: { number: 100.54728 },
    }
  );
});

test('coordinate correction refuses an active Candidate or Review decision', async () => {
  const active = reviewReadyPage();
  await assert.rejects(
    coordinateCorrectionPageDryRun({
      pageReference: PAGE_ID,
      lat: 13.72709,
      lng: 100.54728,
      sourceUrl:
        'https://www.openstreetmap.org/way/608350816',
      sourceConfirmed: true,
      notionApiKey: 'notion-test-key',
      fetchImpl: async () => jsonResponse(active),
    }),
    /Clear Candidate and Review fields/
  );
});

test('candidate reset clears only workflow fields and appends an audit reason', async () => {
  const initial = reviewReadyPage();
  initial.properties['Rejected Place IDs'] = richText('ChIJold-rejected');
  const harness = applyFetchHarness(initial);
  const lockRoot = await mkdtemp(join(tmpdir(), 'lv-reset-lock-'));

  try {
    const preview = await candidateResetPageDryRun({
      pageReference: PAGE_ID,
      reason: '候選已過期，重新執行 resolver',
      notionApiKey: 'notion-test-key',
      fetchImpl: harness.fetchImpl,
      now: new Date('2026-07-19T09:30:00.000Z'),
    });
    assert.equal(preview.writePerformed, false);
    assert.equal(
      preview.proposedPatch['Verification Note'].includes(
        'candidate-reset reviewRunId=review-ready'
      ),
      true
    );

    const result = await candidateResetPageConfirm({
      pageReference: PAGE_ID,
      reason: '候選已過期，重新執行 resolver',
      notionApiKey: 'notion-test-key',
      fetchImpl: harness.fetchImpl,
      now: new Date('2026-07-19T09:30:00.000Z'),
      lockRoot,
    });
    assert.equal(result.writePerformed, true);
    const patchCall = harness.calls.find((call) => call.method === 'PATCH');
    assert.deepEqual(
      Object.keys(JSON.parse(patchCall.body).properties).sort(),
      [
        'Candidate Maps URL',
        'Candidate Payload',
        'Candidate Summary',
        'Review Decision',
        'Review Needed',
        'Verification Note',
      ]
    );
    const row = notionPageToRow(harness.getPage());
    assert.equal(row['Candidate Payload'], '');
    assert.equal(row['Review Decision'], '');
    assert.equal(row['Review Needed'], '__YES__');
    assert.equal(row['Coordinate Type'], 'Exact');
    assert.equal(row['Rejected Place IDs'], 'ChIJold-rejected');
    assert.equal(row.Status, 'Paused');
  } finally {
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test('candidate reset supports invalid payload recovery but blocks pending apply', async () => {
  const invalid = reviewReadyPage();
  invalid.properties['Candidate Payload'] = richText('broken-payload');
  const dryRun = await candidateResetPageDryRun({
    pageReference: PAGE_ID,
    reason: 'Payload 已損壞',
    notionApiKey: 'notion-test-key',
    fetchImpl: async () => jsonResponse(invalid),
    now: new Date('2026-07-19T09:30:00.000Z'),
  });
  assert.equal(dryRun.reset.reviewRunId, 'unreadable');

  const pending = reviewReadyPage();
  pending.properties['Apply Metadata'] = richText(
    buildPendingApplyPatch({
      row: notionPageToRow(pending),
      dataSourceId: FORMAL_DATA_SOURCE_ID,
      actionRunId: 'action-pending-reset',
      now: '2026-07-19T09:30:00.000Z',
    })['Apply Metadata']
  );
  await assert.rejects(
    candidateResetPageDryRun({
      pageReference: PAGE_ID,
      reason: '嘗試 reset',
      notionApiKey: 'notion-test-key',
      fetchImpl: async () => jsonResponse(pending),
    }),
    /Apply Metadata is pending/
  );
});

test('candidate reset converter refuses formal or rejected fields', () => {
  const base = {
    'Review Needed': '__YES__',
    'Candidate Summary': null,
    'Candidate Maps URL': null,
    'Candidate Payload': null,
    'Review Decision': null,
    'Verification Note': 'history',
  };
  assert.deepEqual(
    Object.keys(candidateResetPatchToNotionProperties(base)).sort(),
    [
      'Candidate Maps URL',
      'Candidate Payload',
      'Candidate Summary',
      'Review Decision',
      'Review Needed',
      'Verification Note',
    ]
  );
  assert.throws(
    () =>
      candidateResetPatchToNotionProperties({
        ...base,
        'Rejected Place IDs': 'ChIJcandidate',
      }),
    /unsupported fields/
  );
});

test('resolve write uses legacy Places, previews first, and verifies five Notion fields', async () => {
  let remotePage = page();
  let previewSeen = false;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    const method = options.method || 'GET';
    calls.push({ url: value, method, options });

    if (value.includes('/v1/pages/') && method === 'GET') {
      return jsonResponse(remotePage);
    }
    if (value.includes('/place/details/json')) {
      return jsonResponse({
        status: 'OK',
        result: {
          place_id: 'ChIJcurrent',
          name: 'Example Candidate',
          formatted_address: 'Example Address',
          geometry: {
            location: { lat: 13.7329, lng: 100.5122 },
          },
          business_status: 'OPERATIONAL',
          types: ['place_of_worship'],
        },
      });
    }
    if (value.includes('/data_sources/')) {
      return jsonResponse({ results: [remotePage] });
    }
    if (value.includes('/v1/pages/') && method === 'PATCH') {
      assert.equal(previewSeen, true);
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body.properties).sort(), [
        'Candidate Maps URL',
        'Candidate Payload',
        'Candidate Summary',
        'Review Decision',
        'Review Needed',
      ]);
      remotePage = applyNotionProperties(remotePage, body.properties);
      return jsonResponse(remotePage);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await resolvePageWrite({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    googlePlacesKey: 'google-test-key',
    fetchImpl,
    now: new Date('2026-07-19T09:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000005',
    onPreview: (preview) => {
      previewSeen = true;
      assert.equal(preview.writePerformed, false);
      assert.equal(preview.resolver.apiMode, 'places_legacy');
    },
  });

  assert.equal(result.mode, 'write');
  assert.equal(result.writePerformed, true);
  assert.equal(result.verification.candidatePatchMatched, true);
  assert.equal(result.verification.formalFieldsUnchanged, true);
  assert.equal(result.verification.recoveredAfterWriteError, false);
  assert.equal(
    calls.filter(({ method }) => method === 'PATCH').length,
    1
  );
  assert.equal(
    calls.some(({ url }) => url.includes('places.googleapis.com')),
    false
  );
  assert.equal(notionPageToRow(remotePage).Status, 'Paused');
  assert.equal(
    notionPageToRow(remotePage)['Candidate Summary'],
    '[Candidate Ready]'
  );
});

test('resolve write recovers when Notion applies the patch but the response is lost', async () => {
  let remotePage = page();
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    const method = options.method || 'GET';
    if (value.includes('/v1/pages/') && method === 'GET') {
      return jsonResponse(remotePage);
    }
    if (value.includes('/place/details/json')) {
      return jsonResponse({
        status: 'OK',
        result: {
          place_id: 'ChIJcurrent',
          name: 'Example Candidate',
          geometry: {
            location: { lat: 13.7329, lng: 100.5122 },
          },
        },
      });
    }
    if (value.includes('/data_sources/')) {
      return jsonResponse({ results: [remotePage] });
    }
    if (value.includes('/v1/pages/') && method === 'PATCH') {
      const body = JSON.parse(options.body);
      remotePage = applyNotionProperties(remotePage, body.properties);
      throw new Error('simulated response loss');
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await resolvePageWrite({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    googlePlacesKey: 'google-test-key',
    fetchImpl,
    now: new Date('2026-07-19T09:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000006',
    onPreview: () => {},
  });

  assert.equal(result.writePerformed, true);
  assert.equal(result.verification.recoveredAfterWriteError, true);
  assert.equal(
    notionPageToRow(remotePage)['Candidate Summary'],
    '[Candidate Ready]'
  );
});

test('resolve write refuses an existing candidate before calling Places', async () => {
  const occupied = page();
  occupied.properties['Candidate Payload'] = richText('lv2:existing');
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    return jsonResponse(occupied);
  };

  await assert.rejects(
    resolvePageWrite({
      pageReference: PAGE_ID,
      notionApiKey: 'notion-test-key',
      googlePlacesKey: 'google-test-key',
      fetchImpl,
    }),
    /Refusing overwrite/
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
});

test('resolve write re-reads and refuses a candidate created during resolution', async () => {
  const emptyPage = page();
  const occupiedPage = page();
  occupiedPage.properties['Candidate Payload'] = richText('lv2:concurrent');
  let pageReads = 0;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    const method = options.method || 'GET';
    calls.push({ url: value, method });
    if (value.includes('/v1/pages/') && method === 'GET') {
      pageReads += 1;
      return jsonResponse(pageReads === 1 ? emptyPage : occupiedPage);
    }
    if (value.includes('/place/details/json')) {
      return jsonResponse({
        status: 'OK',
        result: {
          place_id: 'ChIJcurrent',
          name: 'Example Candidate',
          geometry: { location: { lat: 13.7, lng: 100.5 } },
        },
      });
    }
    if (value.includes('/data_sources/')) {
      return jsonResponse({ results: [emptyPage] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  await assert.rejects(
    resolvePageWrite({
      pageReference: PAGE_ID,
      notionApiKey: 'notion-test-key',
      googlePlacesKey: 'google-test-key',
      fetchImpl,
      onPreview: () => {},
    }),
    /Refusing overwrite/
  );
  assert.equal(calls.some(({ method }) => method === 'PATCH'), false);
});

test('runner defaults to dry-run and requires a single explicit write mode', () => {
  const defaultOptions = parseRunnerArgs(['resolve', '--page', PAGE_ID]);
  assert.equal(defaultOptions.mode, 'dry-run');
  assert.equal(defaultOptions.placesApiMode, 'legacy');
  assert.equal(
    parseRunnerArgs(['resolve', '--page', PAGE_ID, '--write']).mode,
    'write'
  );
  assert.equal(
    parseRunnerArgs([
      'resolve',
      '--page',
      PAGE_ID,
      '--dry-run',
      '--places-api',
      'legacy',
    ]).placesApiMode,
    'legacy'
  );
  assert.equal(
    parseRunnerArgs([
      'resolve',
      '--page',
      PAGE_ID,
      '--places-api=legacy',
    ]).placesApiMode,
    'legacy'
  );
  assert.throws(
    () =>
      parseRunnerArgs([
        'resolve',
        '--page',
        PAGE_ID,
        '--places-api',
        'auto',
      ]),
    /must be legacy/
  );
  assert.throws(
    () =>
      parseRunnerArgs([
        'resolve',
        '--page',
        PAGE_ID,
        '--dry-run',
        '--write',
      ]),
    /exactly one/
  );
});

test('apply dry-run validates the review and previews pending then completed without writes', async () => {
  const ready = reviewReadyPage();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    return jsonResponse(ready);
  };

  const result = await applyPageDryRun({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl,
    now: new Date('2026-07-19T10:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000007',
  });

  const pendingMetadata = JSON.parse(
    result.pendingPatch['Apply Metadata'].slice('lv1:'.length)
  );
  const completedMetadata = JSON.parse(
    result.completedPatch['Apply Metadata'].slice('lv1:'.length)
  );
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.writePerformed, false);
  assert.equal(
    result.apply.actionRunId,
    'action-00000000-0000-4000-8000-000000000007'
  );
  assert.equal(result.apply.reviewRunId, 'review-ready');
  assert.equal(pendingMetadata.state, 'pending');
  assert.equal(completedMetadata.state, 'completed');
  assert.equal(result.completedPatch.Status, 'Published');
  assert.equal(result.completedPatch['Review Needed'], '__NO__');
  assert.equal(result.completedPatch['Candidate Payload'], null);
  assert.equal(Object.hasOwn(result.completedPatch, 'Lat'), false);
  assert.equal(Object.hasOwn(result.completedPatch, 'Lng'), false);
  assert.equal(Object.hasOwn(result.completedPatch, 'Google Place ID'), false);
  assert.deepEqual(result.expectedFormalChanges, { Status: 'Published' });
  assert.equal(calls.some(({ method }) => method !== 'GET'), false);
});

test('apply confirm reuses an explicitly approved preview action identity', async () => {
  const ready = reviewReadyPage();
  let writes = 0;
  await assert.rejects(
    applyPageConfirm({
      pageReference: PAGE_ID,
      notionApiKey: 'notion-test-key',
      approvedActionRunId: 'action-preview-approved',
      now: new Date('2026-07-19T10:05:00.000Z'),
      randomUUIDImpl: () => {
        throw new Error('must not generate a different action ID');
      },
      fetchImpl: async (_url, options = {}) => {
        if ((options.method || 'GET') !== 'GET') writes += 1;
        return jsonResponse(ready);
      },
      onPreview: (preview) => {
        assert.equal(
          preview.apply.actionRunId,
          'action-preview-approved'
        );
        assert.equal(
          preview.apply.now,
          '2026-07-19T10:05:00.000Z'
        );
        throw new Error('stop after approved preview identity check');
      },
    }),
    /stop after approved preview identity check/
  );
  assert.equal(writes, 0);
});

test('apply dry-run refuses a page without an explicit Review Decision', async () => {
  const ready = reviewReadyPage();
  ready.properties['Review Decision'] = select('');
  await assert.rejects(
    applyPageDryRun({
      pageReference: PAGE_ID,
      notionApiKey: 'notion-test-key',
      fetchImpl: async () => jsonResponse(ready),
      now: new Date('2026-07-19T10:00:00.000Z'),
    }),
    /Unsupported Review Decision/
  );
});

test('apply patch converter maps completed fields and rejects unsupported writes', () => {
  const properties = applyPatchToNotionProperties({
    'Apply Metadata':
      'lv1:{"schemaVersion":1,"actionRunId":"action-test","reviewRunId":"review-test","decision":"Keep Current","state":"completed","basisRevision":"sha256:test","updatedAt":"2026-07-19T10:00:00.000Z"}',
    Status: 'Published',
    'Review Needed': '__NO__',
    'Verification Note': 'Verified',
    'date:Last Verified:start': '2026-07-19T10:00:00.000Z',
    'date:Last Verified:is_datetime': 1,
    'Candidate Payload': null,
  });
  assert.deepEqual(properties.Status, {
    select: { name: 'Published' },
  });
  assert.deepEqual(properties['Review Needed'], { checkbox: false });
  assert.deepEqual(properties['Last Verified'], {
    date: { start: '2026-07-19T10:00:00.000Z' },
  });
  assert.deepEqual(properties['Candidate Payload'], { rich_text: [] });
  assert.throws(
    () =>
      applyPatchToNotionProperties({
        'Apply Metadata':
          'lv1:{"schemaVersion":1,"actionRunId":"action-test","reviewRunId":"review-test","decision":"Keep Current","state":"completed","basisRevision":"sha256:test","updatedAt":"2026-07-19T10:00:00.000Z"}',
        Lat: 13.7,
      }),
    /unsupported fields: Lat/
  );
});

test('apply confirm writes pending then completed and verifies the final page', async () => {
  let remotePage = reviewReadyPage();
  const calls = [];
  let previewSeen = false;
  let beforePendingWriteSeen = false;
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url: String(url), method, body: options.body || null });
    if (method === 'GET') return jsonResponse(remotePage);
    if (method === 'PATCH') {
      const body = JSON.parse(options.body);
      remotePage = applyNotionProperties(remotePage, body.properties);
      return jsonResponse(remotePage);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await applyPageConfirm({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl,
    now: new Date('2026-07-19T10:00:48.094Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000008',
    onPreview: (preview) => {
      previewSeen = true;
      assert.equal(preview.writePerformed, false);
      assert.equal(
        calls.filter(({ method }) => method === 'PATCH').length,
        0
      );
    },
    onBeforePendingWrite: (preview) => {
      beforePendingWriteSeen = true;
      assert.equal(preview.page.slug, 'han-wang-miao');
      assert.equal(
        calls.filter(({ method }) => method === 'PATCH').length,
        0
      );
    },
  });

  const finalRow = notionPageToRow(remotePage);
  const finalMetadata = JSON.parse(
    finalRow['Apply Metadata'].slice('lv1:'.length)
  );
  assert.equal(previewSeen, true);
  assert.equal(beforePendingWriteSeen, true);
  assert.equal(result.mode, 'confirm');
  assert.equal(result.writePerformed, true);
  assert.equal(result.alreadyCompleted, false);
  assert.equal(finalMetadata.state, 'completed');
  assert.equal(
    finalMetadata.actionRunId,
    'action-00000000-0000-4000-8000-000000000008'
  );
  assert.equal(finalRow.Status, 'Published');
  assert.equal(finalRow['Review Needed'], '__NO__');
  assert.equal(finalRow['Candidate Payload'], '');
  assert.equal(finalRow['Candidate Summary'], '');
  assert.equal(finalRow['Candidate Maps URL'], '');
  assert.equal(finalRow['Review Decision'], '');
  assert.equal(finalRow['Coordinate Type'], 'Exact');
  assert.equal(finalRow['Google Place ID'], 'ChIJcurrent');
  assert.equal(finalRow.Lat, 13.73288);
  assert.equal(finalRow.Lng, 100.51218);
  assert.equal(
    finalRow['Last Verified'],
    '2026-07-19T10:00:00.000Z'
  );
  assert.equal(
    finalRow['Place ID Checked At'],
    '2026-07-19T10:00:00.000Z'
  );
  assert.match(
    finalRow['Verification Note'],
    /decision=Keep Current actionRunId=action-00000000/
  );
  assert.equal(
    calls.filter(({ method }) => method === 'PATCH').length,
    2
  );

  const replay = await applyPageConfirm({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl,
    randomUUIDImpl: () => 'must-not-create-a-second-action',
  });
  assert.equal(replay.alreadyCompleted, true);
  assert.equal(replay.writePerformed, false);
  assert.equal(
    replay.apply.actionRunId,
    'action-00000000-0000-4000-8000-000000000008'
  );
  assert.equal(
    calls.filter(({ method }) => method === 'PATCH').length,
    2
  );
});

test('apply confirm resumes an existing pending action with the same action ID', async () => {
  let remotePage = reviewReadyPage();
  const pending = buildPendingApplyPatch({
    row: notionPageToRow(remotePage),
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    actionRunId: 'action-existing',
    now: '2026-07-19T09:00:00.000Z',
  });
  remotePage = applyNotionProperties(
    remotePage,
    applyPatchToNotionProperties(pending)
  );
  let patchCount = 0;
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET') return jsonResponse(remotePage);
    patchCount += 1;
    const body = JSON.parse(options.body);
    remotePage = applyNotionProperties(remotePage, body.properties);
    return jsonResponse(remotePage);
  };

  const result = await applyPageConfirm({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl,
    now: new Date('2026-07-19T11:00:00.000Z'),
    randomUUIDImpl: () => 'must-not-be-used-for-the-result',
  });

  assert.equal(result.apply.actionRunId, 'action-existing');
  assert.equal(result.apply.now, '2026-07-19T09:00:00.000Z');
  assert.equal(result.apply.resumedFromPending, true);
  assert.equal(patchCount, 1);
  assert.equal(notionPageToRow(remotePage).Status, 'Published');
});

test('apply confirm keeps pending metadata when the completed write fails', async () => {
  let remotePage = reviewReadyPage();
  let patchCount = 0;
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET') return jsonResponse(remotePage);
    patchCount += 1;
    if (patchCount === 1) {
      const body = JSON.parse(options.body);
      remotePage = applyNotionProperties(remotePage, body.properties);
      return jsonResponse(remotePage);
    }
    return jsonResponse({ error: { status: 'internal_error' } }, 500);
  };

  await assert.rejects(
    applyPageConfirm({
      pageReference: PAGE_ID,
      notionApiKey: 'notion-test-key',
      fetchImpl,
      now: new Date('2026-07-19T10:00:00.000Z'),
      randomUUIDImpl: () => '00000000-0000-4000-8000-000000000009',
    }),
    /pending action preserved/
  );
  const row = notionPageToRow(remotePage);
  assert.equal(
    JSON.parse(row['Apply Metadata'].slice('lv1:'.length)).state,
    'pending'
  );
  assert.equal(row.Status, 'Paused');
  assert.equal(row['Candidate Payload'] !== '', true);
});

test('apply confirm recovers when the completed write response is lost', async () => {
  let remotePage = reviewReadyPage();
  let patchCount = 0;
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET') return jsonResponse(remotePage);
    patchCount += 1;
    const body = JSON.parse(options.body);
    remotePage = applyNotionProperties(remotePage, body.properties);
    if (patchCount === 2) {
      return jsonResponse({ error: { status: 'gateway_timeout' } }, 504);
    }
    return jsonResponse(remotePage);
  };

  const result = await applyPageConfirm({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl,
    now: new Date('2026-07-19T10:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000010',
  });

  assert.equal(result.verification.recoveredCompletedWrite, true);
  assert.equal(notionPageToRow(remotePage).Status, 'Published');
});

test('Need Research replay returns its completed action while keeping the candidate queue', async () => {
  let remotePage = reviewReadyPage();
  remotePage.properties['Review Decision'] = select('Need Research');
  let patchCount = 0;
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET') return jsonResponse(remotePage);
    patchCount += 1;
    const body = JSON.parse(options.body);
    remotePage = applyNotionProperties(remotePage, body.properties);
    return jsonResponse(remotePage);
  };

  const first = await applyPageConfirm({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl,
    now: new Date('2026-07-19T10:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000011',
  });
  const replay = await applyPageConfirm({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl,
    randomUUIDImpl: () => 'must-not-create-a-second-action',
  });
  const row = notionPageToRow(remotePage);

  assert.equal(first.writePerformed, true);
  assert.equal(replay.alreadyCompleted, true);
  assert.equal(replay.writePerformed, false);
  assert.equal(patchCount, 2);
  assert.equal(row['Review Decision'], 'Need Research');
  assert.equal(row['Review Needed'], '__YES__');
  assert.equal(row['Candidate Payload'] !== '', true);
  assert.equal(
    row['Verification Note'].match(/actionRunId=/g)?.length,
    1
  );
});

test('Accept Candidate confirm updates only Place ID, Maps URL, and workflow fields', async () => {
  const initial = reviewReadyPage({
    decision: 'Accept Candidate',
    candidatePlaceId: 'ChIJcandidate',
  });
  const harness = applyFetchHarness(initial);
  await applyPageConfirm({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl: harness.fetchImpl,
    now: new Date('2026-07-19T12:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000015',
  });
  const row = notionPageToRow(harness.getPage());

  assert.equal(row.Status, 'Published');
  assert.equal(row['Review Needed'], '__NO__');
  assert.equal(row['Google Place ID'], 'ChIJcandidate');
  assert.match(row['Google Maps URL'], /query_place_id=ChIJcandidate/);
  assert.equal(row.Lat, 13.73288);
  assert.equal(row.Lng, 100.51218);
  assert.equal(row['Candidate Payload'], '');
  assert.equal(row['Review Decision'], '');
});

test('Reject Candidate confirm preserves formal fields and records the rejected Place ID', async () => {
  const initial = reviewReadyPage({ decision: 'Reject Candidate' });
  const harness = applyFetchHarness(initial);
  const result = await applyPageConfirm({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl: harness.fetchImpl,
    now: new Date('2026-07-19T12:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000012',
  });
  const row = notionPageToRow(harness.getPage());

  assert.equal(result.writePerformed, true);
  assert.equal(row.Status, 'Paused');
  assert.equal(row['Review Needed'], '__YES__');
  assert.equal(row['Rejected Place IDs'], 'ChIJcurrent');
  assert.equal(row['Google Place ID'], 'ChIJcurrent');
  assert.equal(row.Lat, 13.73288);
  assert.equal(row.Lng, 100.51218);
  assert.equal(row['Candidate Payload'], '');
  assert.equal(row['Review Decision'], '');
});

test('Could Not Find confirm inactivates the page and clears the candidate', async () => {
  const initial = reviewReadyPage({ decision: 'Could Not Find' });
  const harness = applyFetchHarness(initial);
  await applyPageConfirm({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl: harness.fetchImpl,
    now: new Date('2026-07-19T12:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000013',
  });
  const row = notionPageToRow(harness.getPage());

  assert.equal(row.Status, 'Inactive');
  assert.equal(row['Review Needed'], '__NO__');
  assert.equal(row['Rejected Place IDs'], 'ChIJcurrent');
  assert.equal(row['Google Place ID'], 'ChIJcurrent');
  assert.equal(row['Candidate Payload'], '');
  assert.equal(row['Review Decision'], '');
});

test('Deactivate confirm needs no candidate and does not reject the current Place ID', async () => {
  const initial = page();
  initial.properties.Status = select('Published');
  initial.properties['Review Needed'] = {
    type: 'checkbox',
    checkbox: false,
  };
  initial.properties['Review Decision'] = select('Deactivate');
  initial.properties['Verification Note'] = richText(
    '人工確認此地點不再收錄，但目前 Place ID 並非錯誤候選。'
  );
  const harness = applyFetchHarness(initial);
  await applyPageConfirm({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl: harness.fetchImpl,
    now: new Date('2026-07-19T12:00:00.000Z'),
    randomUUIDImpl: () => '00000000-0000-4000-8000-000000000014',
  });
  const row = notionPageToRow(harness.getPage());

  assert.equal(row.Status, 'Inactive');
  assert.equal(row['Review Needed'], '__NO__');
  assert.equal(row['Rejected Place IDs'], '');
  assert.equal(row['Google Place ID'], 'ChIJcurrent');
  assert.equal(row['Review Decision'], '');
});

test('apply blocks a duplicate Place ID found after resolver review', async () => {
  const initial = reviewReadyPage({ decision: 'Accept Candidate' });
  const duplicate = structuredClone(initial);
  duplicate.id = '4b2d3426-9fb3-921d-a925-ea6151d76027';
  duplicate.properties.Name = title('Different location');
  duplicate.properties.Slug = richText('different-location');
  const harness = applyFetchHarness(initial, {
    duplicatePages: [duplicate],
  });

  await assert.rejects(
    applyPageConfirm({
      pageReference: PAGE_ID,
      notionApiKey: 'notion-test-key',
      fetchImpl: harness.fetchImpl,
      now: new Date('2026-07-19T12:00:00.000Z'),
    }),
    /conflicts with another location: different-location/
  );
  assert.equal(
    harness.calls.some(({ method }) => method === 'PATCH'),
    false
  );
});

test('apply confirm fails closed for a page outside the allowlisted Locations database', async () => {
  const outsidePage = reviewReadyPage();
  outsidePage.parent.data_source_id = OTHER_DATA_SOURCE_ID;
  const calls = [];
  await assert.rejects(
    applyPageConfirm({
      pageReference: PAGE_ID,
      notionApiKey: 'notion-test-key',
      fetchImpl: async (url, options = {}) => {
        calls.push({
          url: String(url),
          method: options.method || 'GET',
        });
        return jsonResponse(outsidePage);
      },
    }),
    /not allowlisted/
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
});

test(
  'cross-process page lock blocks a second apply and releases cleanly',
  { timeout: 10000 },
  async () => {
    const lockRoot = await mkdtemp(
      join(tmpdir(), 'location-verification-lock-test-')
    );
    const runnerUrl = new URL(
      '../scripts/location-verification-runner.mjs',
      import.meta.url
    ).href;
    const childScript = `
      import { acquirePageApplyLock } from ${JSON.stringify(runnerUrl)};
      const lock = await acquirePageApplyLock({
        pageId: ${JSON.stringify(PAGE_ID)},
        lockRoot: ${JSON.stringify(lockRoot)}
      });
      process.stdout.write('LOCKED\\n');
      process.stdin.once('data', async () => {
        await lock.release();
        process.stdout.write('RELEASED\\n');
        process.stdin.pause();
      });
    `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', childScript],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    try {
      await new Promise((resolve, reject) => {
        let output = '';
        const onData = (chunk) => {
          output += chunk;
          if (output.includes('LOCKED')) {
            child.stdout.off('data', onData);
            resolve();
          }
        };
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', onData);
        child.once('exit', (code) => {
          reject(new Error(`Lock holder exited early with code ${code}`));
        });
      });

      let fetchCalls = 0;
      await assert.rejects(
        applyPageConfirm({
          pageReference: PAGE_ID,
          notionApiKey: 'notion-test-key',
          lockRoot,
          fetchImpl: async () => {
            fetchCalls += 1;
            return jsonResponse(reviewReadyPage());
          },
        }),
        /Apply lock already held/
      );
      assert.equal(fetchCalls, 0);

      child.stdin.write('release\n');
      const [exitCode] = await once(child, 'exit');
      assert.equal(exitCode, 0);

      const nextLock = await acquirePageApplyLock({
        pageId: PAGE_ID,
        lockRoot,
      });
      await nextLock.release();
    } finally {
      if (child.exitCode === null) child.kill();
      await rm(lockRoot, { recursive: true, force: true });
    }
  }
);

test('lock inspector reports an active owner and clear refuses it', async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), 'location-verification-active-lock-test-')
  );
  const lock = await acquirePageApplyLock({
    pageId: PAGE_ID,
    lockRoot,
  });
  try {
    const inspected = await inspectPageApplyLock({
      pageId: PAGE_ID,
      lockRoot,
    });
    assert.equal(inspected.state, 'active');
    assert.equal(inspected.clearable, false);
    assert.equal(inspected.owner.pid, process.pid);
    await assert.rejects(
      clearPageApplyLock({
        pageId: PAGE_ID,
        lockRoot,
        confirm: true,
      }),
      /still alive/
    );
  } finally {
    await lock.release();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test('confirmed lock clear removes only a same-host stale owner', async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), 'location-verification-stale-lock-test-')
  );
  const lockPath = await writeApplyLock(lockRoot);
  try {
    const inspected = await inspectPageApplyLock({
      pageId: PAGE_ID,
      lockRoot,
      processKillImpl: deadProcess,
    });
    assert.equal(inspected.state, 'stale');
    assert.equal(inspected.clearable, true);

    let acquisitionBlocked = false;
    const cleared = await clearPageApplyLock({
      pageId: PAGE_ID,
      lockRoot,
      confirm: true,
      processKillImpl: deadProcess,
      beforeUnlink: async () => {
        await assert.rejects(
          acquirePageApplyLock({
            pageId: PAGE_ID,
            lockRoot,
          }),
          /maintenance/
        );
        acquisitionBlocked = true;
      },
    });
    assert.equal(acquisitionBlocked, true);
    assert.equal(cleared.cleared, true);
    await assert.rejects(readFile(lockPath), /ENOENT/);
  } finally {
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test('lock clear refuses malformed metadata and leaves it in place', async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), 'location-verification-malformed-lock-test-')
  );
  const lockPath = join(lockRoot, `${parsePageReference(PAGE_ID)}.lock`);
  await writeFile(lockPath, '{not-json');
  try {
    const inspected = await inspectPageApplyLock({
      pageId: PAGE_ID,
      lockRoot,
    });
    assert.equal(inspected.state, 'malformed');
    assert.equal(inspected.clearable, false);
    await assert.rejects(
      clearPageApplyLock({
        pageId: PAGE_ID,
        lockRoot,
        confirm: true,
      }),
      /malformed/
    );
    assert.equal(await readFile(lockPath, 'utf8'), '{not-json');
  } finally {
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test('lock clear refuses a token replacement during inspection', async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), 'location-verification-lock-race-test-')
  );
  const lockPath = await writeApplyLock(lockRoot, { token: 'first-token' });
  try {
    await assert.rejects(
      clearPageApplyLock({
        pageId: PAGE_ID,
        lockRoot,
        confirm: true,
        processKillImpl: deadProcess,
        beforeUnlink: async () => {
          await writeApplyLock(lockRoot, { token: 'replacement-token' });
        },
      }),
      /changed during inspection/
    );
    const current = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.equal(current.token, 'replacement-token');
  } finally {
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test('apply CLI defaults to dry-run and accepts only explicit confirm mode', () => {
  assert.equal(
    parseRunnerArgs(['apply', '--page', PAGE_ID]).mode,
    'dry-run'
  );
  assert.equal(
    parseRunnerArgs(['apply', '--page', PAGE_ID, '--dry-run']).mode,
    'dry-run'
  );
  assert.equal(
    parseRunnerArgs(['apply', '--page', PAGE_ID, '--confirm']).mode,
    'confirm'
  );
  assert.throws(
    () => parseRunnerArgs(['apply', '--page', PAGE_ID, '--write']),
    /only valid for resolve/
  );
  assert.throws(
    () =>
      parseRunnerArgs([
        'apply',
        '--page',
        PAGE_ID,
        '--places-api',
        'legacy',
      ]),
    /only valid for resolve/
  );
  assert.throws(
    () =>
      parseRunnerArgs([
        'apply',
        '--page',
        PAGE_ID,
        '--dry-run',
        '--confirm',
      ]),
    /exactly one/
  );
});

test('lock CLI requires an explicit operation, page, and clear confirmation', () => {
  const pageUrl =
    'https://app.notion.com/p/ginalin/KAEW-BOUTIQUE-475c23158ea282dfbf3d019ead10ba0d';
  assert.deepEqual(parseRunnerArgs(['lock', 'inspect', '--page', pageUrl]), {
    command: 'lock',
    operation: 'inspect',
    pageReference: pageUrl,
    confirm: false,
  });
  assert.deepEqual(
    parseRunnerArgs(['lock', 'clear', '--page', pageUrl, '--confirm']),
    {
      command: 'lock',
      operation: 'clear',
      pageReference: pageUrl,
      confirm: true,
    }
  );
  assert.throws(
    () => parseRunnerArgs(['lock', 'clear', '--page', pageUrl]),
    /requires --confirm/
  );
  assert.throws(
    () =>
      parseRunnerArgs([
        'lock',
        'inspect',
        '--page',
        pageUrl,
        '--confirm',
      ]),
    /only valid for lock clear/
  );
});

test('validate CLI accepts only the explicit all mode', () => {
  assert.deepEqual(parseRunnerArgs(['validate', '--all']), {
    command: 'validate',
    mode: 'all',
  });
  assert.throws(() => parseRunnerArgs(['validate']), /validate --all/);
  assert.throws(
    () => parseRunnerArgs(['validate', '--all', '--page', PAGE_ID]),
    /validate --all/
  );
});

test('production-preflight CLI is explicit and has no write mode', () => {
  assert.deepEqual(
    parseRunnerArgs([
      'production-preflight',
      '--page',
      PAGE_ID,
      '--dry-run',
    ]),
    {
      command: 'production-preflight',
      pageReference: PAGE_ID,
      mode: 'dry-run',
    }
  );
  assert.deepEqual(
    parseRunnerArgs(['production-preflight', `--page=${PAGE_ID}`]),
    {
      command: 'production-preflight',
      pageReference: PAGE_ID,
      mode: 'dry-run',
    }
  );
  assert.throws(
    () =>
      parseRunnerArgs([
        'production-preflight',
        '--page',
        PAGE_ID,
        '--write',
      ]),
    /read-only/
  );
  assert.throws(
    () =>
      parseRunnerArgs([
        'production-preflight',
        '--page',
        PAGE_ID,
        '--confirm',
      ]),
    /read-only/
  );
});

test('production preflight reads one formal page and previews conservative migration without writes', async () => {
  const formalPage = page();
  formalPage.parent.data_source_id = FORMAL_DATA_SOURCE_ID;
  formalPage.properties.Status = select('Verified');
  for (const field of [
    'Branch Group',
    'Coordinates Approx',
    'Origin',
    'Review Needed',
    'Candidate Summary',
    'Candidate Maps URL',
    'Coordinate Type',
    'Review Decision',
    'Verification Note',
    'Last Verified',
    'Candidate Payload',
    'Apply Metadata',
    'Rejected Place IDs',
    'Place ID Checked At',
  ]) {
    delete formalPage.properties[field];
  }
  const calls = [];
  const result = await productionPreflightPage({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl: async (url, options = {}) => {
      calls.push({
        url: String(url),
        method: options.method || 'GET',
        authorization: options.headers.Authorization,
      });
      return jsonResponse(formalPage);
    },
  });

  assert.deepEqual(result.proposedPatch, {
    Status: 'Paused',
    'Review Needed': '__YES__',
  });
  assert.equal(result.schema.formalFieldCount, 17);
  assert.deepEqual(result.schema.missingFormalFields, []);
  assert.equal(result.schema.requiredWorkflowFieldCount, 3);
  assert.equal(result.schema.presentWorkflowFields.length, 0);
  assert.equal(result.schema.missingWorkflowFields.length, 3);
  assert.equal(result.schema.expectedPropertyCount, 20);
  assert.deepEqual(result.schema.wrongPropertyTypes, []);
  assert.equal(result.gates.formalReadBoundary, true);
  assert.equal(result.gates.canaryWriteReady, false);
  assert.equal(result.gates.formalWriteCredentialConsumed, false);
  assert.equal(result.writePerformed, false);
  assert.deepEqual(calls, [
    {
      url: `https://api.notion.com/v1/pages/${parsePageReference(PAGE_ID)}`,
      method: 'GET',
      authorization: 'Bearer notion-test-key',
    },
  ]);
});

test('production preflight accepts the current 20-property formal schema', async () => {
  const formalPage = page();
  formalPage.parent.data_source_id = FORMAL_DATA_SOURCE_ID;
  formalPage.properties.Status = select('Published');
  for (const field of [
    'Branch Group',
    'Coordinates Approx',
    'Origin',
    'Candidate Summary',
    'Candidate Maps URL',
    'Coordinate Type',
    'Review Decision',
    'Candidate Payload',
    'Apply Metadata',
    'Rejected Place IDs',
    'Place ID Checked At',
  ]) {
    delete formalPage.properties[field];
  }

  const result = await productionPreflightPage({
    pageReference: PAGE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl: async () => jsonResponse(formalPage),
  });

  assert.deepEqual(result.proposedPatch, {});
  assert.deepEqual(result.schema, {
    formalFieldCount: 17,
    missingFormalFields: [],
    requiredWorkflowFieldCount: 3,
    presentWorkflowFields: [
      'Review Needed',
      'Verification Note',
      'Last Verified',
    ],
    missingWorkflowFields: [],
    expectedPropertyCount: 20,
    wrongPropertyTypes: [],
    unexpectedProperties: [],
    statusOptions: {
      checked: false,
      ok: true,
      missing: [],
      unexpected: [],
      wrongColors: [],
    },
    typeOptions: {
      checked: false,
      ok: true,
      missing: [],
      unexpected: [],
      wrongColors: [],
    },
    countryOptions: {
      checked: false,
      ok: true,
      missing: [],
      unexpected: [],
      wrongColors: [],
    },
    destinationOptions: {
      checked: false,
      ok: true,
      missing: [],
      unexpected: [],
      wrongColors: [],
    },
  });
  assert.equal(result.gates.canaryWriteReady, true);
  assert.equal(result.writePerformed, false);
});

test('production preflight fails closed before reading without NOTION_API_KEY', async () => {
  let called = false;
  await assert.rejects(
    () =>
      productionPreflightPage({
        pageReference: PAGE_ID,
        fetchImpl: async () => {
          called = true;
          throw new Error('must not fetch');
        },
      }),
    /Missing NOTION_API_KEY/
  );
  assert.equal(called, false);
});

test('production preflight rejects a page outside the allowlisted Locations database and never writes', async () => {
  const calls = [];
  const outsidePage = page();
  outsidePage.parent.data_source_id = OTHER_DATA_SOURCE_ID;
  await assert.rejects(
    () =>
      productionPreflightPage({
        pageReference: PAGE_ID,
        notionApiKey: 'notion-test-key',
        fetchImpl: async (url, options = {}) => {
          calls.push({ method: options.method || 'GET', url: String(url) });
          return jsonResponse(outsidePage);
        },
      }),
    /not formal allowlist/
  );
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['GET']
  );
});

test('validate data-source reader paginates with POST and never writes', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const body = JSON.parse(options.body);
    calls.push({
      url: String(url),
      method: options.method,
      body,
    });
    if (!body.start_cursor) {
      return jsonResponse({
        results: [{ id: 'page-1' }],
        has_more: true,
        next_cursor: 'cursor-2',
      });
    }
    return jsonResponse({
      results: [{ id: 'page-2' }],
      has_more: false,
      next_cursor: null,
    });
  };
  const pages = await queryAllNotionDataSourcePages({
    dataSourceId: FORMAL_DATA_SOURCE_ID,
    notionApiKey: 'notion-test-key',
    fetchImpl,
  });
  assert.deepEqual(
    pages.map(({ id }) => id),
    ['page-1', 'page-2']
  );
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['POST', 'POST']
  );
  assert.equal(calls[0].body.page_size, 100);
  assert.equal(calls[1].body.start_cursor, 'cursor-2');
  assert.equal(calls.some(({ method }) => method === 'PATCH'), false);
});

test('validate all fails closed without NOTION_API_KEY', async () => {
  let called = false;
  await assert.rejects(
    () =>
      validateAllLocations({
        fetchImpl: async () => {
          called = true;
          throw new Error('must not query without a credential');
        },
      }),
    /Missing NOTION_API_KEY/
  );
  assert.equal(called, false);
});

test('validate all queries only the single formal Locations database with NOTION_API_KEY', async () => {
  const calls = [];
  const formalPage = page();
  formalPage.properties.Status = select('Published');
  formalPage.properties['Review Needed'] = {
    type: 'checkbox',
    checkbox: false,
  };
  formalPage.properties['Last Verified'] = {
    type: 'date',
    date: { start: '2026-07-29T10:00:00.000Z' },
  };
  const schemaProperties = Object.fromEntries(
    CURRENT_FORMAL_LOCATION_PROPERTIES.map((name) => [
      name,
      { type: CURRENT_FORMAL_LOCATION_PROPERTY_TYPES[name] },
    ])
  );
  schemaProperties.Status.select = {
    options: CURRENT_FORMAL_STATUS_OPTIONS.map((option) => ({ ...option })),
  };
  schemaProperties.Type.select = {
    options: CURRENT_FORMAL_TYPE_OPTIONS.map((option) => ({ ...option })),
  };
  schemaProperties['Country Code'].select = {
    options: CURRENT_FORMAL_COUNTRY_OPTIONS.map((option) => ({ ...option })),
  };
  schemaProperties['Destination Key'].select = {
    options: CURRENT_FORMAL_DESTINATION_OPTIONS.map((option) => ({
      ...option,
    })),
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method || 'GET',
      authorization: options.headers.Authorization,
    });
    if (!options.method) {
      return jsonResponse({ properties: schemaProperties });
    }
    return jsonResponse({
      results: [formalPage],
      has_more: false,
      next_cursor: null,
    });
  };
  const result = await validateAllLocations({
    notionApiKey: 'notion-test-key',
    fetchImpl,
    snapshotPolicy: {
      policyId: 'test-policy',
      minimumRowCount: 1,
      protectedSlugs: ['han-wang-miao'],
      deletionManifest: [],
    },
    committedSnapshotCsv: buildSnapshotCsv([formalPage]),
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url.includes(FORMAL_DATA_SOURCE_ID), true);
  assert.equal(calls[0].authorization, 'Bearer notion-test-key');
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].url.includes(FORMAL_DATA_SOURCE_ID), true);
  assert.equal(result.mode, 'live');
  assert.equal(result.writePerformed, false);
  assert.equal(result.dataSource, FORMAL_DATA_SOURCE_ID);
  assert.equal(result.rowCount, 1);
  assert.equal(result.schema.propertyCount, 20);
  assert.deepEqual(result.typeCounts, { LingOrm: 1 });
  assert.equal(result.checks.policy.ok, true);
  assert.equal(result.checks.live.ok, true);
  assert.equal(result.checks.snapshot.ok, true);
});

test('validation report exposes all four layers, Type counts, and warnings', () => {
  const report = formatValidationReport({
    ok: true,
    dataSource: FORMAL_DATA_SOURCE_ID,
    rowCount: 2,
    schema: { propertyCount: 20, expectedPropertyCount: 20 },
    checks: {
      schema: { ok: true },
      policy: {
        ok: true,
        minimumRowCount: 1,
        protectedSlugCount: 1,
      },
      live: { ok: true, issueCount: 0, warningCount: 1 },
      snapshot: {
        ok: true,
        liveRowCount: 2,
        committedRowCount: 2,
        changedSlugCount: 0,
        changedFieldCount: 0,
        addedSlugCount: 0,
        removedSlugCount: 0,
      },
    },
    statusCounts: { Published: 1, Paused: 1 },
    typeCounts: { LingOrm: 1, '(blank)': 1 },
    warnings: [{
      layer: 'live',
      code: 'TYPE_MISSING',
      slug: 'paused',
      field: 'Type',
      message: 'Type is blank',
    }],
    issues: [],
  });
  assert.match(report, /Schema: PASS/);
  assert.match(report, /Committed snapshot: PASS/);
  assert.match(report, /Type distribution/);
  assert.match(report, /Warnings: 1/);
  assert.match(report, /\[live:TYPE_MISSING\]/);
});
