import assert from 'node:assert/strict';
import test from 'node:test';
import FIXTURE from './fixtures/superrich1965/exchange-rate-00.json' with { type: 'json' };
import { parseActionsArgs, renderActionsSummary, runActionsCommand } from '../scripts/exchange-rates-1965-actions.mjs';
import { PROJECT_SITE_ID } from '../netlify/functions/_shared/exchange-rates-1965-actions-target.mjs';
import { SOURCE_GUARD_KEY, bootstrapSourceGuard, setSourceGuardPaused } from '../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { EXCHANGE_KEYS, createControl } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { branchCacheKey, queryBranchRates } from '../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { ORANGE_BRANCHES } from '../src/data/exchange-rates-1965-branch.js';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-20T01:00:00Z');
const SLUG = 'superrich1965-58';
const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'ginaz5/lingorm-map', GITHUB_RUN_ID: '1234',
  GITHUB_SHA: 'a'.repeat(40), GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch' };

async function harness(t) {
  t.mock.method(console, 'info', () => {});
  const store = new FakeBlobStore(), sourceGuardStore = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, controlVersion: uuid(1), nowMs: START - 1000, updatedBy: 'manual' }));
  await bootstrapSourceGuard({ store: sourceGuardStore, legacyBreakers: [null], legacyReviewed: true,
    nowMs: START - 1000, randomUUIDImpl: () => uuid(2) });
  await setSourceGuardPaused({ store: sourceGuardStore, paused: false, nowMs: START - 1000 });
  const target = { alias: 'preview-reviewed', siteID: PROJECT_SITE_ID, kind: 'preview', deployID: '1'.repeat(24),
    branch: 'codex/test', commit: 'b'.repeat(40), context: 'deploy-preview' };
  let now = START, sequence = 10;
  const calls = [];
  const h = { store, sourceGuardStore, target, calls, advance: ms => { now += ms; },
    rateResponse: () => Response.json(FIXTURE), tokenResponse: () => Response.json({ accessToken: 'PRIVATE_SOURCE_TOKEN', expires_in: 3600 }),
    input: { env: { ...env }, nowImpl: () => now, randomUUIDImpl: () => uuid(sequence++), randomImpl: () => 0,
      sleepImpl: async ms => { now += ms; },
      openTargetImpl: async () => ({ target, store, sourceGuardStore, metadata: { id: target.deployID, state: 'ready' } }),
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options, at: now });
        return String(url).includes('oauth2/callback') ? h.tokenResponse() : h.rateResponse();
      },
    },
  };
  h.run = (command = 'probe', extra = []) => runActionsCommand([command, '--target', 'preview-reviewed', ...extra], h.input);
  return h;
}

for (const args of [[], ['probe'], ['publish','--target','preview-reviewed'],
  ['probe','--target','preview-reviewed','--slug','superrich1965-56'],
  ['probe','--target','preview-reviewed','--scope','all'], ['inspect','--target','preview-reviewed','--force','true'],
  ['probe','--target','preview-reviewed','--target','production']]) {
  test(`Actions arguments fail closed: ${args.join(' ') || '(empty)'}`, () => assert.throws(() => parseActionsArgs(args)));
}

test('an unconfigured target cannot accidentally contact any network', async t => {
  let calls = 0;
  const result = await runActionsCommand(['probe','--target','preview-reviewed'], { env,
    targetsInput: { schemaVersion: 1, siteID: PROJECT_SITE_ID, targets: {} },
    fetchImpl: async () => { calls++; throw new Error('PRIVATE_CREDENTIAL'); } });
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.reason, 'target_not_configured');
  assert.equal(calls, 0);
});

test('probe validates token and rate but never publishes a quote or clears escalation', async t => {
  const h = await harness(t);
  const result = await h.run();
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.sourceValidated, true);
  assert.equal(result.summary.sourceRequestCount, 2);
  assert.equal(result.summary.sourceSucceeded, 1);
  assert.equal(result.summary.published, 0);
  assert.equal(h.calls.length, 2);
  assert.equal(h.store.entries.has(branchCacheKey(SLUG)), false);
  assert.equal(h.store.entries.has(EXCHANGE_KEYS.snapshot), false);
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(guard.unresolvedAttempt, null);
  assert.equal(guard.leaseId, null);
  assert.equal(JSON.stringify([...h.sourceGuardStore.entries]).includes('PRIVATE_SOURCE_TOKEN'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SOURCE_TOKEN'), false);
});

test('inspect is read-only and does not require a GitHub run', async t => {
  const h = await harness(t);
  const saved = structuredClone([...h.store.entries]), guarded = structuredClone([...h.sourceGuardStore.entries]);
  h.input.env = {};
  const result = await h.run('inspect');
  assert.equal(result.exitCode, 0);
  assert.equal(h.calls.length, 0);
  assert.deepEqual([...h.store.entries], saved);
  assert.deepEqual([...h.sourceGuardStore.entries], guarded);
});

test('untrusted ref cannot access target metadata or source credentials', async t => {
  const h = await harness(t);
  h.input.env.GITHUB_REF = 'refs/heads/untrusted';
  let opened = 0;
  h.input.openTargetImpl = async () => { opened++; throw new Error('PRIVATE'); };
  const result = await h.run();
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.reason, 'invalid_actions_identity');
  assert.equal(opened, 0);
  assert.equal(h.calls.length, 0);
});

test('publish writes a valid quote; later cache hit and operation replay make zero new source requests', async t => {
  const h = await harness(t);
  const first = await h.run('publish', ['--scope','single']);
  assert.equal(first.exitCode, 0);
  assert.equal(first.summary.published, 1);
  assert.equal(h.store.entries.get(branchCacheKey(SLUG)).data.controlVersion, uuid(1));
  h.advance(2000);
  const replay = await h.run('publish', ['--scope','single']);
  assert.equal(replay.summary.replayed, true);
  assert.equal(replay.summary.sourceRequestCount, 0);
  assert.equal(replay.summary.sourceValidated, false);
  h.input.env.GITHUB_RUN_ID = '1235';
  const cached = await h.run('publish', ['--scope','single']);
  assert.equal(cached.summary.cacheHit, 1);
  assert.equal(cached.summary.sourceRequestCount, 0);
  assert.equal(h.calls.length, 2);
});

test('a token challenge is recorded globally before a simultaneous target disable', async t => {
  const h = await harness(t);
  h.tokenResponse = () => {
    h.store.seed(EXCHANGE_KEYS.control, createControl({ enabled: false, controlVersion: uuid(3), nowMs: START, updatedBy: 'manual', disabledReason: 'manual' }));
    return new Response('PRIVATE_CHALLENGE', { status: 403, headers: { 'cf-mitigated':'challenge' } });
  };
  const result = await h.run();
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.sourceRequestCount, 1);
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(guard.breaker.blockLevel, 1);
  assert.equal(Date.parse(guard.breaker.blockedUntil), START + 6 * 60 * 60_000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.store.entries.has(branchCacheKey(SLUG)), false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test('guard outcome write failure survives lease expiry and a new deployment without another request', async t => {
  const h = await harness(t);
  h.tokenResponse = () => {
    h.sourceGuardStore.beforeSet = () => { throw new Error('PRIVATE_WRITE_FAILURE'); };
    return new Response('blocked', { status:403 });
  };
  const first = await h.run();
  assert.equal(first.exitCode, 1);
  assert.equal(first.summary.sourceRequestCount, 1);
  h.sourceGuardStore.beforeSet = null;
  h.advance(60_000);
  h.target.deployID = '2'.repeat(24);
  h.input.env.GITHUB_RUN_ID = '1235';
  const second = await h.run();
  assert.equal(second.exitCode, 3);
  assert.equal(second.summary.reason, 'unknown_outcome');
  assert.equal(h.calls.length, 1);
  assert.ok(h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data.unresolvedAttempt);
});

test('full mapping publishes independently with one token and paced HTTP requests', async t => {
  const h = await harness(t);
  const result = await h.run('publish', ['--scope','all']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.requested, 38);
  assert.equal(result.summary.published, 38);
  assert.equal(result.summary.sourceValidated, true);
  assert.equal(result.summary.sourceRequestCount, 39);
  assert.equal(h.calls.filter(call => call.url.includes('oauth2/callback')).length, 1);
  const posts = h.calls.filter(call => !call.url.includes('oauth2/callback'));
  assert.equal(posts.length, 38);
  for (let i = 1; i < posts.length; i++) assert.equal(posts[i].at - posts[i-1].at, 2000);
  for (const slug of Object.keys(ORANGE_BRANCHES)) assert.ok(h.store.entries.has(branchCacheKey(slug)));
});

test('an abort during source work leaves a durable unknown result and no publication', async t => {
  const h = await harness(t);
  const controller = new AbortController();
  h.input.signal = controller.signal;
  h.tokenResponse = () => { controller.abort(); throw new Error('PRIVATE_ABORT'); };
  const result = await h.run();
  assert.equal(result.exitCode, 1);
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(guard.paused, true);
  assert.ok(guard.unresolvedAttempt);
  assert.equal(h.store.entries.has(branchCacheKey(SLUG)), false);
});

test('summary renders only allowed values and never upstream or arbitrary error text', () => {
  const summary = renderActionsSummary({ outcome:'<script>PRIVATE</script>', reason:'PRIVATE_AUTH=secret', sourceRequestCount:-1 });
  assert.doesNotMatch(summary, /PRIVATE|script|secret/);
});

test('same-run replay preserves a failed token challenge instead of turning cooldown into green skip', async t => {
  const h = await harness(t);
  h.tokenResponse = () => new Response('blocked', { status:403 });
  const first = await h.run();
  const replay = await h.run();
  assert.equal(first.exitCode, 1);
  assert.equal(replay.exitCode, 1);
  assert.equal(replay.summary.replayed, true);
  assert.equal(replay.summary.sourceRequestCount, 0);
  assert.equal(replay.summary.historicalSourceRequestCount, 1);
  assert.equal(h.calls.length, 1);
});

test('invalid or unreadable common protection stays a failure, not a neutral skipped workflow', async t => {
  for (const broken of ['invalid','unreadable']) {
    const h = await harness(t);
    if (broken === 'invalid') h.sourceGuardStore.seed(SOURCE_GUARD_KEY, { private:'PRIVATE' });
    else h.sourceGuardStore.getWithMetadata = async () => { throw new Error('PRIVATE_STORAGE'); };
    const result = await h.run();
    assert.equal(result.exitCode, 1);
    assert.equal(result.summary.outcome, 'failed');
    assert.equal(h.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});

test('a late final control read cannot start publication after the source lease expires', async t => {
  const h = await harness(t);
  const read = h.store.getWithMetadata.bind(h.store);
  let controlReads = 0;
  h.store.getWithMetadata = async (key, options) => {
    const result = await read(key, options);
    // CLI preflight adds one control read before the five collector reads.
    if (key === EXCHANGE_KEYS.control && ++controlReads === 6) h.advance(25_000);
    return result;
  };
  const result = await h.run('publish', ['--scope','single']);
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.sourceSucceeded, 1);
  assert.equal(result.summary.results[0].status, 'publication_failed');
  assert.equal(h.store.entries.has(branchCacheKey(SLUG)), false);
  assert.equal(h.calls.length, 2);
});

test('a known rate challenge survives simultaneous cancellation as a persisted cooldown', async t => {
  const h = await harness(t);
  const controller = new AbortController();
  h.input.signal = controller.signal;
  h.rateResponse = () => { controller.abort(); return new Response('PRIVATE', { status:403, headers:{'cf-mitigated':'challenge'} }); };
  const result = await h.run();
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.sourceRequestCount, 2);
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(guard.breaker.blockLevel, 1);
  assert.equal(Date.parse(guard.breaker.blockedUntil), START + 6 * 60 * 60_000);
  assert.equal(guard.unresolvedAttempt, null);
});

test('cancellation immediately before requester startup does not leave an unknown source marker', async t => {
  const h = await harness(t);
  const controller = new AbortController();
  h.input.signal = controller.signal;
  let checks = 0;
  h.input.queryImpl = options => queryBranchRates({ ...options, canContinue: () => {
    if (++checks === 2) controller.abort();
    return true;
  } });
  const result = await h.run();
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.sourceRequestCount, 0);
  assert.equal(h.calls.length, 0);
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(guard.unresolvedAttempt, null);
  assert.equal(guard.paused, false);
});
