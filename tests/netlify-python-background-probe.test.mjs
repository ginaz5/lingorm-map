import assert from 'node:assert/strict';
import test from 'node:test';
import FIXTURE from './fixtures/superrich1965/exchange-rate-00.json' with { type: 'json' };
import { runBackgroundProbe, PROBE_BUDGET_MS } from '../scripts/experiments/netlify-python-background-probe.mjs';
import { createAnonymousApiSource } from '../netlify/functions/_shared/exchange-rates-1965-anonymous.mjs';
import { EXCHANGE_KEYS, createControl } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { bootstrapSourceGuard, setSourceGuardPaused, SOURCE_GUARD_KEY } from '../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { BRANCH_GATE_KEY, branchCacheKey } from '../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { ORANGE_BRANCHES } from '../src/data/exchange-rates-1965-branch.js';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';
import { createHash } from 'node:crypto';
import { authorizeProbe } from '../scripts/experiments/netlify-python-background-endpoints.mjs';

const START = Date.parse('2026-10-23T10:00:00Z');
const KEY = 'probe/job';
const DEPLOY = 'a'.repeat(24);
const token = end => [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ exp: end / 1000 })).toString('base64url'), 'synthetic'].join('.');

async function harness(t, lifetimeMs = 3_600_000) {
  t.mock.method(console, 'info', () => {});
  const store = new FakeBlobStore(), sourceGuardStore = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, controlVersion: uuid(1), updatedBy: 'manual', nowMs: START - 1000 }));
  await bootstrapSourceGuard({ store: sourceGuardStore, legacyBreakers: [null], legacyReviewed: true, nowMs: START - 1000, randomUUIDImpl: () => uuid(2) });
  await setSourceGuardPaused({ store: sourceGuardStore, paused: false, nowMs: START - 1000 });
  const original = sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  original.breaker.blockLevel = 1;
  sourceGuardStore.seed(SOURCE_GUARD_KEY, original);
  store.seed(KEY, { status: 'pending', deployID: DEPLOY, controlVersion: uuid(1), operationId: 'netlify/python-background-test',
    requested: 38, results: [], tokenWaits: [], deadlineAtMs: START + PROBE_BUDGET_MS });
  let now = START, expires = START + lifetimeMs, sequence = 10;
  const h = { store, sourceGuardStore, calls: [], waits: [], blocked: false, advance: ms => { now += ms; }, now: () => now };
  const fetchImpl = async (url, options) => {
    h.calls.push({ method: options.method, at: now });
    if (h.blocked) return new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
    if (options.method === 'GET') {
      if (now >= expires + 2000) expires = now + lifetimeMs;
      return Response.json({ accessToken: token(expires) });
    }
    now += 8000;
    return Response.json(FIXTURE);
  };
  h.input = { store, sourceGuardStore, jobKey: KEY, deployID: DEPLOY,
    source: createAnonymousApiSource({ fetchImpl, nowImpl: () => now }), nowImpl: () => now,
    randomUUIDImpl: () => uuid(sequence++), randomImpl: () => 0,
    sleepImpl: async ms => {
      if (ms <= 1000) {
        assert.equal(store.entries.get(BRANCH_GATE_KEY)?.data.leaseId ?? null, null);
        assert.equal(sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data.leaseId, null);
        assert.equal(sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data.unresolvedAttempt, null);
        h.waits.push(ms);
      }
      now += ms;
    } };
  h.run = () => runBackgroundProbe(h.input);
  return h;
}

test('background probe freshly fetches all 38, publishes zero quotes, and consumes duplicate delivery', async t => {
  const h = await harness(t);
  const result = await h.run();
  assert.equal(result.summary.status, 'complete');
  assert.equal(result.summary.sourceSucceeded, 38);
  assert.equal(result.summary.published, 0);
  assert.equal(result.summary.cacheHit, 0);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.notAttempted, 0);
  assert.equal(result.summary.sourceRequestCount, 39);
  for (const slug of Object.keys(ORANGE_BRANCHES)) assert.equal(h.store.entries.has(branchCacheKey(slug)), false);
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(guard.leaseId, null);
  assert.equal(guard.unresolvedAttempt, null);
  assert.equal(guard.breaker.blockLevel, 1);
  const before = h.calls.length;
  assert.equal((await h.run()).replayed, true);
  assert.equal(h.calls.length, before);
  const stored = JSON.stringify([...h.store.entries]);
  assert.equal(stored.includes('accessToken'), false);
  assert.equal(stored.includes('synthetic'), false);
});

test('background probe waits outside leases and renews after actual expiry across all 38', async t => {
  const h = await harness(t, 340_000);
  const result = await h.run();
  assert.equal(result.summary.status, 'complete');
  assert.equal(result.summary.sourceSucceeded, 38);
  assert.equal(result.summary.tokenGets, 2);
  assert.equal(result.summary.ratePosts, 38);
  assert.equal(result.summary.sourceRequestCount, 40);
  assert.ok(h.waits.length > 0);
  assert.ok(h.calls.filter(row => row.method === 'GET')[1].at >= START + 342_000);
});

test('source challenge stops the full probe and preserves common cooldown', async t => {
  const h = await harness(t);
  h.blocked = true;
  const result = await h.run();
  assert.equal(result.summary.status, 'stopped');
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.notAttempted, 37);
  assert.equal(h.calls.length, 1);
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(guard.breaker.blockLevel, 2);
  assert.ok(Date.parse(guard.breaker.blockedUntil) > h.now());
  assert.equal(guard.leaseId, null);
  assert.equal(guard.unresolvedAttempt, null);
});

test('a paused source makes zero HTTP requests and leaves all branches unattempted', async t => {
  const h = await harness(t);
  await setSourceGuardPaused({ store: h.sourceGuardStore, paused: true, nowMs: h.now() });
  const result = await h.run();
  assert.equal(result.summary.status, 'stopped');
  assert.equal(result.summary.notAttempted, 38);
  assert.equal(result.summary.failed, 0);
  assert.equal(h.calls.length, 0);
});

test('expired pending jobs cannot issue source requests', async t => {
  const h = await harness(t);
  h.advance(PROBE_BUDGET_MS);
  const result = await h.run();
  assert.equal(result.reason, 'invalid_or_expired_job');
  assert.equal(h.calls.length, 0);
});

test('experiment authorization rejects missing credentials, production, wrong site and expired access', () => {
  const capability = '1'.repeat(64);
  const settings = { capabilityDigest: createHash('sha256').update(capability).digest('hex'), expiresAt: new Date(START + 1000).toISOString() };
  const request = new Request('https://probe.invalid', { method: 'POST', headers: { authorization: `Bearer ${capability}` } });
  const context = { site: { id: 'b5ac142c-7e21-4910-90f7-1719a9d90d5d' }, deploy: { context: 'deploy-preview', id: DEPLOY } };
  assert.equal(authorizeProbe(request, context, settings, START), null);
  assert.equal(authorizeProbe(new Request('https://probe.invalid'), context, settings, START), 'unauthorized');
  assert.equal(authorizeProbe(request, { ...context, site: { id: 'wrong' } }, settings, START), 'invalid_probe_deploy');
  assert.equal(authorizeProbe(request, { ...context, deploy: { ...context.deploy, context: 'production' } }, settings, START), 'invalid_probe_deploy');
  assert.equal(authorizeProbe(request, context, settings, START + 1000), 'probe_expired');
});
