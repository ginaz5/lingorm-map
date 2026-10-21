/**
 * Local SuperRich 1965 (orange) collector.
 *
 *   npm run fx:1965:fetch -- probe              # one branch, diagnose only
 *   npm run fx:1965:fetch -- run --dry-run      # all branches, publish nothing
 *   npm run fx:1965:fetch -- run --publish      # all branches, write the snapshot
 *
 * Every mode makes REAL source requests, so probe and dry-run share the same
 * on-disk run lock and cooldown as publish. Nothing here defeats a challenge:
 * the identifiable User-Agent stays and there is deliberately no --force.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { breakerBlocks } from '../netlify/functions/_shared/exchange-rates-1965-breaker.mjs';
import { EXCHANGE_KEYS, isValidBreaker, isValidControl } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { loadBranchMapping, runLocalExchangeRateFetch } from '../netlify/functions/_shared/exchange-rates-1965-runner.mjs';
import { collectSourceQuotes, LOCAL_SOURCE_PROFILE } from '../netlify/functions/_shared/exchange-rates-1965-source.mjs';
import { createAdminStore, readEntry } from '../netlify/functions/_shared/exchange-rates-1965-storage.mjs';

export const DEFAULT_PROBE_BRANCH_ID = 56;
export const LOCAL_STATE_DIR = new URL('../.local-state/exchange-rates-1965/', import.meta.url);
export const LOCAL_STATE_SCHEMA_VERSION = 1;

/**
 * Local cooldown after a Cloudflare challenge. Deliberately gentler than the
 * remote breaker's 6h first step: the remote ladder exists to protect a
 * scheduled fetcher that runs unattended every 30 minutes, while this ladder
 * only has to stop an operator from re-probing in a loop. Escalation still
 * reaches a full day if the source keeps refusing.
 */
export const LOCAL_BACKOFF_MS = Object.freeze({
  first: 30 * 60 * 1000,
  second: 6 * 60 * 60 * 1000,
  third: 24 * 60 * 60 * 1000,
});

const USAGE = 'Usage: npm run fx:1965:fetch -- probe [--branch <officialId>] | run --dry-run | run --publish';

/** @param {string[]} argv */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === 'probe') {
    if (rest.length === 0) return { command, publish: false, branchId: DEFAULT_PROBE_BRANCH_ID };
    if (rest.length !== 2 || rest[0] !== '--branch' || !/^\d{1,9}$/.test(rest[1]) || Number(rest[1]) <= 0) {
      throw new Error(USAGE);
    }
    return { command, publish: false, branchId: Number(rest[1]) };
  }
  if (command === 'run') {
    // Fail closed: never default to publishing, never accept both flags.
    if (rest.length !== 1 || !['--dry-run', '--publish'].includes(rest[0])) throw new Error(USAGE);
    return { command, publish: rest[0] === '--publish', branchId: null };
  }
  throw new Error(USAGE);
}

/** @param {any} state @param {number} nowMs */
export function localCooldownBlocks(state, nowMs) {
  const until = state?.cooldown?.blockedUntil;
  return typeof until === 'string' && Date.parse(until) > nowMs;
}

/**
 * @param {any} current
 * @param {{outcome:string, nowMs:number, retryAfterMs?:number|null}} event
 */
export function nextLocalCooldown(current, { outcome, nowMs, retryAfterMs = null }) {
  const base = current ?? { blockLevel: 0, blockedUntil: null, lastStatus: null, lastError: null };
  if (outcome === 'complete') {
    return { blockLevel: 0, blockedUntil: null, lastStatus: 'complete', lastError: null };
  }
  if (outcome !== 'blocked') {
    // Transient source failures are the remote breaker's business; they must
    // not lock the operator out of diagnosing them locally.
    return { ...base, lastStatus: outcome, lastError: `source_${outcome}` };
  }
  const level = Math.min(3, (base.blockLevel ?? 0) + 1);
  const ladder = level === 1 ? LOCAL_BACKOFF_MS.first : level === 2 ? LOCAL_BACKOFF_MS.second : LOCAL_BACKOFF_MS.third;
  const existingUntil = base.blockedUntil ? Date.parse(base.blockedUntil) : nowMs;
  const retryUntil = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) ? retryAfterMs : nowMs;
  const until = Math.max(nowMs + ladder, existingUntil, retryUntil);
  return { blockLevel: level, blockedUntil: new Date(until).toISOString(), lastStatus: 'blocked', lastError: 'source_blocked' };
}

/** @param {URL} stateDir */
function stateFileUrl(stateDir) {
  return new URL('state.json', stateDir);
}

/** @param {URL} stateDir */
function lockFileUrl(stateDir) {
  return new URL('run.lock', stateDir);
}

/** @param {URL} stateDir */
export async function readLocalState(stateDir) {
  try {
    const parsed = JSON.parse(await readFile(stateFileUrl(stateDir), 'utf8'));
    if (parsed?.schemaVersion !== LOCAL_STATE_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** @param {URL} stateDir @param {any} state */
export async function writeLocalState(stateDir, state) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(stateFileUrl(stateDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Atomic run lock. Never removes a lock it does not own: an abandoned lock is
 * reported with its pid and age so the operator can check the process first.
 * @param {URL} stateDir @param {{nowMs:number, pid?:number, token?:string}} input
 */
export async function acquireLock(stateDir, { nowMs, pid = process.pid, token = randomUUID() }) {
  await mkdir(stateDir, { recursive: true });
  const url = lockFileUrl(stateDir);
  let handle;
  try {
    handle = await open(url, 'wx');
  } catch (error) {
    if (/** @type {any} */ (error)?.code !== 'EEXIST') throw error;
    let holder = null;
    try { holder = JSON.parse(await readFile(url, 'utf8')); } catch { holder = null; }
    return {
      acquired: false,
      holder,
      heldForMs: holder?.startedAtMs ? nowMs - holder.startedAtMs : null,
      release: async () => {},
    };
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid, token, startedAtMs: nowMs, startedAt: new Date(nowMs).toISOString() })}\n`);
  } finally {
    await handle.close();
  }
  return {
    acquired: true,
    holder: null,
    heldForMs: null,
    release: async () => {
      try {
        const current = JSON.parse(await readFile(url, 'utf8'));
        if (current?.token !== token) return;
      } catch {
        return;
      }
      await unlink(url).catch(() => {});
    },
  };
}

/** @param {any} mapping @param {number} branchId */
function singleBranchMapping(mapping, branchId) {
  const entry = Object.entries(mapping.branches).find(([, branch]) => /** @type {any} */ (branch).officialId === branchId);
  if (!entry) throw new Error(`unknown_branch:${branchId}`);
  return { schemaVersion: mapping.schemaVersion, branches: { [entry[0]]: entry[1] } };
}

/** @param {any} collection */
function collectionSummary(collection) {
  const ok = collection.quotes.filter((/** @type {any} */ branch) => branch.quote.status === 'ok').length;
  return {
    sourceOutcome: collection.outcome,
    sourceRequestCount: collection.requestCount,
    retryUsed: collection.retryUsed,
    retryAfterMs: collection.retryAfterMs ?? null,
    profile: collection.profile?.name ?? null,
    okBranchCount: ok,
    failedBranchCount: collection.quotes.length - ok,
    branches: collection.quotes.map((/** @type {any} */ branch) => ({
      slug: branch.slug,
      officialId: branch.officialId,
      status: branch.quote.status,
      rates: Object.fromEntries(Object.entries(branch.quote.rates).map(([denom, cell]) => [
        denom,
        /** @type {any} */ (cell).rateScaledE6 === null
          ? { available: false, unavailableReason: /** @type {any} */ (cell).unavailableReason }
          : { available: true, rateScaledE6: /** @type {any} */ (cell).rateScaledE6 },
      ])),
    })),
    diagnostics: collection.diagnostics,
  };
}

/**
 * Read the production breaker so a local run honours a remote cooldown.
 * Without admin credentials this is unknowable — the caller is told so
 * explicitly rather than being allowed to assume the source is free.
 * @param {any} store @param {number} nowMs
 */
async function readRemoteCooldown(store, nowMs) {
  const controlEntry = await readEntry(store, EXCHANGE_KEYS.control);
  if (controlEntry === null || !isValidControl(controlEntry.data)) {
    return { blocked: false, blockedUntil: null, controlVersion: null };
  }
  const breakerEntry = await readEntry(store, EXCHANGE_KEYS.breaker);
  if (breakerEntry === null) return { blocked: false, blockedUntil: null, controlVersion: controlEntry.data.controlVersion };
  if (!isValidBreaker(breakerEntry.data)) throw new Error('invalid_breaker');
  return {
    blocked: breakerBlocks(breakerEntry.data, controlEntry.data.controlVersion, nowMs),
    blockedUntil: breakerEntry.data.blockedUntil,
    controlVersion: controlEntry.data.controlVersion,
  };
}

/**
 * @param {string[]} argv
 * @param {{stateDir?:URL, env?:Record<string,string|undefined>, fetchImpl?:typeof fetch, nowImpl?:()=>number, sleepImpl?:(ms:number)=>Promise<void>, randomUUIDImpl?:()=>string, createStoreImpl?:(input:{siteID:string, token:string})=>any, profile?:any, mappingInput?:unknown}} [deps]
 */
export async function runFetchCommand(argv, {
  stateDir = LOCAL_STATE_DIR,
  env = process.env,
  fetchImpl = fetch,
  nowImpl = Date.now,
  sleepImpl,
  randomUUIDImpl = randomUUID,
  createStoreImpl = createAdminStore,
  profile = LOCAL_SOURCE_PROFILE,
  mappingInput,
} = {}) {
  const { command, publish, branchId } = parseArgs(argv);
  const mode = command === 'probe' ? 'probe' : publish ? 'publish' : 'dry_run';
  const fullMapping = await loadBranchMapping(mappingInput);
  const mapping = command === 'probe'
    ? await loadBranchMapping(singleBranchMapping(fullMapping, /** @type {number} */ (branchId)))
    : fullMapping;

  const siteID = env.NETLIFY_SITE_ID;
  const token = env.NETLIFY_AUTH_TOKEN;
  const hasAdminCredentials = Boolean(siteID && token);
  // Fail before touching the source: finishing a full round and only then
  // discovering that it cannot be published wastes a source request budget.
  if (publish && !hasAdminCredentials) {
    return { ok: false, mode, status: 'skipped', reason: 'missing_credentials', sourceRequestCount: 0 };
  }

  const lock = await acquireLock(stateDir, { nowMs: nowImpl() });
  if (!lock.acquired) {
    return {
      ok: false,
      mode,
      status: 'skipped',
      reason: 'lock_held',
      sourceRequestCount: 0,
      lockHolder: lock.holder,
      lockHeldForMs: lock.heldForMs,
      hint: 'Another local collector is running. If it exited abnormally, confirm the pid is gone before deleting .local-state/exchange-rates-1965/run.lock.',
    };
  }

  try {
    const state = await readLocalState(stateDir);
    if (localCooldownBlocks(state, nowImpl())) {
      return {
        ok: false,
        mode,
        status: 'skipped',
        reason: 'local_cooldown',
        sourceRequestCount: 0,
        blockedUntil: state.cooldown.blockedUntil,
        blockLevel: state.cooldown.blockLevel,
      };
    }

    const store = hasAdminCredentials
      ? createStoreImpl({ siteID: /** @type {string} */ (siteID), token: /** @type {string} */ (token) })
      : null;
    if (store && !publish) {
      const remote = await readRemoteCooldown(store, nowImpl());
      if (remote.blocked) {
        return {
          ok: false,
          mode,
          status: 'skipped',
          reason: 'remote_cooldown',
          sourceRequestCount: 0,
          blockedUntil: remote.blockedUntil,
          remoteCooldownKnown: true,
        };
      }
    }

    const attemptedAtMs = nowImpl();
    /** @type {Record<string, any>} */
    let result;
    if (publish) {
      const run = await runLocalExchangeRateFetch({
        store,
        mapping,
        publish: true,
        fetchImpl,
        nowImpl,
        ...(sleepImpl ? { sleepImpl } : {}),
        randomUUIDImpl,
        functionStartedAtMs: attemptedAtMs,
        profile,
      });
      result = { ...run, ok: run.status === 'published', remoteCooldownKnown: true };
    } else if (store) {
      const run = await runLocalExchangeRateFetch({
        store,
        mapping,
        publish: false,
        fetchImpl,
        nowImpl,
        ...(sleepImpl ? { sleepImpl } : {}),
        randomUUIDImpl,
        functionStartedAtMs: attemptedAtMs,
        profile,
      });
      result = { ...run, mode, ok: run.status === 'collected', remoteCooldownKnown: true };
    } else {
      const collection = await collectSourceQuotes({
        mapping,
        fetchImpl,
        nowImpl,
        ...(sleepImpl ? { sleepImpl } : {}),
        functionStartedAtMs: attemptedAtMs,
        profile,
      });
      const summary = collectionSummary(collection);
      result = {
        ...summary,
        mode,
        status: collection.outcome === 'blocked' ? 'blocked' : collection.outcome === 'complete' ? 'collected' : 'not_published',
        ...(collection.outcome === 'blocked' ? { reason: 'source_blocked' } : {}),
        ok: collection.outcome === 'complete',
        remoteCooldownKnown: false,
        warning: 'No admin credentials: a remote breaker cooldown cannot be seen from here. This does not mean the source is free.',
      };
    }

    const completedAtMs = nowImpl();
    const cooldown = nextLocalCooldown(state?.cooldown, {
      outcome: result.sourceOutcome ?? 'failed',
      nowMs: completedAtMs,
      // Honour the source's own Retry-After when it asks for longer than our
      // ladder. Dropping it made the local cooldown ignore the one back-off
      // instruction the source actually sends.
      retryAfterMs: result.retryAfterMs ?? null,
    });
    await writeLocalState(stateDir, {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      cooldown,
      lastAttempt: {
        mode,
        status: result.status,
        reason: result.reason ?? null,
        attemptedAt: new Date(attemptedAtMs).toISOString(),
        completedAt: new Date(completedAtMs).toISOString(),
        sourceOutcome: result.sourceOutcome ?? null,
        sourceRequestCount: result.sourceRequestCount ?? 0,
        okBranchCount: result.okBranchCount ?? 0,
        failedBranchCount: result.failedBranchCount ?? 0,
        diagnostics: result.diagnostics ?? [],
      },
    });
    return { ...result, localCooldown: cooldown };
  } finally {
    await lock.release();
  }
}

async function main() {
  try {
    const result = await runFetchCommand(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Local exchange-rate fetch failed.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
