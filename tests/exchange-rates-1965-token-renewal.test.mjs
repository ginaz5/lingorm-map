import assert from 'node:assert/strict';
import test from 'node:test';
import FIXTURE from './fixtures/superrich1965/exchange-rate-00.json' with { type: 'json' };
import { runActionsCommand } from '../scripts/exchange-rates-1965-actions.mjs';
import { ACTIONS_BUDGET_MS, ACTIONS_JOB_KEY, actionsOperationKey } from '../netlify/functions/_shared/exchange-rates-1965-actions-runner.mjs';
import { PROJECT_SITE_ID } from '../netlify/functions/_shared/exchange-rates-1965-actions-target.mjs';
import { EXCHANGE_KEYS, createControl } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { BRANCH_GATE_KEY, branchCacheKey } from '../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { SOURCE_GUARD_KEY, bootstrapSourceGuard, setSourceGuardPaused } from '../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { ORANGE_BRANCHES, isValidBranchQuote } from '../src/data/exchange-rates-1965-branch.js';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-23T01:00:00.000Z');
const TOKEN_LIFETIME_MS = 370_000;
const SLUGS = Object.keys(ORANGE_BRANCHES);
const RUN_ID = '1234';
const REPOSITORY = 'ginaz5/lingorm-map';
const OPERATION_KEY = actionsOperationKey(REPOSITORY, RUN_ID);
const unsignedToken = (expiresAtMs, sequence) => [Buffer.from('{}').toString('base64url'),
  Buffer.from(JSON.stringify({ exp: expiresAtMs / 1_000, sequence })).toString('base64url'), 'synthetic-test'].join('.');

async function harness(t) {
  t.mock.method(console, 'info', () => {});
  const store = new FakeBlobStore(), sourceGuardStore = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, nowMs: START - 1_000,
    controlVersion: uuid(1), updatedBy: 'manual' }));
  await bootstrapSourceGuard({ store: sourceGuardStore, legacyBreakers: [null], legacyReviewed: true,
    nowMs: START - 1_000, randomUUIDImpl: () => uuid(2) });
  await setSourceGuardPaused({ store: sourceGuardStore, paused: false, nowMs: START - 1_000 });
  const history = sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  history.breaker.blockLevel = 1;
  sourceGuardStore.seed(SOURCE_GUARD_KEY, history);
  const target = { alias: 'production', siteID: PROJECT_SITE_ID, kind: 'production',
    branch: 'main', commit: 'b'.repeat(40), context: 'production' };
  const controller = new AbortController();
  let now = START, idSequence = 10, tokenSequence = 0, expiresAtMs = START + TOKEN_LIFETIME_MS;
  let value = unsignedToken(expiresAtMs, tokenSequence);
  const calls = [], waits = [], tokens = [value];
  const h = { store, sourceGuardStore, controller, target, calls, waits, tokens,
    currentTarget: true, verifyCalls: 0, rateCalls: 0, tokenCalls: 0,
    advance: ms => { now += ms; }, now: () => now,
    onWait: async () => {}, onRate: () => {}, renewalResponse: null,
  };
  h.input = {
    env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_RUN_ID: RUN_ID,
      GITHUB_SHA: 'a'.repeat(40), GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch' },
    signal: controller.signal, nowImpl: () => now, randomUUIDImpl: () => uuid(idSequence++), randomImpl: () => 0,
    openTargetImpl: async () => ({ target, store, sourceGuardStore,
      metadata: { state: 'ready', commit_ref: target.commit },
      verifyCurrent: async () => { h.verifyCalls++; return h.currentTarget; } }),
    fetchImpl: async () => assert.fail('Python publication must not fall back to the Node source transport'),
    pythonFetchImpl: async (url, options) => {
      calls.push({ url: String(url), at: now, method: options.method });
      if (String(url).includes('oauth2/callback')) {
        h.tokenCalls++;
        if (h.tokenCalls > 1 && h.renewalResponse) return h.renewalResponse();
        // Reproduce the source behavior: a request before the previous token's
        // actual expiry would receive exactly the same JWT again.
        if (now >= expiresAtMs + 2_000) {
          expiresAtMs = now + TOKEN_LIFETIME_MS;
          value = unsignedToken(expiresAtMs, ++tokenSequence);
          tokens.push(value);
        }
        return Response.json({ accessToken: value });
      }
      h.rateCalls++;
      h.onRate();
      now += 8_000;
      return Response.json(FIXTURE);
    },
    sleepImpl: async (ms, signal) => {
      signal?.throwIfAborted();
      if (ms <= 1_000) {
        const gate = store.entries.get(BRANCH_GATE_KEY)?.data;
        const guard = sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
        assert.equal(gate?.leaseId ?? null, null, 'Token readiness must not hold a target lease');
        assert.equal(guard.leaseId, null, 'Token readiness must not hold a source lease');
        assert.equal(guard.unresolvedAttempt, null, 'Waiting must not create an unresolved source attempt');
        waits.push({ at: now, ms, sourceRequestCount: calls.length });
        await h.onWait();
      }
      now += ms;
      signal?.throwIfAborted();
    },
  };
  h.run = () => runActionsCommand(['publish-all-python', '--target', 'production'], h.input);
  return h;
}

function assertNoTokenLeak(h, result) {
  const text = JSON.stringify(result) + JSON.stringify([...h.store.entries]) + JSON.stringify([...h.sourceGuardStore.entries]);
  for (const token of h.tokens) assert.equal(text.includes(token), false);
}

function assertSourceReleased(h) {
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(guard.leaseId, null);
  assert.equal(guard.unresolvedAttempt, null);
  return guard;
}

test('all 38 Python branches wait for actual token expiry before one renewal and preserve protection history', async t => {
  const h = await harness(t);
  const originalEpoch = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data.sourceEpoch;
  const result = await h.run();
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.published, 38);
  assert.equal(result.summary.sourceSucceeded, 38);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.notAttempted, 0);
  assert.equal(result.summary.sourceValidated, true);
  assert.equal(result.summary.sourceRequestCount, 40);
  assert.equal(h.tokenCalls, 2);
  assert.equal(h.rateCalls, 38);
  assert.ok(h.waits.length > 0);
  assert.ok(h.waits.every(wait => wait.ms > 0 && wait.ms <= 1_000));
  assert.ok(h.waits.every(wait => wait.sourceRequestCount === h.waits[0].sourceRequestCount));
  const tokenRequests = h.calls.filter(call => call.method === 'GET');
  assert.ok(tokenRequests[1].at >= START + TOKEN_LIFETIME_MS + 2_000);
  assert.equal(h.tokens.length, 2);
  for (const slug of SLUGS) assert.equal(isValidBranchQuote(h.store.entries.get(branchCacheKey(slug))?.data), true);
  const guard = assertSourceReleased(h);
  assert.equal(guard.sourceEpoch, originalEpoch);
  assert.equal(guard.breaker.blockLevel, 1);
  assert.equal(guard.breaker.consecutiveFailedRuns, 0);
  assert.equal(guard.paused, false);
  assert.equal(h.store.entries.get(OPERATION_KEY).data.status, 'complete');
  assertNoTokenLeak(h, result);
});

test('warm branch caches bypass token readiness even when the session JWT approaches expiry', async t => {
  const h = await harness(t);
  h.onRate = () => {
    if (h.rateCalls !== 33) return;
    const first = h.store.entries.get(branchCacheKey(SLUGS[0])).data;
    for (const slug of SLUGS.slice(33)) {
      h.store.seed(branchCacheKey(slug), { ...first, slug,
        branch: { ...first.branch, slug, ...ORANGE_BRANCHES[slug] } });
    }
  };
  const result = await h.run();
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.published, 33);
  assert.equal(result.summary.cacheHit, 5);
  assert.equal(h.waits.length, 0);
  assert.equal(h.tokenCalls, 1);
  assert.equal(h.rateCalls, 33);
  assertSourceReleased(h);
});

for (const interruption of ['cancelled', 'deadline', 'ownership_lost', 'control_changed', 'target_changed', 'gate_changed', 'source_paused', 'source_cooldown']) {
  test(`token readiness stops without another HTTP request when ${interruption}`, async t => {
    const h = await harness(t);
    let sourceRequestsBeforeWait = null;
    h.onWait = async () => {
      if (sourceRequestsBeforeWait !== null) return;
      sourceRequestsBeforeWait = h.calls.length;
      if (interruption === 'cancelled') h.controller.abort();
      if (interruption === 'deadline') h.advance(ACTIONS_BUDGET_MS);
      if (interruption === 'ownership_lost') {
        const job = h.store.entries.get(ACTIONS_JOB_KEY).data;
        h.store.seed(ACTIONS_JOB_KEY, { ...job, ownerId: uuid(999) });
      }
      if (interruption === 'control_changed') h.store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true,
        nowMs: h.now(), controlVersion: uuid(999), updatedBy: 'manual' }));
      if (interruption === 'target_changed') h.currentTarget = false;
      if (interruption === 'gate_changed') h.store.seed(BRANCH_GATE_KEY, {
        leaseId: null, leaseUntilMs: 0, nextRequestAtMs: h.now() + 60_000,
      });
      if (interruption === 'source_paused' || interruption === 'source_cooldown') {
        const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
        if (interruption === 'source_paused') guard.paused = true;
        else guard.breaker.blockedUntil = new Date(h.now() + 24 * 60 * 60_000).toISOString();
        h.sourceGuardStore.seed(SOURCE_GUARD_KEY, guard);
      }
    };
    const result = await h.run();
    assert.equal(result.exitCode, 1);
    assert.notEqual(sourceRequestsBeforeWait, null);
    assert.equal(h.calls.length, sourceRequestsBeforeWait);
    assert.equal(result.summary.published, 33);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.summary.notAttempted, 5);
    assert.equal(result.summary.stoppedSlug, SLUGS[33]);
    const expectedReason = { cancelled: 'cancelled', deadline: 'deadline', ownership_lost: 'lease_lost', control_changed: 'stale_control',
      target_changed: 'stale_target', gate_changed: 'busy', source_paused: 'paused', source_cooldown: 'cooldown' }[interruption];
    assert.equal(result.summary.reason, expectedReason);
    const guard = assertSourceReleased(h);
    assert.equal(guard.breaker.consecutiveFailedRuns, 0);
    assert.equal(guard.breaker.blockLevel, 1);
    assert.equal(guard.paused, interruption === 'source_paused');
    if (interruption === 'source_cooldown') assert.ok(Date.parse(guard.breaker.blockedUntil) > h.now());
    for (const slug of SLUGS.slice(0, 33)) assert.equal(h.store.entries.has(branchCacheKey(slug)), true);
    for (const slug of SLUGS.slice(33)) assert.equal(h.store.entries.has(branchCacheKey(slug)), false);
    assert.equal(h.store.entries.get(OPERATION_KEY).data.status, 'stopped');
    assertNoTokenLeak(h, result);
  });
}

test('a token challenge after the readiness wait is attempted once and retains shared cooldown', async t => {
  const h = await harness(t);
  h.renewalResponse = () => new Response('private-source-body', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
  const result = await h.run();
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.published, 33);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.notAttempted, 4);
  assert.equal(result.summary.sourceRequestCount, 35);
  assert.equal(h.tokenCalls, 2);
  assert.equal(h.rateCalls, 33);
  assert.ok(h.waits.length > 0);
  const guard = assertSourceReleased(h);
  assert.equal(guard.breaker.blockLevel, 2);
  assert.ok(Date.parse(guard.breaker.blockedUntil) > h.now());
  assert.equal(h.store.entries.has(branchCacheKey(SLUGS[33])), false);
  const replay = await h.run();
  assert.equal(replay.summary.replayed, true);
  assert.equal(replay.summary.sourceRequestCount, 0);
  assert.equal(h.calls.length, 35);
  assertNoTokenLeak(h, result);
  assert.doesNotMatch(JSON.stringify(result), /private-source-body/);
});
