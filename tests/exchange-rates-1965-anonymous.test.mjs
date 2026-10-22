import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnonymousApiSource, ANONYMOUS_SOURCE_PROFILE } from '../netlify/functions/_shared/exchange-rates-1965-anonymous.mjs';
import { readSourceRequests } from '../netlify/functions/_shared/exchange-rates-1965-source-telemetry.mjs';
import { SOURCE_BASE_URL, SOURCE_USER_AGENT } from '../netlify/functions/_shared/exchange-rates-1965-source.mjs';
import { ORANGE_BRANCHES } from '../src/data/exchange-rates-1965-branch.js';

const TOKEN_URL = 'https://api.superrich1965.com/front/exchange-rate/oauth2/callback';
const RATE_URL = 'https://www.superrich1965.com/api/exchange-rate-service/v1/external-app-exchange-rate/get';
const LEGACY_URL = `${SOURCE_BASE_URL}/get`;
const START = Date.parse('2026-10-19T14:00:00.000Z');
const slugs = Object.keys(ORANGE_BRANCHES);
const body = (slug = slugs[0]) => JSON.stringify({ filters: [
  { field: 'company_code', value: ORANGE_BRANCHES[slug].companyCode },
  { field: 'branch_no', value: ORANGE_BRANCHES[slug].branchNo },
] });
// Synthetic unsigned claims test only local expiry hints; no real credential.
const tokenWithExpiry = seconds => [Buffer.from('{}').toString('base64url'),
  Buffer.from(JSON.stringify({ exp: seconds })).toString('base64url'), 'test'].join('.');
const request = (source, options = {}) => source.fetchImpl(LEGACY_URL, { method: 'POST', body: body(), ...options });
const tokenResponse = (payload = { accessToken: 'test-token', expires_in: 3600 }) => Response.json(payload);

test('anonymous session is lazy and has a bounded sequential source profile', async () => {
  let calls = 0;
  const source = createAnonymousApiSource({ fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
  assert.deepEqual(ANONYMOUS_SOURCE_PROFILE, { name: 'anonymous-api', concurrency: 1,
    minStartGapMs: 0, requestTimeoutMs: 12000, deadlineMs: 15000 });
  await source.close();
  assert.equal(calls, 0);
});

test('fixed callback and rate requests use only approved headers, body and shared abort signal', async () => {
  const calls = [];
  const controller = new AbortController();
  const source = createAnonymousApiSource({ nowImpl: () => START, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url === TOKEN_URL ? tokenResponse() : Response.json({ data: { datas: [] } });
  } });
  const response = await request(source, { signal: controller.signal,
    headers: { Authorization: 'Bearer caller-secret', Cookie: 'caller-cookie', 'X-Extra': 'arbitrary' } });
  assert.deepEqual(calls.map(call => call.url), [TOKEN_URL, RATE_URL]);
  assert.deepEqual(calls.map(call => call.options.method), ['GET', 'POST']);
  assert.equal(calls[1].options.body, body());
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json', 'User-Agent': SOURCE_USER_AGENT });
  assert.deepEqual(calls[1].options.headers, { Accept: 'application/json', 'Content-Type': 'application/json',
    'User-Agent': SOURCE_USER_AGENT, Authorization: 'Bearer test-token', Referer: 'https://www.superrich1965.com/' });
  for (const call of calls) {
    assert.equal(call.options.signal, controller.signal);
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.cache, 'no-store');
  }
  assert.deepEqual(readSourceRequests(response).map(entry => [entry.stage, entry.status]), [['token', 200], ['rate', 200]]);
  assert.equal(JSON.stringify(readSourceRequests(response)).includes('test-token'), false);
  assert.equal((await response.text()).includes('test-token'), false);
  assert.equal([...response.headers].some(([key, value]) => /authorization|test-token/i.test(`${key}${value}`)), false);
  await source.close();
});

test('known-lifetime token is reused only within the same invocation session', async () => {
  let tokenCalls = 0;
  let rateCalls = 0;
  const source = createAnonymousApiSource({ nowImpl: () => START, fetchImpl: async url => {
    if (url === TOKEN_URL) { tokenCalls++; return tokenResponse(); }
    rateCalls++;
    return Response.json({ ok: true });
  } });
  const first = await request(source);
  const second = await request(source, { body: body(slugs[1]) });
  assert.equal(tokenCalls, 1);
  assert.equal(rateCalls, 2);
  assert.equal(readSourceRequests(first).length, 2);
  assert.deepEqual(readSourceRequests(second).map(entry => entry.stage), ['rate']);
  await source.close();
});

test('unknown lifetime is never reused across quotes', async () => {
  const calls = [];
  const source = createAnonymousApiSource({ nowImpl: () => START, fetchImpl: async url => {
    calls.push(url);
    return url === TOKEN_URL ? tokenResponse({ accessToken: 'opaque-test-token' }) : Response.json({ ok: true });
  } });
  await request(source);
  await request(source);
  assert.deepEqual(calls, [TOKEN_URL, RATE_URL, TOKEN_URL, RATE_URL]);
  await source.close();
});

test('earliest JWT exp or expires_in controls reuse with a 30 second safety margin', async () => {
  for (const shorterHint of ['jwt', 'expires_in']) {
    let now = START;
    let tokenCalls = 0;
    const source = createAnonymousApiSource({ nowImpl: () => now, fetchImpl: async url => {
      if (url !== TOKEN_URL) return Response.json({ ok: true });
      tokenCalls++;
      return tokenResponse({ accessToken: tokenWithExpiry(now / 1000 + (shorterHint === 'jwt' ? 90 : 3600)),
        expires_in: shorterHint === 'expires_in' ? 90 : 3600 });
    } });
    await request(source);
    now += 59_000;
    await request(source);
    assert.equal(tokenCalls, 1, shorterHint);
    now += 1_000;
    await request(source);
    assert.equal(tokenCalls, 2, shorterHint);
    await source.close();
  }
});

test('fresh expired or near-expiry tokens never authorize a rate request', async () => {
  for (const remainingSeconds of [-1, 0, 30]) {
    const calls = [];
    const source = createAnonymousApiSource({ nowImpl: () => START, fetchImpl: async url => {
      calls.push(url);
      return tokenResponse({ accessToken: tokenWithExpiry(START / 1000 + remainingSeconds), expires_in: 3600 });
    } });
    await assert.rejects(request(source), error => {
      assert.equal(error.message, 'anonymous_source_failed');
      assert.equal(readSourceRequests(error)[0].reason, remainingSeconds <= 0 ? 'expired_token' : 'near_expiry_token');
      return true;
    });
    assert.deepEqual(calls, [TOKEN_URL]);
    await source.close();
  }
});

test('callback returning the same near-expiry JWT stops renewal without retrying or posting a rate', async () => {
  let now = START;
  const value = tokenWithExpiry((START + 370_000) / 1000);
  const calls = [];
  const source = createAnonymousApiSource({ nowImpl: () => now, fetchImpl: async url => {
    calls.push(url);
    return url === TOKEN_URL ? tokenResponse({ accessToken: value }) : Response.json({ ok: true });
  } });
  await request(source);
  now += 342_000; // The original JWT is still valid but has only 28 seconds left.
  await assert.rejects(request(source), error => {
    assert.deepEqual(readSourceRequests(error).map(entry => [entry.stage, entry.status, entry.reason]),
      [['token', 200, 'near_expiry_token']]);
    assert.equal(readSourceRequests(error)[0].tokenRemainingSeconds, 28);
    assert.equal(readSourceRequests(error)[0].tokenReissued, 1);
    assert.equal(JSON.stringify(readSourceRequests(error)).includes(value), false);
    return true;
  });
  await assert.rejects(request(source));
  assert.deepEqual(calls, [TOKEN_URL, RATE_URL, TOKEN_URL]);
  await source.close();
});

test('callback HTTP blocks are returned to the collector and stop the session without POST or fallback', async () => {
  for (const [status, challenge] of [[403, false], [429, false], [200, true], [401, false], [500, false]]) {
    let calls = 0;
    const source = createAnonymousApiSource({ fetchImpl: async url => {
      calls++;
      assert.equal(url, TOKEN_URL);
      return new Response('upstream body', { status, headers: challenge ? { 'cf-mitigated': 'challenge' } : {} });
    } });
    const response = await request(source);
    assert.equal(response.status, status);
    assert.deepEqual(readSourceRequests(response).map(entry => entry.stage), ['token']);
    await assert.rejects(request(source), error => {
      assert.deepEqual(readSourceRequests(error), []);
      return true;
    });
    assert.equal(calls, 1);
    await source.close();
  }
});

test('malformed callback JSON or token never reaches the rate endpoint or exposes payload text', async () => {
  const responses = [
    [() => new Response('invalid callback body with private-content'), 'invalid_token_json'],
    [() => Response.json({}), 'invalid_token_value'],
    [() => Response.json({ accessToken: 123 }), 'invalid_token_value'],
    [() => Response.json({ accessToken: 'test-token\ninvalid' }), 'invalid_token_value'],
    [() => new Response(' '.repeat(65_536) + JSON.stringify({ accessToken: 'test-token' })), 'invalid_token_json'],
  ];
  for (const [respond, reason] of responses) {
    let calls = 0;
    const source = createAnonymousApiSource({ fetchImpl: async () => { calls++; return respond(); } });
    await assert.rejects(request(source), error => {
      assert.equal(error.message, 'anonymous_source_failed');
      assert.equal(readSourceRequests(error)[0].reason, reason);
      assert.equal(JSON.stringify(readSourceRequests(error)).includes('private-content'), false);
      return true;
    });
    await assert.rejects(request(source));
    assert.equal(calls, 1);
    await source.close();
  }
});

test('callback network errors retain a single actual request and discard arbitrary exception data', async () => {
  let calls = 0;
  const source = createAnonymousApiSource({ fetchImpl: async () => { calls++; throw new Error('private-content test-token'); } });
  await assert.rejects(request(source), error => {
    assert.equal(error.message, 'anonymous_source_failed');
    assert.deepEqual(readSourceRequests(error).map(entry => [entry.stage, entry.status, entry.reason]), [['token', null, 'http_error']]);
    assert.equal(JSON.stringify(readSourceRequests(error)).includes('private-content'), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  await assert.rejects(request(source));
  assert.equal(calls, 1);
  await source.close();
});

test('abort during token body parsing is rechecked before any POST', async () => {
  const controller = new AbortController();
  const calls = [];
  const source = createAnonymousApiSource({ fetchImpl: async url => {
    calls.push(url);
    const response = tokenResponse();
    response.text = async () => { controller.abort(); return JSON.stringify({ accessToken: 'test-token', expires_in: 3600 }); };
    return response;
  } });
  await assert.rejects(request(source, { signal: controller.signal }), error => {
    assert.equal(readSourceRequests(error)[0].reason, 'timeout');
    return true;
  });
  assert.deepEqual(calls, [TOKEN_URL]);
  await source.close();
});

test('pre-aborted request and closed session have zero source observations', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const source = createAnonymousApiSource({ fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
  await assert.rejects(request(source, { signal: controller.signal }), error => {
    assert.deepEqual(readSourceRequests(error), []);
    return true;
  });
  await source.close();
  await assert.rejects(request(source), error => {
    assert.deepEqual(readSourceRequests(error), []);
    return true;
  });
  assert.equal(calls, 0);
});

test('rate 403, 429, challenge, 401 and 500 stop the session without refresh or retry', async () => {
  for (const [status, challenge] of [[403, false], [429, false], [200, true], [401, false], [500, false]]) {
    const calls = [];
    const source = createAnonymousApiSource({ nowImpl: () => START, fetchImpl: async url => {
      calls.push(url);
      return url === TOKEN_URL ? tokenResponse() : new Response(null, { status,
        headers: challenge ? { 'cf-mitigated': 'challenge' } : {} });
    } });
    const response = await request(source);
    assert.equal(response.status, status);
    assert.equal(readSourceRequests(response).length, 2);
    await assert.rejects(request(source), error => {
      assert.deepEqual(readSourceRequests(error), []);
      return true;
    });
    assert.deepEqual(calls, [TOKEN_URL, RATE_URL]);
    await source.close();
  }
});

test('rate network failures count both actual requests and stop the session', async () => {
  const calls = [];
  const source = createAnonymousApiSource({ nowImpl: () => START, fetchImpl: async url => {
    calls.push(url);
    if (url === TOKEN_URL) return tokenResponse();
    throw new Error('private-rate-failure');
  } });
  await assert.rejects(request(source), error => {
    assert.deepEqual(readSourceRequests(error).map(entry => [entry.stage, entry.status, entry.reason]),
      [['token', 200, null], ['rate', null, 'http_error']]);
    assert.equal(error.message, 'anonymous_source_failed');
    return true;
  });
  await assert.rejects(request(source));
  assert.deepEqual(calls, [TOKEN_URL, RATE_URL]);
  await source.close();
});

test('invalid URLs, methods and extra payload/filter fields never make a source request', async () => {
  let calls = 0;
  const source = createAnonymousApiSource({ fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
  const payload = JSON.parse(body());
  const invalid = [
    [RATE_URL, { method: 'POST', body: body() }],
    [TOKEN_URL, { method: 'POST', body: body() }],
    [LEGACY_URL, { method: 'GET', body: body() }],
    [LEGACY_URL, { method: 'POST', body: '{invalid' }],
    [LEGACY_URL, { method: 'POST', body: JSON.stringify({ ...payload, extra: 'no' }) }],
    [LEGACY_URL, { method: 'POST', body: JSON.stringify({ filters: [...payload.filters, { field: 'extra', value: 'no' }] }) }],
    [LEGACY_URL, { method: 'POST', body: JSON.stringify({ filters: [{ ...payload.filters[0], extra: 'no' }, payload.filters[1]] }) }],
    [LEGACY_URL, { method: 'POST', body: JSON.stringify({ filters: [{ field: 'company_code', value: 'A01' }, payload.filters[1]] }) }],
    [LEGACY_URL, { method: 'POST', body: JSON.stringify({ filters: [payload.filters[0], { field: 'branch_no', value: '999' }] }) }],
    [LEGACY_URL, { method: 'POST', body: JSON.stringify({ filters: [payload.filters[0], { field: 'branch_no', value: Number(payload.filters[1].value) }] }) }],
    [LEGACY_URL, { method: 'POST', body: new Uint8Array() }],
  ];
  for (const [url, options] of invalid) await assert.rejects(source.fetchImpl(url, options), error => {
    assert.deepEqual(readSourceRequests(error), []);
    return true;
  });
  assert.equal(calls, 0);
  await source.close();
});

test('diagnostics retain only bounded headers and never response bodies', async () => {
  const source = createAnonymousApiSource({ fetchImpl: async () => new Response('private-source-body', { status: 403,
    headers: { 'cf-mitigated': 'challenge', 'cf-ray': 'x'.repeat(200), 'retry-after': '60', 'x-secret': 'do-not-record' } }) });
  const response = await request(source);
  const [entry] = readSourceRequests(response);
  assert.deepEqual(Object.keys(entry).sort(), ['stage', 'status', 'cfMitigated', 'contentType', 'retryAfter', 'rayId', 'reason'].sort());
  assert.equal(entry.rayId.length, 100);
  assert.equal(entry.retryAfter, '60');
  assert.equal(JSON.stringify(entry).includes('private-source-body'), false);
  assert.equal(JSON.stringify(entry).includes('do-not-record'), false);
  await source.close();
});

test('closing while token JSON resolves prevents a POST and clears session reuse', async () => {
  const calls = [];
  let source;
  source = createAnonymousApiSource({ fetchImpl: async url => {
    calls.push(url);
    const response = tokenResponse();
    response.text = async () => { await source.close(); return JSON.stringify({ accessToken: 'test-token', expires_in: 3600 }); };
    return response;
  } });
  await assert.rejects(request(source));
  await assert.rejects(request(source), error => {
    assert.deepEqual(readSourceRequests(error), []);
    return true;
  });
  assert.deepEqual(calls, [TOKEN_URL]);
});
