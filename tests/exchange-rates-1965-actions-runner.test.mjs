import assert from 'node:assert/strict';
import test from 'node:test';
import { ORANGE_BRANCHES } from '../src/data/exchange-rates-1965-branch.js';
import { runActionsCollector, actionsSlugs, actionsOperationKey, ACTIONS_JOB_KEY,
  ACTIONS_BUDGET_MS } from '../netlify/functions/_shared/exchange-rates-1965-actions-runner.mjs';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-10-20T01:00:00Z');
const COMMIT = 'a'.repeat(40);
const TARGET = { alias: 'preview-reviewed', siteID: uuid(1), deployID: '6ad62ddf1a2369d43e1e364e',
  branch: 'codex/exchange-rates', commit: 'b'.repeat(40), context: 'deploy-preview' };
const FIRST_SLUG = Object.keys(ORANGE_BRANCHES)[0];
const success = (count = 2) => ({ status: 'published',
  sourceSucceeded: true, sourceRequestCount: count, reason: null, retryAt: null,
  diagnostics: [{ stage: 'token', status: 200 }, { stage: 'rate', status: 200 }] });
function harness() {
  let now = START, sequence = 10;
  const store = new FakeBlobStore(), calls = [], delays = [];
  const input = { store, repository: 'ginaz5/lingorm-map', runId: '1234', commit: COMMIT,
    controlVersion: uuid(2), target: TARGET, mode: 'publish-all-python', scope: 'all', nowImpl: () => now,
    randomUUIDImpl: () => uuid(sequence++), randomImpl: () => .5,
    sleepImpl: async (ms, signal) => { signal.throwIfAborted(); delays.push(ms); now += ms; },
    collectorImpl: async args => {
      assert.equal(await args.beforeSource(), true);
      calls.push({ slug: args.slug, at: now });
      now += 500;
      assert.equal(await args.beforePublish(), true);
      args.onResult(success());
      return Response.json({ quote: null });
    } };
  return { store, input, calls, delays, run: options => runActionsCollector({ ...input, ...options }),
    advance: ms => { now += ms; }, key: actionsOperationKey(input.repository, input.runId) };
}

test('a run claims a durable job, publishes every branch, and replays without new requests', async () => {
  const h = harness();
  const first = await h.run();
  assert.equal(first.exitCode, 0);
  assert.equal(first.requested, 38);
  assert.equal(first.sourceSucceeded, 38);
  assert.equal(first.published, 38);
  assert.equal(first.sourceRequestCount, 76);
  assert.equal(first.sourceValidated, true);
  assert.equal(first.results[0].status, 'published');
  assert.equal(h.calls[0].slug, FIRST_SLUG);
  assert.equal(h.store.entries.get(h.key).data.status, 'complete');
  assert.equal(h.store.entries.get(ACTIONS_JOB_KEY).data.status, 'complete');
  const second = await h.run({ collectorImpl: () => { throw new Error('must not request source again'); } });
  assert.equal(second.exitCode, 0);
  assert.equal(second.replayed, true);
  assert.equal(second.sourceRequestCount, 0);
  assert.equal(second.attemptSourceRequestCount, 0);
  assert.equal(second.historicalSourceRequestCount, 76);
  assert.equal(second.sourceValidated, false);
  assert.equal(second.results[0].sourceRequestCount, 0);
  assert.equal(h.calls.length, 38);
});

test('all scope serializes exactly 38 mapped branches with bounded 2–5 second intervals and real telemetry', async () => {
  const h = harness(), values = [0, .5, 1]; let sequence = 0, active = 0, peak = 0;
  const result = await h.run({ randomImpl: () => values[sequence++ % values.length],
    collectorImpl: async args => {
      assert.equal(await args.beforeSource(), true);
      peak = Math.max(peak, ++active);
      h.calls.push({ slug: args.slug, at: h.input.nowImpl() });
      h.advance(500);
      active--;
      assert.equal(await args.beforePublish(), true);
      return success(h.calls.length === 1 ? 2 : 1);
    } });
  assert.equal(peak, 1);
  assert.equal(result.exitCode, 0);
  assert.equal(result.requested, 38);
  assert.equal(result.published, 38);
  assert.equal(result.sourceSucceeded, 38);
  assert.equal(result.sourceRequestCount, 39);
  assert.equal(result.sourceValidated, true);
  assert.deepEqual(h.calls.map(call => call.slug), Object.keys(ORANGE_BRANCHES));
  assert.deepEqual(h.delays.slice(0, 3), [2000, 3500, 5000]);
  assert.equal(h.delays.length, 37);
});

test('cache hits cannot masquerade as complete source validation', async () => {
  const h = harness();
  const result = await h.run({ collectorImpl: async args => {
    h.calls.push(args.slug);
    return args.slug === FIRST_SLUG ? success() : {
      status: 'cache_hit', sourceSucceeded: false, sourceRequestCount: 0, reason: null,
    };
  } });
  assert.deepEqual(h.calls, Object.keys(ORANGE_BRANCHES));
  assert.equal(result.requested, 38);
  assert.equal(result.cacheHit, 37);
  assert.equal(result.published, 1);
  assert.equal(result.sourceSucceeded, 1);
  assert.equal(result.sourceValidated, false);
  assert.equal(h.delays.length, 1);
});

test('a source failure stops the round, preserves earlier successes and exactly accounts for unattempted branches', async () => {
  const h = harness();
  const result = await h.run({ collectorImpl: async args => {
    h.calls.push(args.slug);
    return h.calls.length === 1 ? success() : {
      status: 'source_failed', sourceSucceeded: false, sourceRequestCount: 1, reason: 'cooldown',
      retryAt: new Date(START + 6 * 60 * 60_000).toISOString(), diagnostics: [{ stage: 'token', status: 403, cfMitigated: 'challenge' }],
    };
  } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.published, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.notAttempted, 36);
  assert.equal(result.results.length, 38);
  assert.equal(result.sourceRequestCount, 3);
  assert.equal(result.results[1].diagnostics[0].challenge, true);
  assert.equal(result.sourceValidated, false);
  assert.equal(h.calls.length, 2);
  const replay = await h.run();
  assert.equal(replay.exitCode, 1);
  assert.equal(replay.replayed, true);
  assert.equal(replay.sourceRequestCount, 0);
  assert.equal(h.calls.length, 2);
});

test('publication failure records source success and failed publication independently', async () => {
  const h = harness();
  const result = await h.run({ collectorImpl: async () => ({ ...success(),
    status: 'publication_failed', reason: 'publication_failed' }) });
  assert.equal(result.exitCode, 1);
  assert.equal(result.sourceSucceeded, 1);
  assert.equal(result.published, 0);
  assert.equal(result.failed, 1);
  // The stopped round leaves 37 branches unvalidated, so the run is not validated.
  assert.equal(result.notAttempted, 37);
  assert.equal(result.sourceValidated, false);
});

for (const reason of ['busy', 'cooldown', 'disabled']) {
  test(`existing ${reason} is an explicit zero-source skip`, async () => {
    const h = harness();
    const result = await h.run({ collectorImpl: async () => ({ status: 'not_attempted', sourceSucceeded: false,
      sourceRequestCount: 0, reason }) });
    assert.equal(result.exitCode, 3);
    assert.equal(result.outcome, 'skipped');
    assert.equal(result.sourceRequestCount, 0);
    assert.equal(result.notAttempted, 38);
    assert.equal(result.sourceValidated, false);
  });
}

test('a skip after a successful branch remains a partially failed run', async () => {
  const h = harness(); let count = 0;
  const result = await h.run({ collectorImpl: async () => ++count === 1 ? success() : {
    status: 'not_attempted', sourceSucceeded: false, sourceRequestCount: 0, reason: 'disabled',
  } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.published, 1);
  assert.equal(result.notAttempted, 37);
});

test('invalid modes, scopes, identity or targets fail before any storage or source access', async () => {
  // Retired rollout modes and scopes are rejected like any other unknown value.
  for (const options of [{ scope: 'unknown' }, { mode: 'probe', scope: 'all' }, { mode: 'probe-python', scope: 'single' },
    { mode: 'publish-python', scope: 'single' }, { mode: 'publish-python', scope: 'all' },
    { mode: 'publish-five-python', scope: 'five' }, { mode: 'publish-all-python', scope: 'five' },
    { mode: 'publish-all-python', scope: 'single' }, { mode: 'publish', scope: 'all' },
    { commit: 'main' }, { runId: '../1' },
    { repository: 'not-a-repository' }, { controlVersion: 'unknown' }, { mode: 'shell' },
    { target: { ...TARGET, alias: 'production' } }, { target: { ...TARGET, deployID: 'latest' } }]) {
    const h = harness();
    const result = await h.run(options);
    assert.equal(result.exitCode, 2);
    assert.equal(h.store.calls.length, 0);
    assert.equal(h.calls.length, 0);
  }
  assert.deepEqual(actionsSlugs(), Object.keys(ORANGE_BRANCHES));
  assert.equal(new Set(actionsSlugs()).size, 38);
});

test('operation identity freezes target, commit and control generation across reruns', async () => {
  const h = harness();
  await h.run();
  for (const options of [{ target: { ...TARGET, deployID: 'f'.repeat(24) } },
    { commit: 'c'.repeat(40) }, { controlVersion: uuid(3) }]) {
    const result = await h.run(options);
    assert.equal(result.exitCode, 2);
    assert.equal(result.reason, 'operation_conflict');
  }
  assert.equal(h.calls.length, 38);
  // The ledger keeps the mode/scope fields so records from before the trim stay readable.
  assert.equal(h.store.entries.get(h.key).data.identity.mode, 'publish-all-python');
  assert.equal(h.store.entries.get(h.key).data.identity.scope, 'all');
});

test('concurrent same-run and other-run requests cannot acquire an active durable job', async () => {
  const h = harness(); let resolve, entered;
  const started = new Promise(done => { entered = done; });
  const running = h.run({ collectorImpl: async args => {
    assert.equal(await args.beforeSource(), true);
    h.calls.push(args.slug);
    if (h.calls.length > 1) return success();
    entered();
    return new Promise(done => { resolve = () => done(success()); });
  } });
  await started;
  const same = await h.run();
  const other = await h.run({ runId: '5678' });
  assert.equal(same.exitCode, 3);
  assert.equal(other.exitCode, 3);
  assert.equal(same.reason, 'busy');
  assert.equal(other.reason, 'busy');
  assert.equal(h.calls.length, 1);
  resolve();
  assert.equal((await running).exitCode, 0);
});

test('completed ledger survives subsequent jobs replacing the active-job key', async () => {
  const h = harness();
  await h.run();
  await h.run({ runId: '5678' });
  assert.equal(h.calls.length, 76);
  const result = await h.run();
  assert.equal(result.replayed, true);
  assert.equal(result.attemptSourceRequestCount, 0);
  assert.equal(h.calls.length, 76);
});

test('deadline blocks a late source start, and expired same-run jobs become abandoned instead of retrying', async () => {
  const h = harness();
  const result = await h.run({ collectorImpl: async args => {
    h.advance(ACTIONS_BUDGET_MS);
    assert.equal(await args.beforeSource(), false);
    return { status: 'not_attempted', sourceSucceeded: false, sourceRequestCount: 0, reason: 'deadline' };
  } });
  assert.equal(result.sourceRequestCount, 0);
  const next = harness();
  await next.run();
  const original = next.store.entries.get(next.key).data;
  next.store.seed(next.key, { ...original, status: 'running', completedAtMs: null, exitCode: null });
  next.advance(ACTIONS_BUDGET_MS + 1);
  const abandoned = await next.run();
  assert.equal(abandoned.exitCode, 3);
  assert.equal(abandoned.reason, 'operation_abandoned');
  assert.equal(next.store.entries.get(next.key).data.status, 'abandoned');
  assert.equal(next.calls.length, 38);
});

test('external cancellation stops a pending source and all subsequent branches', async () => {
  const h = harness(), controller = new AbortController();
  const result = await h.run({ signal: controller.signal, collectorImpl: async args => {
    assert.equal(await args.beforeSource(), true);
    controller.abort('PRIVATE_ABORT_SECRET');
    assert.equal(args.signal.aborted, true);
    assert.equal(await args.beforePublish(), false);
    return { status: 'source_unknown', sourceSucceeded: false, sourceRequestCount: 1, reason: 'aborted' };
  } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.notAttempted, 37);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ABORT_SECRET/);
});

test('pre-aborted invocation never creates an operation or contacts the collector', async () => {
  const h = harness(), controller = new AbortController(); controller.abort();
  const result = await h.run({ signal: controller.signal });
  assert.equal(result.exitCode, 1);
  assert.equal(result.reason, 'aborted');
  assert.equal(h.store.calls.length, 0);
  assert.equal(h.calls.length, 0);
});

test('loss of job ownership prevents publishing and never releases another owner job', async () => {
  const h = harness(); let replacement;
  const result = await h.run({ collectorImpl: async args => {
    assert.equal(await args.beforeSource(), true);
    replacement = { ...h.store.entries.get(ACTIONS_JOB_KEY).data, ownerId: uuid(99) };
    h.store.seed(ACTIONS_JOB_KEY, replacement);
    assert.equal(await args.beforePublish(), false);
    return { ...success(), status: 'publication_failed', reason: 'lease_lost' };
  } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.published, 0);
  assert.deepEqual(h.store.entries.get(ACTIONS_JOB_KEY).data, replacement);
});

test('summary and persistent state exclude unknown fields, source payloads, headers and exception text', async () => {
  const h = harness();
  const result = await h.run({ target: { ...TARGET, token: 'PRIVATE_TARGET_TOKEN' }, collectorImpl: async () => ({
    ...success(), body: 'PRIVATE_PAYLOAD', authorization: 'PRIVATE_BEARER',
    diagnostics: [{ stage: 'token', status: 200, rayId: 'PRIVATE_HEADER', reason: 'PRIVATE_REASON' },
      { stage: 'rate', status: 200, authorization: 'PRIVATE_AUTH', reason: null }],
  }) });
  assert.equal(result.exitCode, 0);
  const all = JSON.stringify({ result, entries: [...h.store.entries.values()] });
  assert.doesNotMatch(all, /PRIVATE_/);
  const broken = harness();
  const failure = await broken.run({ collectorImpl: async () => { throw new Error('PRIVATE_TRANSPORT_EXCEPTION'); } });
  assert.equal(failure.exitCode, 1);
  assert.equal(failure.results[0].status, 'source_unknown');
  assert.doesNotMatch(JSON.stringify(failure), /PRIVATE_/);
});

test('invalid telemetry fails closed without crediting a fabricated source or publication success', async () => {
  // A retired probe result is no longer a valid status, so it cannot credit success either.
  for (const value of [{ ...success(), sourceRequestCount: 0 }, { ...success(), sourceRequestCount: 999 },
    { ...success(), status: 'probe_succeeded' }, { ...success(), sourceSucceeded: false }, { status: 'invented', sourceRequestCount: 2 }]) {
    const h = harness();
    const result = await h.run({ collectorImpl: async () => value });
    assert.equal(result.exitCode, 1);
    assert.equal(result.results[0].status, 'source_unknown');
    assert.equal(result.sourceValidated, false);
    assert.equal(result.published, 0);
  }
});

test('a token GET retried after a timeout counts three source requests and keeps every diagnostic', async () => {
  const retried = { ...success(3), diagnostics: [{ stage: 'token', status: null, reason: 'timeout' },
    { stage: 'token', status: 200 }, { stage: 'rate', status: 200 }] };
  const h = harness();
  const result = await h.run({ collectorImpl: async args => {
    h.calls.push({ slug: args.slug });
    return h.calls.length === 1 ? retried : success(1);
  } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.published, 38);
  assert.equal(result.sourceRequestCount, 40);
  assert.equal(result.sourceValidated, true);
  assert.equal(result.results[0].status, 'published');
  assert.equal(result.results[0].sourceRequestCount, 3);
  assert.deepEqual(result.results[0].diagnostics.map(entry => [entry.stage, entry.status, entry.reason]),
    [['token', null, 'timeout'], ['token', 200, null], ['rate', 200, null]]);
  const replay = await h.run({ collectorImpl: () => { throw new Error('must not request source again'); } });
  assert.equal(replay.exitCode, 0);
  assert.equal(replay.historicalSourceRequestCount, 40);
  for (const count of [4, 999]) {
    const over = harness();
    const rejected = await over.run({ collectorImpl: async () => ({ ...success(count) }) });
    assert.equal(rejected.results[0].status, 'source_unknown');
    assert.equal(rejected.exitCode, 1);
  }
});

test('storage failure and missing deployed ETags prevent source acquisition and hide exception content', async () => {
  const h = harness();
  h.store.getWithMetadata = async () => { throw new Error('PRIVATE_STORAGE'); };
  const failed = await h.run();
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.sourceRequestCount, 0);
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_/);
  const missing = harness();
  const write = missing.store.setJSON.bind(missing.store);
  missing.store.setJSON = async (...args) => { const result = await write(...args); delete result.etag; return result; };
  assert.equal((await missing.run()).sourceRequestCount, 0);
  assert.equal(missing.calls.length, 0);
});

test('job finalization failure is persisted as failure and replay never reports a false successful run', async () => {
  for (const mode of ['conflict', 'throw']) {
    const h = harness();
    h.store.beforeSet = ({ key, data, store }) => {
      if (key === ACTIONS_JOB_KEY && data.status === 'complete') {
        if (mode === 'throw') throw new Error('PRIVATE_JOB_STORAGE');
        store.seed(key, { ...data, status: 'running', ownerId: uuid(99) });
      }
    };
    const result = await h.run();
    assert.equal(result.exitCode, 1);
    assert.equal(result.sourceSucceeded, 38);
    assert.equal(h.store.entries.get(h.key).data.exitCode, 1);
    const replay = await h.run();
    assert.equal(replay.exitCode, 1);
    assert.equal(replay.sourceRequestCount, 0);
    assert.equal(replay.replayed, true);
    assert.equal(h.calls.length, 38);
  }
});

test('zero-source storage or cancellation failures cannot be reclassified as successful workflow skips', async () => {
  for (const reason of ['storage_unavailable', 'source_guard_unavailable', 'cancelled', 'deadline', 'unknown_outcome']) {
    const h = harness();
    const result = await h.run({ collectorImpl: async () => ({ status: 'not_attempted', sourceSucceeded: false,
      sourceRequestCount: 0, reason }) });
    assert.equal(result.exitCode, 1);
    assert.equal(result.reason, reason);
  }
});

test('cancelling during inter-branch sleep finalizes the ledger without starting the next branch', async () => {
  const h = harness(), controller = new AbortController();
  const result = await h.run({ signal: controller.signal,
    sleepImpl: async (_ms, signal) => { controller.abort(); signal.throwIfAborted(); } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.reason, 'aborted');
  assert.equal(result.published, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.store.entries.get(h.key).data.status, 'stopped');
  assert.equal(h.store.entries.get(ACTIONS_JOB_KEY).data.status, 'stopped');
});

test('a collector exception after telemetry does not erase requests or source success already observed', async () => {
  const h = harness();
  const result = await h.run({ collectorImpl: async args => {
    args.onResult(success());
    throw new Error('PRIVATE_AFTER_CALLBACK');
  } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.sourceRequestCount, 2);
  assert.equal(result.sourceSucceeded, 1);
  assert.equal(result.results[0].status, 'published');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test('corrupt terminal telemetry fails closed rather than replaying a fabricated success', async () => {
  const h = harness();
  await h.run();
  const operation = h.store.entries.get(h.key).data;
  operation.results[0].sourceRequestCount = 0;
  h.store.seed(h.key, operation);
  const result = await h.run();
  assert.equal(result.exitCode, 2);
  assert.equal(result.reason, 'operation_conflict');
  assert.equal(result.sourceValidated, false);
  assert.equal(h.calls.length, 38);
});

test('unknown source protection persistence retains observed request and parser success evidence', async () => {
  const h = harness();
  const result = await h.run({ collectorImpl: async () => ({ ...success(), status: 'source_unknown', reason: 'source_guard_unavailable' }) });
  assert.equal(result.exitCode, 1);
  assert.equal(result.results[0].status, 'source_unknown');
  assert.equal(result.sourceRequestCount, 2);
  assert.equal(result.sourceSucceeded, 1);
  assert.equal(result.published, 0);
});

test('an expired active job with a settled terminal ledger can yield to a new run without losing history', async () => {
  const h = harness();
  await h.run();
  const job = h.store.entries.get(ACTIONS_JOB_KEY).data;
  h.store.seed(ACTIONS_JOB_KEY, { ...job, status: 'running' });
  h.advance(ACTIONS_BUDGET_MS + 1);
  const next = await h.run({ runId: '5678' });
  assert.equal(next.exitCode, 0);
  const replay = await h.run();
  assert.equal(replay.replayed, true);
  assert.equal(replay.sourceRequestCount, 0);
  assert.equal(h.calls.length, 76);
});

function pendingRecord(h) {
  return { schemaVersion: 1, identity: { repository: h.input.repository, runId: h.input.runId, mode: 'publish-all-python', scope: 'all',
    commit: COMMIT, controlVersion: uuid(2), target: { ...TARGET } }, status: 'pending', ownerId: null,
    createdAtMs: START, deadlineAtMs: START + ACTIONS_BUDGET_MS, completedAtMs: null, currentSlug: null,
    results: Object.keys(ORANGE_BRANCHES).map(slug => ({ slug, status: 'not_attempted', sourceSucceeded: false,
      sourceRequestCount: 0, reason: null, retryAt: null, diagnostics: [] })), reason: null, exitCode: null };
}

test('an untouched pending intent is claimed and collected', async () => {
  const h = harness();
  h.store.seed(h.key, pendingRecord(h));
  const result = await h.run();
  assert.equal(result.exitCode, 0);
  assert.equal(result.published, 38);
});

test('pending intent must be completely untouched and cannot re-run a previously observed success', async () => {
  const mutations = [
    value => { value.results[0] = { ...value.results[0], ...success() }; },
    value => { value.ownerId = uuid(99); },
    value => { value.currentSlug = FIRST_SLUG; },
    value => { value.results[0].status = 'cache_hit'; },
    value => { value.results[0].sourceRequestCount = 1; },
    value => { value.results[0].reason = 'busy'; },
    value => { value.results[0].retryAt = new Date(START).toISOString(); },
    value => { value.results[0].diagnostics = [{ stage: 'token', status: 200, challenge: false, reason: null }]; },
    value => { value.completedAtMs = START; },
    value => { value.createdAtMs = START + 1; value.deadlineAtMs = value.createdAtMs + ACTIONS_BUDGET_MS; },
    value => { value.deadlineAtMs++; },
  ];
  for (const mutate of mutations) {
    const h = harness(), pending = pendingRecord(h);
    mutate(pending);
    h.store.seed(h.key, pending);
    const before = structuredClone(h.store.entries.get(h.key));
    const result = await h.run();
    assert.equal(result.exitCode, 2);
    assert.equal(result.reason, 'operation_conflict');
    assert.equal(result.sourceRequestCount, 0);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.store.entries.get(h.key), before);
  }
});

test('complete operation requires its owner and a plausible completion time before replay', async () => {
  for (const mutate of [value => { value.ownerId = null; }, value => { value.completedAtMs = START - 1; },
    value => { value.completedAtMs += 10_000; }, value => { value.currentSlug = FIRST_SLUG; }]) {
    const h = harness();
    await h.run();
    const value = structuredClone(h.store.entries.get(h.key).data);
    mutate(value);
    h.store.seed(h.key, value);
    const result = await h.run();
    assert.equal(result.exitCode, 2);
    assert.equal(h.calls.length, 38);
  }
});

test('persisted operation corruption during execution blocks a source hook despite matching owner fields', async () => {
  for (const mutate of [value => { value.schemaVersion = 2; }, value => { value.results[0].diagnostics = [{ accessToken: 'PRIVATE' }]; },
    value => { value.completedAtMs = START; }, value => { value.unexpected = 'PRIVATE'; }]) {
    const h = harness(); let sourceCalls = 0;
    const result = await h.run({ collectorImpl: async args => {
      const value = structuredClone(h.store.entries.get(h.key).data);
      mutate(value);
      h.store.seed(h.key, value);
      if (await args.beforeSource()) sourceCalls++;
      assert.equal(await args.beforeSource(), false);
      return { status: 'not_attempted', sourceSucceeded: false, sourceRequestCount: 0, reason: 'lease_lost' };
    } });
    assert.equal(result.exitCode, 1);
    assert.equal(sourceCalls, 0);
  }
});

test('persisted job corruption blocks publication despite matching operation and owner identifiers', async () => {
  for (const mutate of [value => { value.schemaVersion = 2; }, value => { value.unexpected = true; },
    value => { value.deadlineAtMs++; }]) {
    const h = harness(); let publications = 0;
    const result = await h.run({ collectorImpl: async args => {
      assert.equal(await args.beforeSource(), true);
      const value = structuredClone(h.store.entries.get(ACTIONS_JOB_KEY).data);
      mutate(value);
      h.store.seed(ACTIONS_JOB_KEY, value);
      if (await args.beforePublish()) publications++;
      assert.equal(await args.beforePublish(), false);
      return { ...success(), status: 'publication_failed', reason: 'lease_lost' };
    } });
    assert.equal(result.exitCode, 1);
    assert.equal(publications, 0);
  }
});

test('synchronous final continuation gate detects a deadline crossed by the last awaited read', async () => {
  const h = harness();
  const result = await h.run({ collectorImpl: async args => {
    assert.equal(await args.beforeSource(), true);
    assert.equal(await args.beforePublish(), true);
    assert.equal(args.canContinue(), true);
    h.advance(ACTIONS_BUDGET_MS);
    assert.equal(args.canContinue(), false);
    return { ...success(), status: 'publication_failed', reason: 'deadline' };
  } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.published, 0);
});
