import assert from 'node:assert/strict';
import test from 'node:test';
import FIXTURE from './fixtures/superrich1965/exchange-rate-00.json' with { type: 'json' };
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';
import { createControl, EXCHANGE_KEYS } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { bootstrapSourceGuard, setSourceGuardPaused, SOURCE_GUARD_KEY } from '../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { createAnonymousApiSource } from '../netlify/functions/_shared/exchange-rates-1965-anonymous.mjs';
import { branchCacheKey } from '../netlify/functions/_shared/exchange-rates-1965-branch-cache.mjs';
import { ORANGE_BRANCHES, isValidBranchQuote } from '../src/data/exchange-rates-1965-branch.js';
import { SITE_ID, NETLIFY_CONTROL_KEY, dispatchNetlifyRates, runNetlifyRates, scheduledSlot,
  validNetlifyControl, publicNetlifyControl, parseNetlifyWork } from '../netlify/functions/_shared/exchange-rates-1965-netlify.mjs';
import { config as scheduleConfig } from '../netlify/functions/exchange-rates-1965-schedule.mjs';
import { config as workerConfig } from '../netlify/functions/exchange-rates-1965-worker.mjs';
import { parseNetlifyControlArgs } from '../scripts/exchange-rates-1965-netlify-control.mjs';
import { preparePython } from '../scripts/prepare-superrich1965-python.mjs';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const START = Date.parse('2026-10-23T10:00:00Z');
const DEPLOY = 'a'.repeat(24);
const binding = context => ({ schemaVersion: 1, enabled: true, bindingVersion: uuid(3), quoteControlVersion: uuid(1),
  deployID: DEPLOY, commit: 'b'.repeat(40), branch: context === 'production' ? 'main' : 'codex/netlify', context,
  hmacKey: '1'.repeat(64), changedAt: new Date(START).toISOString() });

async function harness(t, context = 'deploy-preview', lifetimeMs = 3_600_000) {
  t.mock.method(console, 'info', () => {});
  const store = new FakeBlobStore(), sourceGuardStore = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, controlVersion: uuid(1), updatedBy: 'manual', nowMs: START - 1000 }));
  const control = binding(context);
  store.seed(NETLIFY_CONTROL_KEY, control);
  await bootstrapSourceGuard({ store: sourceGuardStore, legacyBreakers: [null], legacyReviewed: true, nowMs: START - 1000, randomUUIDImpl: () => uuid(2) });
  await setSourceGuardPaused({ store: sourceGuardStore, paused: false, nowMs: START - 1000 });
  let now = START, expiresAtMs = START + lifetimeMs;
  const h = { store, sourceGuardStore, sourceCalls: [], requests: [], body: null, signature: null, live: true, blocked: false,
    onRate: () => {}, advance: ms => { now += ms; }, now: () => now, control };
  const fetchImpl = async (url, options) => {
    h.requests.push({ url: String(url), method: options.method });
    if (String(url).endsWith('/api/exchange-rates-1965-runtime')) return Response.json({ schemaVersion: 1, siteID: SITE_ID, deployID: h.live ? DEPLOY : 'f'.repeat(24), context });
    h.body = options.body;
    h.signature = new Headers(options.headers).get('x-lingorm-signature');
    return new Response(null, { status: 202 });
  };
  const pythonFetch = async (url, options) => {
    h.sourceCalls.push({ method: options.method, at: now });
    if (h.blocked) return new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
    if (options.method === 'GET') {
      if (now >= expiresAtMs + 2000) expiresAtMs = now + lifetimeMs;
      return Response.json({ accessToken: [Buffer.from('{}').toString('base64url'),
        Buffer.from(JSON.stringify({ exp: expiresAtMs / 1000 })).toString('base64url'), 'synthetic'].join('.') });
    }
    now += 4000;
    h.onRate();
    return Response.json(FIXTURE);
  };
  h.input = { store, sourceGuardStore, identity: { siteID: SITE_ID, deployID: DEPLOY, context }, fetchImpl, nowImpl: () => now,
    trigger: context === 'production' ? 'schedule' : 'manual' };
  h.dispatch = () => dispatchNetlifyRates(h.input);
  h.run = (options = {}) => runNetlifyRates({ ...h.input, body: h.body, signature: h.signature,
    source: createAnonymousApiSource({ fetchImpl: pythonFetch, nowImpl: () => now }),
    randomImpl: () => 0, sleepImpl: async ms => { now += ms; }, ...options });
  return h;
}

test('Netlify cron covers Thailand 08:00–22:30 and worker uses background Node 22', () => {
  assert.equal(scheduleConfig.schedule, '0,30 1-15 * * *');
  assert.equal(workerConfig.background, true);
  assert.equal(workerConfig.nodeVersion, '22');
  for (const [hour, expected] of [[0, false], [1, true], [15, true], [16, false], [23, false]]) {
    assert.equal(scheduledSlot(Date.parse(`2026-10-23T${String(hour).padStart(2, '0')}:30:00Z`)) !== null, expected);
  }
});

for (const context of ['production', 'deploy-preview']) test(`${context} signed dispatch publishes all 38 and duplicate work issues zero HTTP`, async t => {
  const h = await harness(t, context);
  assert.equal((await h.dispatch()).status, 'dispatched');
  assert.equal((await h.dispatch()).reason, 'slot_already_dispatched');
  assert.equal(h.requests.filter(row => row.method === 'POST').length, 1);
  const result = await h.run();
  assert.equal(result.status, 'complete');
  assert.equal(result.summary.published, 38);
  assert.equal(result.summary.sourceRequestCount, 39);
  for (const slug of Object.keys(ORANGE_BRANCHES)) assert.ok(isValidBranchQuote(h.store.entries.get(branchCacheKey(slug))?.data));
  const calls = h.sourceCalls.length;
  assert.equal((await h.run()).reason, 'slot_already_started_or_expired');
  assert.equal(h.sourceCalls.length, calls);
  assert.equal(h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data.unresolvedAttempt, null);
  assert.equal(JSON.stringify(result).includes(h.control.hmacKey), false);
});

for (const mode of ['disabled', 'wrong_deploy', 'wrong_quote_control', 'paused', 'preview_cron', 'stale_target', 'night']) {
  test(`${mode} dispatch stays source-free`, async t => {
    const h = await harness(t);
    if (mode === 'disabled') h.store.seed(NETLIFY_CONTROL_KEY, { ...h.control, enabled: false });
    if (mode === 'wrong_deploy') h.input.identity.deployID = 'e'.repeat(24);
    if (mode === 'wrong_quote_control') h.store.seed(NETLIFY_CONTROL_KEY, { ...h.control, quoteControlVersion: uuid(9) });
    if (mode === 'paused') await setSourceGuardPaused({ store: h.sourceGuardStore, paused: true, nowMs: h.now() });
    if (mode === 'preview_cron') h.input.trigger = 'schedule';
    if (mode === 'stale_target') h.live = false;
    if (mode === 'night') h.advance(12 * 60 * 60_000);
    assert.equal((await h.dispatch()).status, 'skipped');
    assert.equal(h.sourceCalls.length, 0);
    assert.equal(h.requests.filter(row => row.method === 'POST').length, 0);
  });
}

test('invalid signatures and expired requests never start the worker', async t => {
  const h = await harness(t);
  await h.dispatch();
  assert.equal((await h.run({ signature: '0'.repeat(64) })).status, 'skipped');
  assert.equal(h.sourceCalls.length, 0);
  h.advance(1_800_000);
  assert.equal((await h.run()).status, 'skipped');
  assert.equal(h.sourceCalls.length, 0);
});

test('challenge stops immediately and persists the shared source cooldown', async t => {
  const h = await harness(t);
  await h.dispatch();
  h.blocked = true;
  const result = await h.run();
  assert.equal(result.status, 'stopped');
  assert.equal(result.summary.published, 0);
  assert.equal(h.sourceCalls.length, 1);
  assert.ok(Date.parse(h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data.breaker.blockedUntil) > h.now());
});

test('a deployment switch after fetching prevents quote publication', async t => {
  const h = await harness(t);
  await h.dispatch();
  h.onRate = () => { h.live = false; };
  const result = await h.run();
  assert.equal(result.status, 'stopped');
  assert.equal(result.summary.published, 0);
  assert.equal(h.sourceCalls.length, 2);
});

test('Netlify worker crosses token renewal without holding a source lease during the wait', async t => {
  const h = await harness(t, 'production', 150_000);
  await h.dispatch();
  const waits = [];
  const result = await h.run({ sleepImpl: async ms => {
    if (ms <= 1000) {
      assert.equal(h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data.leaseId, null);
      waits.push(ms);
    }
    h.advance(ms);
  } });
  assert.equal(result.summary.published, 38);
  assert.ok(waits.length > 0);
  assert.ok(h.sourceCalls.filter(row => row.method === 'GET').length > 1);
});

test('binding validation and admin output never expose the server HMAC key', () => {
  const control = binding('production');
  assert.equal(validNetlifyControl(control), true);
  assert.equal(Object.hasOwn(publicNetlifyControl(control), 'hmacKey'), false);
  assert.equal(validNetlifyControl({ ...control, hmacKey: 'invalid' }), false);
  assert.equal(parseNetlifyWork('{}', null, control, START), null);
  assert.deepEqual(parseNetlifyControlArgs(['status', '--deploy', DEPLOY]), { command: 'status', deployID: DEPLOY });
  assert.throws(() => parseNetlifyControlArgs(['enable', '--deploy', DEPLOY, '--force']));
});

test('Python packaging rejects a mismatched artifact before extraction', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lingorm-python-digest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(preparePython({ root, fetchImpl: async () => new Response('wrong artifact') }), /python_digest_mismatch/);
  await assert.rejects(access(join(root, 'python/bin/python3.12')), { code: 'ENOENT' });
});
