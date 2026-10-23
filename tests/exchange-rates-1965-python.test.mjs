import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPythonSafariFetch, PYTHON_REQUEST_TIMEOUT_MS } from '../scripts/exchange-rates-1965-python.mjs';
import { ORANGE_BRANCHES } from '../src/data/exchange-rates-1965-branch.js';

const TOKEN_URL = 'https://api.superrich1965.com/front/exchange-rate/oauth2/callback';
const RATE_URL = 'https://www.superrich1965.com/api/exchange-rate-service/v1/external-app-exchange-rate/get';
const HELPER = fileURLToPath(new URL('../scripts/exchange-rates-1965-python-http.py', import.meta.url));
const BODY = JSON.stringify({ filters: [
  { field: 'company_code', value: 'A04' }, { field: 'branch_no', value: '36' },
] });
const PRIVATE = 'synthetic-private-content';

function fakeSpawner() {
  const calls = [];
  const children = [];
  const spawnImpl = (...args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.input = '';
    child.kills = [];
    child.stdin.on('data', chunk => { child.input += chunk.toString(); });
    child.kill = signal => { child.kills.push(signal); return true; };
    child.event = value => child.stdout.write(`${JSON.stringify(value)}\n`);
    child.close = (code = 0) => {
      child.stdout.end();
      child.stderr.end();
      child.emit('close', code);
    };
    calls.push(args);
    children.push(child);
    return child;
  };
  return { spawnImpl, calls, children };
}

function tokenRequest(fetchImpl, options = {}) {
  return fetchImpl(TOKEN_URL, { method: 'GET', ...options });
}

function rateRequest(fetchImpl, options = {}) {
  return fetchImpl(RATE_URL, { method: 'POST', body: BODY,
    headers: { Authorization: `Bearer ${PRIVATE}`, Cookie: 'ignored-cookie', 'X-Extra': 'ignored-header' }, ...options });
}

function headers(child, status = 200, extra = {}) {
  child.event({ event: 'headers', status, headers: { 'content-type': 'application/json', ...extra } });
}

function success(child, body = '{"ok":true}') {
  headers(child);
  child.event({ event: 'body', body });
  child.close();
}

function fixedError(error, message = 'python_source_failed') {
  assert.equal(error.message, message);
  assert.equal(String(error).includes(PRIVATE), false);
  assert.equal(error.cause, undefined);
  return true;
}

test('import and factory construction start neither Python nor network requests', async () => {
  const script = `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    childProcess.spawn = () => { throw new Error('unexpected_python_spawn'); };
    syncBuiltinESMExports();
    globalThis.fetch = () => { throw new Error('unexpected_network_request'); };
    const { createPythonSafariFetch } = await import(${JSON.stringify(new URL('../scripts/exchange-rates-1965-python.mjs', import.meta.url).href)});
    if (typeof createPythonSafariFetch() !== 'function') process.exitCode = 1;
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const fake = fakeSpawner();
  assert.equal(typeof createPythonSafariFetch({ spawnImpl: fake.spawnImpl }), 'function');
  assert.equal(fake.calls.length, 0);
});

test('successful token protocol uses a fixed isolated command, minimal environment and no forwarded caller headers', async () => {
  const fake = fakeSpawner();
  const fetchImpl = createPythonSafariFetch({ spawnImpl: fake.spawnImpl });
  const pending = tokenRequest(fetchImpl, { headers: { Authorization: `Bearer ${PRIVATE}`, Cookie: 'ignored-cookie' } });
  assert.equal(fake.calls.length, 1);
  const [command, args, options] = fake.calls[0];
  assert.equal(command, 'python3');
  assert.deepEqual(args, ['-I', '-B', HELPER]);
  assert.equal(options.shell, false);
  assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.deepEqual(Object.keys(options.env).sort(), ['LANG', 'PATH']);
  assert.equal(options.env.PATH, process.env.PATH);
  assert.equal(options.env.LANG, 'C.UTF-8');
  assert.equal(JSON.stringify(fake.calls[0]).includes(PRIVATE), false);
  assert.deepEqual(JSON.parse(fake.children[0].input), { stage: 'token' });
  const payload = '{"accessToken":"synthetic-token","expires_in":3600}';
  success(fake.children[0], payload);
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(await response.text(), payload);
  assert.deepEqual(fake.children[0].kills, []);
});

test('rate protocol carries only a reviewed branch body and token through stdin', async () => {
  const fake = fakeSpawner();
  const fetchImpl = createPythonSafariFetch({ spawnImpl: fake.spawnImpl });
  const pending = rateRequest(fetchImpl);
  const child = fake.children[0];
  assert.deepEqual(JSON.parse(child.input), { stage: 'rate', token: PRIVATE, body: BODY });
  assert.equal(JSON.stringify(fake.calls[0]).includes(PRIVATE), false);
  assert.equal(child.input.includes('ignored-cookie'), false);
  assert.equal(child.input.includes('ignored-header'), false);
  success(child, '{"data":{"datas":[]}}');
  assert.deepEqual(await (await pending).json(), { data: { datas: [] } });
});

test('every checked-in branch mapping passes through stdin without caller URL/header forwarding', async () => {
  const fake = fakeSpawner();
  const fetchImpl = createPythonSafariFetch({ spawnImpl: fake.spawnImpl });
  assert.equal(Object.keys(ORANGE_BRANCHES).length, 38);
  for (const branch of Object.values(ORANGE_BRANCHES)) {
    const body = JSON.stringify({ filters: [
      { field: 'company_code', value: branch.companyCode }, { field: 'branch_no', value: branch.branchNo },
    ] });
    const pending = rateRequest(fetchImpl, { body });
    const child = fake.children.at(-1);
    assert.deepEqual(JSON.parse(child.input), { stage: 'rate', token: PRIVATE, body });
    success(child);
    assert.equal((await pending).status, 200);
  }
  assert.equal(fake.calls.length, 38);
  assert.equal(fake.calls.some(call => JSON.stringify(call).includes(PRIVATE)), false);
});

test('unreviewed URL, method, branch, payload and token are rejected before a child starts', async () => {
  const fake = fakeSpawner();
  const fetchImpl = createPythonSafariFetch({ spawnImpl: fake.spawnImpl });
  const validOptions = { method: 'POST', body: BODY, headers: { Authorization: `Bearer ${PRIVATE}` } };
  const requests = [
    [TOKEN_URL + '?extra=true', { method: 'GET' }],
    [TOKEN_URL, { method: 'POST' }],
    [TOKEN_URL, { method: 'GET', body: 'unexpected' }],
    [RATE_URL.replace('www.', 'other.'), validOptions],
    [RATE_URL, { ...validOptions, method: 'GET' }],
    [RATE_URL, { ...validOptions, body: BODY.replace('"36"', '"99"') }],
    [RATE_URL, { ...validOptions, body: BODY.replace('"A04"', '"A05"') }],
    [RATE_URL, { ...validOptions, body: JSON.stringify({ filters: JSON.parse(BODY).filters, extra: true }) }],
    [RATE_URL, { ...validOptions, body: '{' }],
    [RATE_URL, { ...validOptions, body: ' '.repeat(4097) }],
    [RATE_URL, { ...validOptions, headers: {} }],
    [RATE_URL, { ...validOptions, headers: { Authorization: `Basic ${PRIVATE}` } }],
    [RATE_URL, { ...validOptions, headers: { Authorization: `Bearer ${'x'.repeat(16385)}` } }],
  ];
  for (const [url, options] of requests) {
    await assert.rejects(fetchImpl(url, options), error => fixedError(error, 'invalid_python_request'));
  }
  assert.equal(fake.calls.length, 0);
});

test('invalid header syntax is normalized without exposing the rejected credential', async () => {
  const fake = fakeSpawner();
  const fetchImpl = createPythonSafariFetch({ spawnImpl: fake.spawnImpl });
  await assert.rejects(rateRequest(fetchImpl, { headers: { Authorization: `Bearer ${PRIVATE}\ninvalid` } }),
    error => fixedError(error, 'invalid_python_request'));
  assert.equal(fake.calls.length, 0);
});

test('pre-aborted request starts no child', async () => {
  const controller = new AbortController();
  controller.abort();
  const fake = fakeSpawner();
  const fetchImpl = createPythonSafariFetch({ spawnImpl: fake.spawnImpl });
  await assert.rejects(tokenRequest(fetchImpl, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fake.calls.length, 0);
});

test('abort kills the active process and waits for close before rejecting', async () => {
  const controller = new AbortController();
  const fake = fakeSpawner();
  const fetchImpl = createPythonSafariFetch({ spawnImpl: fake.spawnImpl });
  const pending = tokenRequest(fetchImpl, { signal: controller.signal });
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  controller.abort();
  assert.deepEqual(fake.children[0].kills, ['SIGKILL']);
  await Promise.resolve();
  assert.equal(settled, false);
  fake.children[0].close(null);
  await assert.rejects(pending, fixedError);
});

test('abort after 403 headers preserves the known challenge and still waits for child close', async () => {
  const controller = new AbortController();
  const fake = fakeSpawner();
  const fetchImpl = createPythonSafariFetch({ spawnImpl: fake.spawnImpl });
  const pending = tokenRequest(fetchImpl, { signal: controller.signal });
  const child = fake.children[0];
  headers(child, 403, { 'content-type': 'text/html', 'cf-mitigated': 'challenge', 'cf-ray': 'synthetic-SEA' });
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  controller.abort();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(child.kills, ['SIGKILL']);
  child.close(null);
  const response = await pending;
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('cf-mitigated'), 'challenge');
  assert.equal(response.headers.get('cf-ray'), 'synthetic-SEA');
  await assert.rejects(response.text(), fixedError);
});

test('child launch and runtime errors expose only fixed error text', async () => {
  const failingFetch = createPythonSafariFetch({ spawnImpl: () => { throw new Error(PRIVATE); } });
  await assert.rejects(tokenRequest(failingFetch), fixedError);
  const fake = fakeSpawner();
  const fetchImpl = createPythonSafariFetch({ spawnImpl: fake.spawnImpl });
  const pending = tokenRequest(fetchImpl);
  const child = fake.children[0];
  child.stderr.write(`Traceback: ${PRIVATE}`);
  child.emit('error', new Error(PRIVATE));
  child.close(1);
  await assert.rejects(pending, fixedError);
});

test('malformed protocol and foreign response headers stop the child without leaking output', async () => {
  for (const output of [
    `invalid-json-${PRIVATE}\n`,
    `${JSON.stringify({ event: 'headers', status: 200, headers: { 'set-cookie': PRIVATE } })}\n`,
    `${JSON.stringify({ event: 'headers', status: 199, headers: {} })}\n`,
    `${JSON.stringify({ event: 'headers', status: 200, headers: { 'cf-ray': `${PRIVATE}\ninvalid` } })}\n`,
    `${JSON.stringify({ event: 'body', body: PRIVATE })}\n`,
  ]) {
    const fake = fakeSpawner();
    const fetchImpl = createPythonSafariFetch({ spawnImpl: fake.spawnImpl });
    const pending = tokenRequest(fetchImpl);
    fake.children[0].stdout.write(output);
    assert.deepEqual(fake.children[0].kills, ['SIGKILL']);
    fake.children[0].close(1);
    await assert.rejects(pending, fixedError);
  }
});

test('stdout and token-body limits stop the child and retain only validated HTTP metadata', async () => {
  const fake = fakeSpawner();
  const fetchImpl = createPythonSafariFetch({ spawnImpl: fake.spawnImpl });
  const outputPending = tokenRequest(fetchImpl);
  fake.children[0].stdout.write('x'.repeat(7 * 1024 * 1024 + 1));
  assert.deepEqual(fake.children[0].kills, ['SIGKILL']);
  fake.children[0].close(1);
  await assert.rejects(outputPending, fixedError);
  const bodyPending = tokenRequest(fetchImpl);
  const child = fake.children[1];
  headers(child);
  child.event({ event: 'body', body: PRIVATE + 'x'.repeat(65_536) });
  assert.deepEqual(child.kills, ['SIGKILL']);
  child.close(1);
  const response = await bodyPending;
  assert.equal(response.status, 200);
  await assert.rejects(response.text(), fixedError);
  const ratePending = rateRequest(fetchImpl);
  const rateChild = fake.children[2];
  headers(rateChild);
  // The limit is bytes, including for non-ASCII upstream JSON.
  rateChild.event({ event: 'body', body: '฿'.repeat(Math.floor(1024 * 1024 / 3) + 1) });
  assert.deepEqual(rateChild.kills, ['SIGKILL']);
  rateChild.close(1);
  const rateResponse = await ratePending;
  assert.equal(rateResponse.status, 200);
  await assert.rejects(rateResponse.text(), fixedError);
});

test('truncated body protocol cannot become a successful response body', async () => {
  const fake = fakeSpawner();
  const fetchImpl = createPythonSafariFetch({ spawnImpl: fake.spawnImpl });
  const pending = rateRequest(fetchImpl);
  const child = fake.children[0];
  headers(child);
  child.stdout.write(JSON.stringify({ event: 'body', body: '{"ok":true}' }));
  child.close();
  const response = await pending;
  assert.equal(response.status, 200);
  await assert.rejects(response.text(), fixedError);
});

test('a call gets 25 seconds, then the child is killed and a distinct fixed timeout error is raised', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { spawnImpl, children } = fakeSpawner();
  const fetchImpl = createPythonSafariFetch({ spawnImpl });
  assert.equal(PYTHON_REQUEST_TIMEOUT_MS, 25_000);
  const pending = tokenRequest(fetchImpl);
  const outcome = assert.rejects(pending, error => fixedError(error, 'python_source_timeout'));
  t.mock.timers.tick(PYTHON_REQUEST_TIMEOUT_MS - 1);
  assert.deepEqual(children[0].kills, []);
  t.mock.timers.tick(1);
  assert.deepEqual(children[0].kills, ['SIGKILL']);
  children[0].close(1);
  await outcome;
});
