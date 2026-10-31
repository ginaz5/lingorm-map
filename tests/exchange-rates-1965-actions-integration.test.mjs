import assert from 'node:assert/strict';
import test from 'node:test';
import FIXTURE from './fixtures/superrich1965/exchange-rate-00.json' with { type: 'json' };
import { parseActionsArgs, renderActionsSummary, runActionsCommand } from '../scripts/exchange-rates-1965-actions.mjs';
import { PROJECT_SITE_ID } from '../netlify/functions/_shared/exchange-rates-1965-actions-target.mjs';
import { actionsSlugs } from '../netlify/functions/_shared/exchange-rates-1965-actions-runner.mjs';
import { SOURCE_GUARD_KEY, bootstrapSourceGuard, setSourceGuardPaused } from '../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { EXCHANGE_KEYS, createControl } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { branchCacheKey, queryBranchRates } from '../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { readBranchRates } from '../netlify/functions/_shared/exchange-rates-1965-branch-cache.mjs';
import { ORANGE_BRANCHES, isValidBranchQuote } from '../src/data/exchange-rates-1965-branch.js';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-20T01:00:00Z');
const SLUGS = Object.keys(ORANGE_BRANCHES);
// The first branch in the reviewed inventory; a failing first branch stops the round.
const SLUG = SLUGS[0];
const FIRST_FIVE = SLUGS.slice(0, 5);
const RETIRED_MODES = ['probe', 'probe-python', 'publish', 'publish-python', 'publish-five-python'];
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
      // The Python transport is the only source; a Node source request is a regression.
      fetchImpl: async () => { throw new Error('node_source_must_not_run'); },
      pythonFetchImpl: async (url, options) => {
        calls.push({ url: String(url), options, at: now });
        return String(url).includes('oauth2/callback') ? h.tokenResponse() : h.rateResponse();
      },
    },
  };
  h.run = (command = 'publish-all-python') => runActionsCommand([command, '--target', 'preview-reviewed'], h.input);
  return h;
}

for (const args of [[], ['publish-all-python'], ['publish-all-python','--target'],
  ['publish-all-python','--target','preview-reviewed','--slug','superrich1965-56'],
  ['publish-all-python','--target','preview-reviewed','--scope','all'], ['inspect','--target','preview-reviewed','--force','true'],
  ['publish-all-python','--target','preview-reviewed','--target','production']]) {
  test(`Actions arguments fail closed: ${args.join(' ') || '(empty)'}`, () => assert.throws(() => parseActionsArgs(args)));
}

for (const mode of RETIRED_MODES) {
  test(`retired rollout mode ${mode} is rejected`, () => {
    assert.throws(() => parseActionsArgs([mode, '--target', 'preview-reviewed']));
  });
}

test('publish-all-python accepts only its fixed reviewed Preview scope', () => {
  assert.deepEqual(parseActionsArgs(['publish-all-python', '--target', 'preview-reviewed']),
    { mode: 'publish-all-python', alias: 'preview-reviewed', scope: 'all' });
  for (const args of [[], ['--target', 'arbitrary'],
    ...['single', 'pilot', 'five', 'all'].map(value => ['--target', 'preview-reviewed', '--scope', value]),
    ...[SLUG, 'superrich1965-58'].map(slug => ['--target', 'preview-reviewed', '--slug', slug]),
    ['--target', 'preview-reviewed', '--transport', 'node'],
    ['--target', 'preview-reviewed', '--url', 'https://example.invalid'],
    ['--target', 'preview-reviewed', '--force', 'true']]) {
    assert.throws(() => parseActionsArgs(['publish-all-python', ...args]));
  }
});

test('the collector inventory is exactly the 38 reviewed branches in order', () => {
  const all = actionsSlugs();
  assert.deepEqual(all, SLUGS);
  assert.equal(all.length, 38);
  assert.equal(new Set(all).size, 38);
});

test('publish-all-python publishes each mapped branch with one token, paced requests and a durable zero-HTTP replay', async t => {
  const h = await harness(t);
  const before = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  before.breaker.blockLevel = 2;
  h.sourceGuardStore.seed(SOURCE_GUARD_KEY, before);
  const result = await h.run();
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.mode, 'publish-all-python');
  assert.equal(result.summary.scope, 'all');
  assert.equal(result.summary.requested, 38);
  assert.equal(result.summary.sourceSucceeded, 38);
  assert.equal(result.summary.published, 38);
  assert.equal(result.summary.cacheHit, 0);
  assert.equal(result.summary.notAttempted, 0);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.sourceValidated, true);
  assert.equal(result.summary.sourceRequestCount, 39);
  assert.deepEqual(result.summary.results.map(entry => [entry.slug, entry.status]), SLUGS.map(slug => [slug, 'published']));
  assert.equal(h.calls.filter(call => call.url.includes('oauth2/callback')).length, 1);
  const posts = h.calls.filter(call => !call.url.includes('oauth2/callback'));
  assert.equal(posts.length, 38);
  for (let index = 0; index < SLUGS.length; index++) {
    const branch = ORANGE_BRANCHES[SLUGS[index]];
    assert.deepEqual(JSON.parse(posts[index].options.body), { filters: [
      { field: 'company_code', value: branch.companyCode }, { field: 'branch_no', value: branch.branchNo },
    ] });
    if (index > 0) assert.equal(posts[index].at - posts[index - 1].at, 2000);
    const quote = h.store.entries.get(branchCacheKey(SLUGS[index])).data;
    assert.equal(isValidBranchQuote(quote), true);
    assert.equal(quote.controlVersion, uuid(1));
    assert.equal(quote.slug, SLUGS[index]);
    assert.equal(quote.branch.officialId, branch.officialId);
    assert.equal(quote.branch.companyCode, branch.companyCode);
    assert.equal(quote.branch.branchNo, branch.branchNo);
    assert.doesNotMatch(JSON.stringify(quote), /PRIVATE_SOURCE_TOKEN|authorization|diagnostics/i);
  }
  assert.equal(h.store.entries.has('exchange-rates-1965/snapshot'), false);
  const after = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(after.sourceEpoch, before.sourceEpoch);
  assert.equal(after.breaker.blockLevel, 2);
  assert.equal(after.paused, false);
  assert.equal(after.leaseId, null);
  assert.equal(after.unresolvedAttempt, null);
  // The source token never reaches the guard store or the run summary.
  assert.equal(JSON.stringify([...h.sourceGuardStore.entries]).includes('PRIVATE_SOURCE_TOKEN'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SOURCE_TOKEN'), false);

  const savedQuotes = SLUGS.map(slug => structuredClone(h.store.entries.get(branchCacheKey(slug))));
  const guardBeforeReplay = structuredClone([...h.sourceGuardStore.entries]);
  const replay = await h.run();
  assert.equal(replay.exitCode, 0);
  assert.equal(replay.summary.replayed, true);
  assert.equal(replay.summary.sourceRequestCount, 0);
  assert.equal(replay.summary.historicalSourceRequestCount, 39);
  assert.equal(replay.summary.sourceValidated, false);
  assert.equal(h.calls.length, 39);
  assert.deepEqual([...h.sourceGuardStore.entries], guardBeforeReplay);
  assert.deepEqual(SLUGS.map(slug => h.store.entries.get(branchCacheKey(slug))), savedQuotes);

  // The same run with a different workflow commit is a conflict, not a new collection.
  h.input.env.GITHUB_SHA = 'c'.repeat(40);
  const conflict = await h.run();
  assert.equal(conflict.exitCode, 2);
  assert.equal(conflict.summary.reason, 'operation_conflict');
  assert.equal(conflict.summary.sourceRequestCount, 0);
  assert.equal(h.calls.length, 39);
  assert.deepEqual([...h.sourceGuardStore.entries], guardBeforeReplay);
});

test('a challenge on the third Python branch preserves two published quotes, stops the batch and pauses the shared guard', async t => {
  const h = await harness(t);
  const before = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  before.breaker.blockLevel = 2;
  h.sourceGuardStore.seed(SOURCE_GUARD_KEY, before);
  let postCount = 0;
  h.rateResponse = () => ++postCount === 3
    ? new Response('PRIVATE_CHALLENGE', { status: 403, headers: { 'cf-mitigated': 'challenge' } })
    : Response.json(FIXTURE);
  const result = await h.run();
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.reason, 'paused');
  assert.equal(result.summary.retryAt, null);
  assert.equal(result.summary.requested, 38);
  assert.equal(result.summary.sourceSucceeded, 2);
  assert.equal(result.summary.published, 2);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.notAttempted, 35);
  assert.equal(result.summary.sourceValidated, false);
  assert.equal(result.summary.sourceRequestCount, 4);
  assert.deepEqual(result.summary.results.slice(0, 5).map(entry => [entry.slug, entry.status]), FIRST_FIVE.map((slug, index) => [
    slug, index < 2 ? 'published' : index === 2 ? 'source_failed' : 'not_attempted',
  ]));
  assert.equal(result.summary.results[2].diagnostics.at(-1).stage, 'rate');
  assert.equal(result.summary.results[2].diagnostics.at(-1).status, 403);
  assert.equal(result.summary.results[2].diagnostics.at(-1).challenge, true);
  assert.equal(h.calls.length, 4);
  for (const [index, slug] of SLUGS.entries()) {
    assert.equal(h.store.entries.has(branchCacheKey(slug)), index < 2);
  }
  const savedQuotes = SLUGS.slice(0, 2).map(slug => structuredClone(h.store.entries.get(branchCacheKey(slug))));
  const after = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(after.sourceEpoch, before.sourceEpoch);
  assert.equal(after.paused, true);
  assert.equal(after.breaker.blockLevel, 3);
  assert.equal(after.leaseId, null);
  assert.equal(after.unresolvedAttempt, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  const replay = await h.run();
  assert.equal(replay.exitCode, 1);
  assert.equal(replay.summary.replayed, true);
  assert.equal(replay.summary.sourceRequestCount, 0);
  assert.equal(replay.summary.historicalSourceRequestCount, 4);
  h.input.env.GITHUB_RUN_ID = '1235';
  const blocked = await h.run();
  assert.equal(blocked.exitCode, 3);
  assert.equal(blocked.summary.reason, 'paused');
  assert.equal(blocked.summary.sourceRequestCount, 0);
  assert.equal(h.calls.length, 4);
  assert.equal(h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data.breaker.blockLevel, 3);
  assert.deepEqual(SLUGS.slice(0, 2).map(slug => h.store.entries.get(branchCacheKey(slug))), savedQuotes);
});

test('a later run reuses five fresh quotes, fetches the remaining 33 and leaves a complete 38-quote cache', async t => {
  const h = await harness(t);
  const first = await h.run();
  assert.equal(first.exitCode, 0);
  assert.equal(first.summary.published, 38);
  assert.equal(h.calls.length, 39);
  // Leave only five fresh quotes, as if the other 33 had not been collected yet.
  for (const slug of SLUGS.slice(5)) h.store.entries.delete(branchCacheKey(slug));
  const firstQuotes = FIRST_FIVE.map(slug => structuredClone(h.store.entries.get(branchCacheKey(slug))));
  h.advance(2000);
  h.input.env.GITHUB_RUN_ID = '1235';
  const second = await h.run();
  assert.equal(second.exitCode, 0);
  assert.equal(second.summary.requested, 38);
  assert.equal(second.summary.cacheHit, 5);
  assert.equal(second.summary.sourceSucceeded, 33);
  assert.equal(second.summary.published, 33);
  assert.equal(second.summary.failed, 0);
  assert.equal(second.summary.notAttempted, 0);
  assert.equal(second.summary.sourceRequestCount, 34);
  assert.equal(second.summary.sourceValidated, false);
  assert.equal(h.calls.length, 73);
  const secondCalls = h.calls.slice(39);
  assert.equal(secondCalls.filter(call => call.url.includes('oauth2/callback')).length, 1);
  assert.equal(secondCalls.filter(call => !call.url.includes('oauth2/callback')).length, 33);
  assert.deepEqual(second.summary.results.filter(entry => entry.status === 'cache_hit').map(entry => entry.slug).sort(), [...FIRST_FIVE].sort());
  assert.deepEqual(FIRST_FIVE.map(slug => h.store.entries.get(branchCacheKey(slug))), firstQuotes);
  for (const slug of SLUGS) {
    assert.equal(isValidBranchQuote(h.store.entries.get(branchCacheKey(slug)).data), true);
  }
  assert.equal(h.store.entries.has('exchange-rates-1965/snapshot'), false);
  const replay = await h.run();
  assert.equal(replay.exitCode, 0);
  assert.equal(replay.summary.replayed, true);
  assert.equal(replay.summary.sourceRequestCount, 0);
  assert.equal(replay.summary.historicalSourceRequestCount, 34);
  assert.equal(h.calls.length, 73);
});

test('a Python token timeout retried once publishes the quote and reports three source requests', async t => {
  const h = await harness(t);
  let tokenCalls = 0;
  h.input.pythonFetchImpl = async (url, options) => {
    h.calls.push({ url: String(url), options });
    if (!String(url).includes('oauth2/callback')) return h.rateResponse();
    if (++tokenCalls === 1) throw new Error('python_source_timeout');
    return h.tokenResponse();
  };
  const result = await h.run();
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.published, 38);
  assert.equal(result.summary.sourceValidated, true);
  // Three requests for the first branch, then the renewed token serves the other 37.
  assert.equal(result.summary.sourceRequestCount, 40);
  assert.equal(result.summary.results[0].status, 'published');
  assert.equal(result.summary.results[0].sourceRequestCount, 3);
  assert.deepEqual(result.summary.results[0].diagnostics.map(entry => [entry.stage, entry.status, entry.reason]),
    [['token', null, 'timeout'], ['token', 200, null], ['rate', 200, null]]);
  assert.equal(h.calls.length, 40);
  assert.equal(isValidBranchQuote(h.store.entries.get(branchCacheKey(SLUG)).data), true);
});

test('Python publication writes valid quotes; paused cache reads, cache hits and terminal replay add no source HTTP', async t => {
  const h = await harness(t);
  const first = await h.run();
  assert.equal(first.exitCode, 0);
  assert.equal(first.summary.mode, 'publish-all-python');
  assert.equal(first.summary.requested, 38);
  assert.equal(first.summary.published, 38);
  assert.equal(first.summary.sourceValidated, true);
  assert.equal(first.summary.sourceRequestCount, 39);
  assert.equal(first.summary.results[0].status, 'published');
  assert.equal(h.calls.length, 39);
  const branch = ORANGE_BRANCHES[SLUG];
  assert.deepEqual(JSON.parse(h.calls[1].options.body), { filters: [
    { field: 'company_code', value: branch.companyCode }, { field: 'branch_no', value: branch.branchNo },
  ] });
  const quote = h.store.entries.get(branchCacheKey(SLUG)).data;
  assert.equal(isValidBranchQuote(quote), true);
  assert.equal(quote.controlVersion, uuid(1));
  assert.equal(h.store.entries.has('exchange-rates-1965/snapshot'), false);
  assert.doesNotMatch(JSON.stringify(quote), /PRIVATE_SOURCE_TOKEN|authorization|diagnostics/i);

  h.advance(2000);
  h.input.env.GITHUB_RUN_ID = '1235';
  const cached = await h.run();
  assert.equal(cached.exitCode, 0);
  assert.equal(cached.summary.cacheHit, 38);
  assert.equal(cached.summary.sourceRequestCount, 0);
  assert.equal(cached.summary.published, 0);
  const now = h.input.nowImpl();
  await setSourceGuardPaused({ store: h.sourceGuardStore, paused: true, nowMs: now });
  const storedBeforeReads = structuredClone([...h.store.entries]);
  const guardBeforeReads = structuredClone([...h.sourceGuardStore.entries]);
  for (let i = 0; i < 2; i++) {
    const response = await readBranchRates({ store: h.store, slug: SLUG, enabledDefault: 'false', nowImpl: () => now });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.quote, quote);
    assert.equal(payload.reason, null);
  }
  assert.deepEqual([...h.store.entries], storedBeforeReads);
  assert.deepEqual([...h.sourceGuardStore.entries], guardBeforeReads);
  assert.equal(h.calls.length, 39);

  h.input.env.GITHUB_RUN_ID = '1234';
  const replay = await h.run();
  assert.equal(replay.exitCode, 0);
  assert.equal(replay.summary.replayed, true);
  assert.equal(replay.summary.sourceRequestCount, 0);
  assert.equal(replay.summary.sourceValidated, false);
  assert.equal(h.calls.length, 39);
  const expired = await readBranchRates({ store: h.store, slug: SLUG, enabledDefault: 'false', nowImpl: () => Date.parse(quote.expiresAt) });
  assert.equal(expired.status, 503);
  assert.equal((await expired.json()).quote, null);
  assert.deepEqual([...h.store.entries], storedBeforeReads);
  assert.equal(h.calls.length, 39);
});

test('Python publication reports the longer common cooldown after a token challenge', async t => {
  const h = await harness(t);
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  guard.breaker.blockLevel = 1;
  h.sourceGuardStore.seed(SOURCE_GUARD_KEY, guard);
  h.tokenResponse = () => new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
  const result = await h.run();
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.published, 0);
  assert.equal(result.summary.sourceRequestCount, 1);
  assert.equal(h.calls.length, 1);
  const blockedUntil = new Date(START + 24 * 60 * 60_000).toISOString();
  assert.equal(h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data.breaker.blockedUntil, blockedUntil);
  assert.equal(h.store.entries.get(EXCHANGE_KEYS.breaker).data.blockedUntil, new Date(START + 6 * 60 * 60_000).toISOString());
  assert.equal(result.summary.retryAt, blockedUntil);
  assert.equal(result.summary.results[0].retryAt, blockedUntil);
  assert.equal(h.store.entries.has(branchCacheKey(SLUG)), false);
});

for (const protection of ['paused', 'cooldown']) {
  test(`Python publication respects existing ${protection} before starting the transport`, async t => {
    const h = await harness(t);
    let pythonCalls = 0;
    h.input.pythonFetchImpl = async () => { pythonCalls++; throw new Error('must_not_run'); };
    const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
    if (protection === 'paused') guard.paused = true;
    else guard.breaker.blockedUntil = new Date(START + 24 * 60 * 60_000).toISOString();
    h.sourceGuardStore.seed(SOURCE_GUARD_KEY, guard);
    const result = await h.run();
    assert.equal(result.exitCode, 3);
    assert.equal(result.summary.sourceRequestCount, 0);
    assert.equal(pythonCalls, 0);
    assert.equal(h.calls.length, 0);
    assert.equal(h.store.entries.has(branchCacheKey(SLUG)), false);
  });
}

for (const interruption of ['cancelled', 'control_changed', 'quote_cas_failed']) {
  test(`Python source success cannot publish after ${interruption}`, async t => {
    const h = await harness(t);
    const controller = new AbortController();
    h.input.signal = controller.signal;
    if (interruption === 'quote_cas_failed') {
      const write = h.store.setJSON.bind(h.store);
      h.store.setJSON = (key, data, options) => key === branchCacheKey(SLUG)
        ? Promise.resolve({ modified: false, etag: null }) : write(key, data, options);
    } else {
      h.rateResponse = () => {
        if (interruption === 'cancelled') controller.abort();
        else h.store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, controlVersion: uuid(3), nowMs: START, updatedBy: 'manual' }));
        return Response.json(FIXTURE);
      };
    }
    const result = await h.run();
    assert.equal(result.exitCode, 1);
    assert.equal(result.summary.sourceRequestCount, 2);
    assert.equal(result.summary.published, 0);
    assert.equal(h.calls.length, 2);
    assert.equal(h.store.entries.has(branchCacheKey(SLUG)), false);
    assert.equal(h.store.entries.has('exchange-rates-1965/snapshot'), false);
  });
}

test('paused, cooling and unresolved common protection never starts Python', async t => {
  for (const state of ['paused', 'cooldown', 'unknown']) {
    const h = await harness(t);
    let pythonCalls = 0;
    h.input.pythonFetchImpl = async () => { pythonCalls++; throw new Error('must_not_run'); };
    if (state === 'paused') await setSourceGuardPaused({ store: h.sourceGuardStore, paused: true, nowMs: START });
    else {
      const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
      if (state === 'cooldown') {
        guard.breaker.blockLevel = 2;
        guard.breaker.blockedUntil = new Date(START + 24 * 60 * 60_000).toISOString();
      } else {
        guard.unresolvedAttempt = { operationId: 'ginaz5/lingorm-map/1233', ownerId: uuid(9), slug: SLUG, startedAtMs: START - 1 };
        guard.leaseId = uuid(8);
        guard.leaseUntilMs = START + 24_000;
        guard.paused = true;
      }
      h.sourceGuardStore.seed(SOURCE_GUARD_KEY, guard);
    }
    const result = await h.run();
    assert.equal(result.exitCode, 3);
    assert.equal(result.summary.sourceRequestCount, 0);
    assert.equal(pythonCalls, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('Python token 403 stops before POST, retains escalation and never falls back to Node', async t => {
  const h = await harness(t);
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  guard.breaker.blockLevel = 1;
  h.sourceGuardStore.seed(SOURCE_GUARD_KEY, guard);
  let pythonCalls = 0;
  h.input.pythonFetchImpl = async () => {
    pythonCalls++;
    return new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
  };
  const result = await h.run();
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.sourceRequestCount, 1);
  assert.equal(result.summary.results[0].diagnostics[0].stage, 'token');
  assert.equal(pythonCalls, 1);
  assert.equal(h.calls.length, 0);
  const after = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(after.breaker.blockLevel, 2);
  assert.equal(Date.parse(after.breaker.blockedUntil), START + 24 * 60 * 60_000);
  assert.equal(h.store.entries.has(branchCacheKey(SLUG)), false);
});

test('third shared challenge reports a manual pause without an automatic retry time', async t => {
  const h = await harness(t);
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  guard.breaker.blockLevel = 2;
  h.sourceGuardStore.seed(SOURCE_GUARD_KEY, guard);
  h.input.pythonFetchImpl = async () => new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
  const result = await h.run();
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.reason, 'paused');
  assert.equal(result.summary.retryAt, null);
  assert.equal(result.summary.results[0].retryAt, null);
  assert.equal(result.summary.sourceRequestCount, 1);
  assert.equal(result.summary.published, 0);
  const after = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(after.paused, true);
  assert.equal(after.breaker.blockLevel, 3);
  assert.equal(after.unresolvedAttempt, null);
  assert.equal(h.calls.length, 0);
});

test('inspect makes paused protection explicit without suggesting a timed automatic recovery', async t => {
  const h = await harness(t);
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  guard.paused = true;
  guard.breaker.blockedUntil = new Date(START + 24 * 60 * 60_000).toISOString();
  h.sourceGuardStore.seed(SOURCE_GUARD_KEY, guard);
  const result = await h.run('inspect');
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.sourceGuard.paused, true);
  assert.equal(result.summary.sourceGuard.retryAt, null);
  assert.equal(result.summary.sourceGuard.blockedUntil, guard.breaker.blockedUntil);
  assert.equal(h.calls.length, 0);
});

test('a pause between preflight and source lease acquisition has no automatic retry time', async t => {
  const h = await harness(t);
  h.input.pythonFetchImpl = async () => { throw new Error('must_not_run'); };
  h.input.queryImpl = options => queryBranchRates({ ...options, beforeSource: async () => {
    const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
    h.sourceGuardStore.seed(SOURCE_GUARD_KEY, { ...guard, paused: true, nextRequestAtMs: START + 60_000 });
    return options.beforeSource();
  } });
  const result = await h.run();
  assert.equal(result.exitCode, 3);
  assert.equal(result.summary.reason, 'paused');
  assert.equal(result.summary.retryAt, null);
  assert.equal(result.summary.sourceRequestCount, 0);
  assert.equal(result.summary.published, 0);
  assert.equal(h.calls.length, 0);
});

test('an unconfigured target cannot accidentally contact any network', async t => {
  let calls = 0;
  const result = await runActionsCommand(['publish-all-python','--target','preview-reviewed'], { env,
    targetsInput: { schemaVersion: 1, siteID: PROJECT_SITE_ID, targets: {} },
    fetchImpl: async () => { calls++; throw new Error('PRIVATE_CREDENTIAL'); },
    pythonFetchImpl: async () => { calls++; throw new Error('PRIVATE_SOURCE'); } });
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.reason, 'target_not_configured');
  assert.equal(calls, 0);
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
  h.advance(90_000); // past the 89s source lease (80s profile deadline + 9s)
  h.target.deployID = '2'.repeat(24);
  h.input.env.GITHUB_RUN_ID = '1235';
  const second = await h.run();
  assert.equal(second.exitCode, 3);
  assert.equal(second.summary.reason, 'unknown_outcome');
  assert.equal(h.calls.length, 1);
  assert.ok(h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data.unresolvedAttempt);
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
  const summary = renderActionsSummary({ outcome:'<script>PRIVATE</script>', reason:'PRIVATE_AUTH=secret', sourceRequestCount:-1,
    stoppedSlug: 'superrich1965-92', results: [{ slug: 'superrich1965-92', diagnostics: [
      { stage: 'token', status: 'PRIVATE_STATUS', reason: 'PRIVATE_REASON', body: 'PRIVATE_BODY', accessToken: 'PRIVATE_TOKEN',
        tokenRemainingSeconds: 'PRIVATE_SECONDS', tokenReissued: 'PRIVATE_FLAG' },
    ] }] });
  assert.doesNotMatch(summary, /PRIVATE|script|secret/);
  assert.match(summary, /HTTP status: unavailable/);
  assert.match(summary, /Diagnostic: unavailable/);
});

for (const [reason, response] of [
  ['invalid_token_json', () => new Response('PRIVATE_BODY')],
  ['invalid_token_value', () => Response.json({ accessToken: 'PRIVATE_INVALID TOKEN' })],
  ['expired_token', () => Response.json({ accessToken: 'PRIVATE_TOKEN', expires_in: 0 })],
  ['near_expiry_token', () => Response.json({ accessToken: 'PRIVATE_SOURCE_TOKEN', expires_in: 20 })],
]) test(`full batch retains 34 published quotes and diagnoses token renewal ${reason} without retry`, async t => {
  const h = await harness(t);
  let tokenCalls = 0;
  h.tokenResponse = () => ++tokenCalls === 1
    ? Response.json({ accessToken: 'PRIVATE_SOURCE_TOKEN', expires_in: 385 }) : response();
  h.rateResponse = () => { h.advance(8000); return Response.json(FIXTURE); };
  const result = await h.run();
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.published, 34);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.notAttempted, 3);
  assert.equal(result.summary.sourceRequestCount, 36);
  assert.equal(result.summary.stoppedSlug, 'superrich1965-92');
  const timing = reason === 'expired_token' ? { tokenRemainingSeconds: 0, tokenReissued: 0 }
    : reason === 'near_expiry_token' ? { tokenRemainingSeconds: 20, tokenReissued: 1 } : {};
  assert.deepEqual(result.summary.results[34].diagnostics, [{ stage: 'token', status: 200, challenge: false, reason, ...timing }]);
  assert.equal(tokenCalls, 2);
  assert.equal(h.calls.length, 36);
  for (const entry of result.summary.results.slice(0, 34)) assert.ok(h.store.entries.has(branchCacheKey(entry.slug)));
  for (const entry of result.summary.results.slice(34)) assert.equal(h.store.entries.has(branchCacheKey(entry.slug)), false);
  const guard = h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(guard.unresolvedAttempt, null);
  assert.equal(guard.leaseId, null);
  const summary = renderActionsSummary(result.summary);
  assert.match(summary, /\| Published \| 34 \|/);
  assert.match(summary, /\| Failed \| 1 \|/);
  assert.match(summary, /\| Not attempted \| 3 \|/);
  assert.match(summary, /Stopped branch: superrich1965-92/);
  assert.match(summary, /Source stage: token/);
  assert.match(summary, /HTTP status: 200/);
  assert.ok(summary.includes(`Diagnostic: ${reason}`));
  if (reason === 'near_expiry_token') {
    assert.match(summary, /Token remaining seconds \(bounded to ±86400\): 20/);
    assert.match(summary, /Callback returned previous token: yes/);
  }
  assert.doesNotMatch(JSON.stringify(result) + summary, /PRIVATE/);
  const replay = await h.run();
  assert.equal(replay.exitCode, 1);
  assert.equal(replay.summary.replayed, true);
  assert.equal(replay.summary.sourceRequestCount, 0);
  assert.deepEqual(replay.summary.results[34].diagnostics, result.summary.results[34].diagnostics);
  assert.equal(h.calls.length, 36);
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
    if (key === EXCHANGE_KEYS.control && ++controlReads === 6) h.advance(90_000); // past the 89s source lease
    return result;
  };
  const result = await h.run();
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
