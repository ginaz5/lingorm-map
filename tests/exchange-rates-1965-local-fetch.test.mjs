import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  createLastAttempt, EXCHANGE_KEYS, isValidLastAttempt, isValidSnapshot,
  MAX_ATTEMPT_DIAGNOSTICS, resolveFetchMode, sanitizeDiagnostics,
} from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { writeLastAttempt } from '../netlify/functions/_shared/exchange-rates-1965-runner.mjs';
import {
  LOCAL_SOURCE_PROFILE, NETLIFY_SOURCE_PROFILE, resolveSourceProfile,
} from '../netlify/functions/_shared/exchange-rates-1965-source.mjs';
import { logExchangeRateFetchResult, resolveScheduledFetchMode } from '../netlify/functions/exchange-rates-1965-fetch.mjs';
import {
  acquireLock, LOCAL_BACKOFF_MS, nextLocalCooldown, parseArgs, readLocalState, runFetchCommand, writeLocalState,
} from '../scripts/exchange-rates-1965-fetch.mjs';
import { enabledControl, FakeBlobStore, jsonResponse, uuid } from './helpers/exchange-rates-store.mjs';

const START = Date.parse('2026-09-11T00:00:00Z');

async function stateDir() {
  const dir = await mkdtemp(join(tmpdir(), 'fx1965-'));
  return pathToFileURL(`${dir}/`);
}

function mapping() {
  return {
    schemaVersion: 1,
    branches: {
      'superrich1965-56': { officialId: 56, branchNo: '00', companyCode: 'A04' },
      'superrich1965-57': { officialId: 57, branchNo: '35', companyCode: 'A04' },
    },
  };
}

function sourcePayload(updatedAt = START) {
  return {
    status_code: 200,
    code: 'SUCCESS',
    data: {
      update_time: updatedAt,
      datas: [
        { currency_code: 'USD', denom_list: [{ show_denom: '100-50', buy_rate_amount: '33.04' }] },
        { currency_code: 'TWD', denom_list: [{ show_denom: '1000-100', buy_rate_amount: '1.02' }] },
      ],
    },
  };
}

function clock(start = START) {
  let value = start;
  return { now: () => value, sleep: async (/** @type {number} */ ms) => { value += ms; } };
}

function challengeResponse() {
  return jsonResponse('<html>Just a moment...</html>', 403, {
    'cf-mitigated': 'challenge',
    'content-type': 'text/html; charset=UTF-8',
    'cf-ray': 'a3971d9499035cd4-CMH',
  });
}

/** Store seeded with an enabled control, as a real production store would be. */
function seededStore(version = uuid(1)) {
  const store = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, enabledControl(version, START - 60_000));
  return store;
}

function setCalls(store) {
  return store.calls.filter(call => call.operation === 'set');
}

const env = { NETLIFY_SITE_ID: 'site', NETLIFY_AUTH_TOKEN: 'token' };

test('argument parsing fails closed and never defaults to publishing', () => {
  assert.deepEqual(parseArgs(['probe']), { command: 'probe', publish: false, branchId: 56 });
  assert.deepEqual(parseArgs(['probe', '--branch', '77']), { command: 'probe', publish: false, branchId: 77 });
  assert.deepEqual(parseArgs(['run', '--dry-run']), { command: 'run', publish: false, branchId: null });
  assert.deepEqual(parseArgs(['run', '--publish']), { command: 'run', publish: true, branchId: null });

  for (const argv of [[], ['run'], ['run', '--dry-run', '--publish'], ['run', '--publish', '--extra'],
    ['publish'], ['probe', '--branch'], ['probe', '--branch', '0'], ['probe', '--publish'],
    ['run', '--dryrun'], ['probe', 'extra']]) {
    assert.throws(() => parseArgs(argv), /Usage/, `expected ${JSON.stringify(argv)} to fail closed`);
  }
});

test('netlify pacing defaults are unchanged and the local profile is slower', () => {
  assert.deepEqual({ ...resolveSourceProfile() }, { ...NETLIFY_SOURCE_PROFILE });
  assert.equal(NETLIFY_SOURCE_PROFILE.concurrency, 2);
  assert.equal(NETLIFY_SOURCE_PROFILE.minStartGapMs, 200);
  assert.equal(NETLIFY_SOURCE_PROFILE.requestTimeoutMs, 5_000);
  assert.equal(NETLIFY_SOURCE_PROFILE.deadlineMs, 25_000);

  assert.equal(LOCAL_SOURCE_PROFILE.concurrency, 1);
  assert.equal(LOCAL_SOURCE_PROFILE.minStartGapMs, 1_500);
  assert.equal(LOCAL_SOURCE_PROFILE.requestTimeoutMs, 5_000);
  assert.equal(LOCAL_SOURCE_PROFILE.deadlineMs, 180_000);

  // Explicit overrides still win, so existing callers keep their behaviour.
  const overridden = resolveSourceProfile('local', { sourceDeadlineMs: 1_000, requestTimeoutMs: 250 });
  assert.equal(overridden.deadlineMs, 1_000);
  assert.equal(overridden.requestTimeoutMs, 250);
  assert.throws(() => resolveSourceProfile('nope'), /invalid_source_profile/);
  assert.throws(() => resolveSourceProfile('local', { sourceDeadlineMs: 0 }), /invalid_source_profile/);
});

test('local profile paces one request at a time with a 1.5s start gap', async () => {
  const dir = await stateDir();
  const time = clock();
  const starts = [];
  let inFlight = 0;
  const fetchImpl = async () => {
    starts.push(time.now());
    assert.equal(++inFlight, 1, 'local profile must not overlap requests');
    inFlight -= 1;
    return jsonResponse(sourcePayload());
  };

  const result = await runFetchCommand(['run', '--dry-run'], {
    stateDir: dir, env: {}, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep, mappingInput: mapping(),
  });

  assert.equal(result.status, 'collected');
  assert.equal(result.sourceRequestCount, 2);
  assert.equal(starts[1] - starts[0], 1_500);
  assert.equal(result.remoteCooldownKnown, false);
  assert.match(result.warning, /admin credentials/);
});

test('probe stops on the first challenge, writes nothing remote, and records a local cooldown', async () => {
  const dir = await stateDir();
  const time = clock();
  const store = seededStore();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return challengeResponse(); };

  const result = await runFetchCommand(['probe'], {
    stateDir: dir,
    env,
    fetchImpl,
    nowImpl: time.now,
    sleepImpl: time.sleep,
    createStoreImpl: () => store,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'source_blocked');
  assert.equal(result.mode, 'probe');
  assert.equal(calls, 1, 'one source request, no retry');
  assert.equal(result.sourceRequestCount, 1);
  assert.equal(result.retryUsed, false);
  assert.deepEqual(setCalls(store), [], 'probe must not write control, breaker or snapshot');
  assert.equal(result.diagnostics[0].cfMitigated, 'challenge');
  assert.equal(result.diagnostics[0].status, 403);

  const state = await readLocalState(dir);
  assert.equal(state.cooldown.blockLevel, 1);
  assert.equal(Date.parse(state.cooldown.blockedUntil), time.now() + LOCAL_BACKOFF_MS.first);
  assert.equal(state.lastAttempt.mode, 'probe');
});

test('a live local cooldown and a held lock both stop the run before any source request', async () => {
  const dir = await stateDir();
  const time = clock();
  const fetchImpl = async () => { throw new Error('must not reach the source'); };

  await writeLocalState(dir, {
    schemaVersion: 1,
    cooldown: { blockLevel: 1, blockedUntil: new Date(START + 60_000).toISOString(), lastStatus: 'blocked', lastError: 'source_blocked' },
    lastAttempt: null,
  });
  const cooled = await runFetchCommand(['probe'], {
    stateDir: dir, env: {}, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
  });
  assert.equal(cooled.status, 'skipped');
  assert.equal(cooled.reason, 'local_cooldown');
  assert.equal(cooled.sourceRequestCount, 0);
  assert.equal(cooled.ok, false);

  const held = await acquireLock(dir, { nowMs: START });
  assert.equal(held.acquired, true);
  const overlapped = await runFetchCommand(['run', '--dry-run'], {
    stateDir: dir, env: {}, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep, mappingInput: mapping(),
  });
  assert.equal(overlapped.status, 'skipped');
  assert.equal(overlapped.reason, 'lock_held');
  assert.equal(overlapped.sourceRequestCount, 0);
  assert.equal(overlapped.lockHolder.pid, process.pid);

  // A foreign lock is reported, never silently removed.
  const stillHeld = JSON.parse(await readFile(new URL('run.lock', dir), 'utf8'));
  assert.equal(stillHeld.pid, process.pid);
  await held.release();
});

test('a remote breaker cooldown stops a dry run, and missing credentials say so', async () => {
  const dir = await stateDir();
  const time = clock();
  const store = seededStore();
  store.seed(EXCHANGE_KEYS.breaker, {
    controlVersion: uuid(1),
    consecutiveFailedRuns: 0,
    blockLevel: 1,
    blockedUntil: new Date(START + 3_600_000).toISOString(),
    lastStatus: 'blocked',
    lastError: 'source_blocked',
  });
  const fetchImpl = async () => { throw new Error('must not reach the source'); };

  const blocked = await runFetchCommand(['run', '--dry-run'], {
    stateDir: dir, env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => store, mappingInput: mapping(),
  });
  assert.equal(blocked.status, 'skipped');
  assert.equal(blocked.reason, 'remote_cooldown');
  assert.equal(blocked.remoteCooldownKnown, true);
  assert.equal(blocked.sourceRequestCount, 0);
  assert.deepEqual(setCalls(store), []);

  const publishAttempt = await runFetchCommand(['run', '--publish'], {
    stateDir: await stateDir(), env: {}, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep, mappingInput: mapping(),
  });
  assert.equal(publishAttempt.status, 'skipped');
  assert.equal(publishAttempt.reason, 'missing_credentials');
  assert.equal(publishAttempt.sourceRequestCount, 0);
});

test('a successful dry run verifies every branch and leaves the remote store untouched', async () => {
  const dir = await stateDir();
  const time = clock();
  const store = seededStore();
  store.seed(EXCHANGE_KEYS.snapshot, { untouched: true });
  const fetchImpl = async () => jsonResponse(sourcePayload());

  const result = await runFetchCommand(['run', '--dry-run'], {
    stateDir: dir, env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => store, mappingInput: mapping(),
  });

  assert.equal(result.status, 'collected');
  assert.equal(result.ok, true);
  assert.equal(result.sourceOutcome, 'complete');
  assert.equal(result.okBranchCount, 2);
  assert.equal(result.failedBranchCount, 0);
  assert.equal(result.snapshotModified, false);
  assert.equal(result.breakerModified, false);
  assert.deepEqual(setCalls(store), [], 'dry run writes no snapshot, control or breaker');
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.snapshot).data, { untouched: true });
  assert.equal(typeof result.expiresAt, 'string');
  assert.ok(result.remainingValidityMs > 0);
});

test('publishing writes the snapshot only on a complete round and clears the breaker', async () => {
  const dir = await stateDir();
  const time = clock();
  const store = seededStore();
  const fetchImpl = async () => jsonResponse(sourcePayload());

  const result = await runFetchCommand(['run', '--publish'], {
    stateDir: dir, env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => store, randomUUIDImpl: () => uuid(9), mappingInput: mapping(),
  });

  assert.equal(result.status, 'published');
  assert.equal(result.ok, true);
  assert.equal(result.snapshotModified, true);
  const snapshot = store.entries.get(EXCHANGE_KEYS.snapshot).data;
  assert.ok(isValidSnapshot(snapshot));
  assert.equal(snapshot.controlVersion, uuid(1));
  assert.equal(snapshot.okBranchCount, 2);
  assert.equal(snapshot.branches[0].rates.USD_1965.rateScaledE6, 33_040_000);

  const attempt = store.entries.get(EXCHANGE_KEYS.lastAttempt).data;
  assert.ok(isValidLastAttempt(attempt));
  assert.equal(attempt.result, 'published');
  assert.equal(attempt.mode, 'publish');
  assert.equal(attempt.sourceOutcome, 'complete');
  assert.equal(attempt.reason, null);
});

test('a challenged publish keeps the old snapshot, trips the breaker and records the failure', async () => {
  const dir = await stateDir();
  const time = clock();
  const store = seededStore();
  const previous = { kept: 'previous-snapshot' };
  store.seed(EXCHANGE_KEYS.snapshot, previous);
  const fetchImpl = async () => challengeResponse();

  const result = await runFetchCommand(['run', '--publish'], {
    stateDir: dir, env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => store, randomUUIDImpl: () => uuid(9), mappingInput: mapping(),
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'source_blocked');
  assert.equal(result.ok, false);
  assert.equal(result.snapshotModified, false);
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.snapshot).data, previous, 'old rates must survive untouched');

  const breaker = store.entries.get(EXCHANGE_KEYS.breaker).data;
  assert.equal(breaker.blockLevel, 1);
  assert.equal(breaker.lastStatus, 'blocked');
  const attempt = store.entries.get(EXCHANGE_KEYS.lastAttempt).data;
  assert.equal(attempt.result, 'blocked');
  assert.equal(attempt.runId, null, 'a blocked run never claims a published run id');
});

test('a partial round publishes nothing but still records breaker and summary', async () => {
  const dir = await stateDir();
  const time = clock();
  const store = seededStore();
  store.seed(EXCHANGE_KEYS.snapshot, { kept: true });
  let call = 0;
  const fetchImpl = async () => (++call === 1 ? jsonResponse(sourcePayload()) : jsonResponse({ code: 'NOPE' }, 404));

  const result = await runFetchCommand(['run', '--publish'], {
    stateDir: dir, env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => store, randomUUIDImpl: () => uuid(9), mappingInput: mapping(),
  });

  assert.equal(result.status, 'not_published');
  assert.equal(result.reason, 'source_partial');
  assert.equal(result.sourceOutcome, 'partial');
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.snapshot).data, { kept: true });
  assert.equal(store.entries.get(EXCHANGE_KEYS.lastAttempt).data.result, 'not_published');
  assert.equal(store.entries.get(EXCHANGE_KEYS.breaker).data.lastStatus, 'partial');
});

test('an ETag conflict is not a publish and never resets the breaker', async () => {
  const dir = await stateDir();
  const time = clock();
  const store = seededStore();
  store.seed(EXCHANGE_KEYS.snapshot, { older: true });
  store.seed(EXCHANGE_KEYS.breaker, {
    controlVersion: uuid(1), consecutiveFailedRuns: 0, blockLevel: 1,
    blockedUntil: null, lastStatus: 'blocked', lastError: 'source_blocked',
  });
  store.beforeSet = async ({ key, store: current }) => {
    if (key !== EXCHANGE_KEYS.snapshot) return;
    current.beforeSet = null;
    current.seed(EXCHANGE_KEYS.snapshot, { writtenByAnotherCollector: true });
  };
  const fetchImpl = async () => jsonResponse(sourcePayload());

  const result = await runFetchCommand(['run', '--publish'], {
    stateDir: dir, env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => store, randomUUIDImpl: () => uuid(9), mappingInput: mapping(),
  });

  assert.equal(result.status, 'not_published');
  assert.equal(result.reason, 'snapshot_conflict');
  assert.equal(result.snapshotModified, false);
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.snapshot).data, { writtenByAnotherCollector: true });
  assert.equal(store.entries.get(EXCHANGE_KEYS.breaker).data.blockLevel, 1, 'breaker must not be cleared by a failed write');
});

test('a complete round that finishes after expiry is not published', async () => {
  const dir = await stateDir();
  const time = clock(Date.parse('2026-09-11T00:29:00Z'));
  const store = seededStore();
  store.seed(EXCHANGE_KEYS.snapshot, { kept: true });
  const fetchImpl = async () => jsonResponse(sourcePayload());

  const result = await runFetchCommand(['run', '--publish'], {
    stateDir: dir, env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => store, randomUUIDImpl: () => uuid(9), mappingInput: mapping(),
    // 200s between request starts pushes the round past nextUpdateAt + 90s.
    profile: { name: 'slow', concurrency: 1, minStartGapMs: 200_000, requestTimeoutMs: 5_000, deadlineMs: 600_000 },
  });

  assert.equal(result.status, 'not_published');
  assert.equal(result.reason, 'snapshot_expired');
  assert.equal(result.sourceOutcome, 'complete');
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.snapshot).data, { kept: true });
});

test('a control change during the round abandons the run without writing', async () => {
  const dir = await stateDir();
  const time = clock();
  const store = seededStore();
  store.seed(EXCHANGE_KEYS.snapshot, { kept: true });
  let call = 0;
  const fetchImpl = async () => {
    if (++call === 2) store.seed(EXCHANGE_KEYS.control, enabledControl(uuid(2), time.now()));
    return jsonResponse(sourcePayload());
  };

  const result = await runFetchCommand(['run', '--publish'], {
    stateDir: dir, env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => store, randomUUIDImpl: () => uuid(9), mappingInput: mapping(),
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'stale_control');
  assert.deepEqual(setCalls(store), [], 'nothing may be written under a newer control version');
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.snapshot).data, { kept: true });
});

test('publishing requires an existing enabled control and never creates one', async () => {
  const time = clock();
  const fetchImpl = async () => { throw new Error('must not reach the source'); };

  const empty = new FakeBlobStore();
  const missing = await runFetchCommand(['run', '--publish'], {
    stateDir: await stateDir(), env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => empty, mappingInput: mapping(),
  });
  assert.equal(missing.status, 'skipped');
  assert.equal(missing.reason, 'control_missing');
  assert.deepEqual(setCalls(empty), [], 'a missing control is never auto-created');

  const disabled = new FakeBlobStore();
  disabled.seed(EXCHANGE_KEYS.control, {
    enabled: false, controlVersion: uuid(1), enabledAt: new Date(START).toISOString(),
    changedAt: new Date(START).toISOString(), disabledReason: 'manual',
    disabledAt: new Date(START).toISOString(), updatedBy: 'manual',
  });
  const off = await runFetchCommand(['run', '--publish'], {
    stateDir: await stateDir(), env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => disabled, mappingInput: mapping(),
  });
  assert.equal(off.status, 'skipped');
  assert.equal(off.reason, 'manual');
  assert.deepEqual(setCalls(disabled), []);
});

test('the local cooldown ladder escalates on challenge and resets on a complete round', () => {
  const first = nextLocalCooldown(null, { outcome: 'blocked', nowMs: START });
  assert.equal(first.blockLevel, 1);
  assert.equal(Date.parse(first.blockedUntil), START + LOCAL_BACKOFF_MS.first);

  const second = nextLocalCooldown(first, { outcome: 'blocked', nowMs: START + LOCAL_BACKOFF_MS.first });
  assert.equal(second.blockLevel, 2);
  const third = nextLocalCooldown(second, { outcome: 'blocked', nowMs: START + LOCAL_BACKOFF_MS.second });
  assert.equal(third.blockLevel, 3);
  const fourth = nextLocalCooldown(third, { outcome: 'blocked', nowMs: START + LOCAL_BACKOFF_MS.third });
  assert.equal(fourth.blockLevel, 3, 'the ladder stops escalating at level 3');

  // Retry-After wins when it is further out than the ladder.
  const respected = nextLocalCooldown(null, { outcome: 'blocked', nowMs: START, retryAfterMs: START + 99_999_999 });
  assert.equal(Date.parse(respected.blockedUntil), START + 99_999_999);

  assert.deepEqual(nextLocalCooldown(third, { outcome: 'complete', nowMs: START }), {
    blockLevel: 0, blockedUntil: null, lastStatus: 'complete', lastError: null,
  });
  // A transient failure must not lock the operator out of diagnosing it.
  assert.equal(nextLocalCooldown(null, { outcome: 'partial', nowMs: START }).blockedUntil, null);
});

test('an older run never overwrites a newer stored summary', async () => {
  const store = new FakeBlobStore();
  const newer = createLastAttempt({
    mode: 'publish', result: 'published', attemptedAtMs: START + 60_000, completedAtMs: START + 61_000,
  });
  store.seed(EXCHANGE_KEYS.lastAttempt, newer);

  const older = createLastAttempt({
    mode: 'publish', result: 'blocked', attemptedAtMs: START, completedAtMs: START + 1_000, reason: 'source_blocked',
  });
  const result = await writeLastAttempt(store, older);
  assert.equal(result.modified, false);
  assert.equal(result.skipped, 'newer_attempt_recorded');
  assert.deepEqual(store.entries.get(EXCHANGE_KEYS.lastAttempt).data, newer);

  const latest = createLastAttempt({
    mode: 'publish', result: 'published', attemptedAtMs: START + 120_000, completedAtMs: START + 121_000,
  });
  assert.equal((await writeLastAttempt(store, latest)).modified, true);
});

test('run summaries stay bounded and never carry a raw response', () => {
  const diagnostics = Array.from({ length: 20 }, (_, index) => ({
    officialId: index + 1, status: 403, cfMitigated: 'challenge',
    contentType: 'text/html', retryAfter: null, rayId: 'r'.repeat(500), body: '<html>secret</html>',
  }));
  const clean = sanitizeDiagnostics(diagnostics);
  assert.equal(clean.length, MAX_ATTEMPT_DIAGNOSTICS);
  assert.equal(clean[0].rayId.length, 100);
  assert.equal('body' in clean[0], false);

  const attempt = createLastAttempt({
    mode: 'publish', result: 'blocked', attemptedAtMs: START, completedAtMs: START,
    reason: 'source_blocked', diagnostics,
  });
  assert.equal(attempt.diagnostics.length, MAX_ATTEMPT_DIAGNOSTICS);
  assert.ok(isValidLastAttempt(attempt));
  assert.throws(() => createLastAttempt({
    mode: 'publish', result: 'published', attemptedAtMs: START, completedAtMs: START, reason: 'Not A Code',
  }), /Invalid attempt reason/);
});

test('fetch mode gates the scheduled function without touching the public switch', async () => {
  assert.equal(resolveFetchMode(undefined), 'netlify');
  assert.equal(resolveFetchMode(''), 'netlify');
  assert.equal(resolveFetchMode('netlify'), 'netlify');
  assert.equal(resolveFetchMode('local'), 'local');
  assert.throws(() => resolveFetchMode('true'), /must be netlify or local/);

  const errors = [];
  const logger = { error: message => errors.push(JSON.parse(message)) };
  assert.deepEqual(resolveScheduledFetchMode({ fetchMode: 'local' }, logger), { mode: 'local', valid: true });
  assert.deepEqual(resolveScheduledFetchMode({ fetchMode: 'sheet' }, logger), { mode: null, valid: false });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].reason, 'invalid_fetch_mode');
  assert.equal(errors[0].sourceRequestCount, 0);

  const info = [];
  const skipLogger = { info: message => info.push(JSON.parse(message)), error: () => assert.fail('expected INFO') };
  logExchangeRateFetchResult({ status: 'skipped', reason: 'external_fetcher', sourceRequestCount: 0 }, skipLogger);
  assert.equal(info[0].reason, 'external_fetcher');
  // Any other skip is still an error: only the configured hand-off is routine.
  const mixed = { info: [], error: [] };
  logExchangeRateFetchResult({ status: 'skipped', reason: 'stale_control' }, {
    info: message => mixed.info.push(JSON.parse(message)),
    error: message => mixed.error.push(JSON.parse(message)),
  });
  assert.equal(mixed.info.length, 0);
  assert.equal(mixed.error.length, 1);
});

test('the local mode scheduled function returns before creating a store', async () => {
  const { default: exchangeRatesFetch } = await import('../netlify/functions/exchange-rates-1965-fetch.mjs');
  const previous = process.env.EXCHANGE_RATES_1965_FETCH_MODE;
  const logged = [];
  const originalLog = console.log;
  console.log = message => logged.push(JSON.parse(message));
  process.env.EXCHANGE_RATES_1965_FETCH_MODE = 'local';
  try {
    // No Netlify Blobs configuration is available here: reaching the store
    // would throw, so returning cleanly proves the early exit.
    await exchangeRatesFetch(new Request('https://example.invalid/'), { deploy: { context: 'production' } });
  } finally {
    console.log = originalLog;
    if (previous === undefined) delete process.env.EXCHANGE_RATES_1965_FETCH_MODE;
    else process.env.EXCHANGE_RATES_1965_FETCH_MODE = previous;
  }
  assert.equal(logged.length, 1);
  assert.equal(logged[0].status, 'skipped');
  assert.equal(logged[0].reason, 'external_fetcher');
  assert.equal(logged[0].sourceRequestCount, 0);
});

// --- Regressions for the four reproduced defects (2026-09-11 review) ---

test('a dry run that collected no usable rates is not reported as success', async () => {
  const time = clock();
  const store = seededStore();
  const failing = async () => jsonResponse({ code: 'NOPE' }, 404);

  const allFailed = await runFetchCommand(['run', '--dry-run'], {
    stateDir: await stateDir(), env, fetchImpl: failing, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => store, mappingInput: mapping(),
  });
  assert.equal(allFailed.sourceOutcome, 'failed');
  assert.equal(allFailed.status, 'not_published');
  assert.equal(allFailed.reason, 'source_failed');
  assert.equal(allFailed.ok, false);
  assert.equal(allFailed.okBranchCount, 0);
  assert.deepEqual(setCalls(store), []);

  let call = 0;
  const half = async () => (++call === 1 ? jsonResponse(sourcePayload()) : jsonResponse({ code: 'NOPE' }, 404));
  const partial = await runFetchCommand(['run', '--dry-run'], {
    stateDir: await stateDir(), env, fetchImpl: half, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => store, mappingInput: mapping(),
  });
  assert.equal(partial.sourceOutcome, 'partial');
  assert.equal(partial.status, 'not_published');
  assert.equal(partial.reason, 'source_partial');
  assert.equal(partial.ok, false);

  // The storeless path (no admin credentials) must agree.
  const storeless = await runFetchCommand(['run', '--dry-run'], {
    stateDir: await stateDir(), env: {}, fetchImpl: failing, nowImpl: time.now, sleepImpl: time.sleep,
    mappingInput: mapping(),
  });
  assert.equal(storeless.status, 'not_published');
  assert.equal(storeless.ok, false);
});

test('the local cooldown honours a Retry-After longer than the ladder', async () => {
  const dir = await stateDir();
  const time = clock();
  const retryAfterSeconds = 7_200; // 2h — longer than the 30min first step
  const fetchImpl = async () => jsonResponse('slow down', 429, { 'retry-after': String(retryAfterSeconds) });

  const result = await runFetchCommand(['probe'], {
    stateDir: dir, env: {}, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.retryAfterMs, START + retryAfterSeconds * 1_000);
  const state = await readLocalState(dir);
  assert.equal(
    Date.parse(state.cooldown.blockedUntil),
    START + retryAfterSeconds * 1_000,
    'Retry-After must win over the local ladder',
  );
  assert.ok(Date.parse(state.cooldown.blockedUntil) > START + LOCAL_BACKOFF_MS.first);
});

test('probe and dry run still work while the public control is disabled or absent', async () => {
  const time = clock();
  const fetchImpl = async () => jsonResponse(sourcePayload());

  const disabled = new FakeBlobStore();
  disabled.seed(EXCHANGE_KEYS.control, {
    enabled: false, controlVersion: uuid(1), enabledAt: new Date(START).toISOString(),
    changedAt: new Date(START).toISOString(), disabledReason: 'source_review',
    disabledAt: new Date(START).toISOString(), updatedBy: 'manual',
  });
  const probed = await runFetchCommand(['probe'], {
    stateDir: await stateDir(), env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => disabled,
  });
  assert.equal(probed.status, 'collected', 'a diagnostic run is not gated by the public switch');
  assert.equal(probed.sourceRequestCount, 1);
  assert.equal(probed.ok, true);
  assert.deepEqual(setCalls(disabled), [], 'probe still writes nothing remote');

  const empty = new FakeBlobStore();
  const withoutControl = await runFetchCommand(['run', '--dry-run'], {
    stateDir: await stateDir(), env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => empty, mappingInput: mapping(),
  });
  assert.equal(withoutControl.status, 'collected');
  assert.equal(withoutControl.controlVersion, null);
  assert.deepEqual(setCalls(empty), []);

  // Publishing keeps both guards.
  const blockedPublish = await runFetchCommand(['run', '--publish'], {
    stateDir: await stateDir(), env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => disabled, mappingInput: mapping(),
  });
  assert.equal(blockedPublish.status, 'skipped');
  assert.equal(blockedPublish.reason, 'source_review');

  // A disabled control still means its live cooldown applies to diagnostics.
  disabled.seed(EXCHANGE_KEYS.breaker, {
    controlVersion: uuid(1), consecutiveFailedRuns: 0, blockLevel: 1,
    blockedUntil: new Date(time.now() + 3_600_000).toISOString(), lastStatus: 'blocked', lastError: 'source_blocked',
  });
  const cooled = await runFetchCommand(['probe'], {
    stateDir: await stateDir(), env, fetchImpl: async () => { throw new Error('must not reach the source'); },
    nowImpl: time.now, sleepImpl: time.sleep, createStoreImpl: () => disabled,
  });
  assert.equal(cooled.reason, 'remote_cooldown');
  assert.equal(cooled.sourceRequestCount, 0);
});

test('expiry is judged at the write, not before the control re-read', async () => {
  const inner = seededStore();
  inner.seed(EXCHANGE_KEYS.snapshot, { kept: true });
  // 00:29:00Z → nextUpdateAt 00:30:00Z, expiresAt 00:31:30Z.
  const time = clock(Date.parse('2026-09-11T00:29:00Z'));
  let reads = 0;
  const store = {
    entries: inner.entries,
    calls: inner.calls,
    getWithMetadata: async (/** @type {any} */ ...args) => {
      // The 4th read is the post-collection control re-read; a slow round trip
      // there is exactly what the old `completedAtMs` check could not see.
      if (++reads === 4) await time.sleep(200_000);
      return inner.getWithMetadata(...args);
    },
    setJSON: (/** @type {any} */ ...args) => inner.setJSON(...args),
  };
  const fetchImpl = async () => jsonResponse(sourcePayload());

  const result = await runFetchCommand(['run', '--publish'], {
    stateDir: await stateDir(), env, fetchImpl, nowImpl: time.now, sleepImpl: time.sleep,
    createStoreImpl: () => store, randomUUIDImpl: () => uuid(9), mappingInput: mapping(),
  });

  assert.equal(result.sourceOutcome, 'complete', 'the round itself succeeded');
  assert.equal(result.status, 'not_published');
  assert.equal(result.reason, 'snapshot_expired');
  assert.ok(result.remainingValidityMs < 0, 'the reported validity reflects the write moment');
  assert.deepEqual(inner.entries.get(EXCHANGE_KEYS.snapshot).data, { kept: true });
});
