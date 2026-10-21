import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ORANGE_BRANCHES } from '../../../src/data/exchange-rates-1965-branch.js';
import { conditionalSetJSON, readEntry } from './exchange-rates-1965-storage.mjs';

export const ACTIONS_BUDGET_MS = 12 * 60_000;
export const ACTIONS_JOB_KEY = 'exchange-rates-1965/actions/job';
export const ACTIONS_SINGLE_SLUG = 'superrich1965-58';
export const ACTIONS_PILOT_SLUGS = Object.freeze([ACTIONS_SINGLE_SLUG, 'superrich1965-56', 'superrich1965-57']);
export const ACTIONS_BRANCH_STATUSES = Object.freeze([
  'cache_hit', 'probe_succeeded', 'published', 'source_failed', 'source_unknown', 'publication_failed', 'not_attempted',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;
const SAFE_REASONS = new Set(['busy', 'cooldown', 'disabled', 'stale_control', 'invalid_control', 'unavailable',
  'storage_unavailable', 'invalid_request', 'invalid_configuration', 'invalid_result', 'lease_lost', 'deadline',
  'aborted', 'unknown_outcome', 'source_blocked', 'source_failed', 'source_partial', 'paused', 'guard_missing',
  'guard_invalid', 'guard_unavailable', 'guard_busy', 'guard_paused', 'guard_cooldown', 'operation_conflict',
  'operation_abandoned', 'invalid_operation', 'publication_failed', 'http_error', 'timeout', 'invalid', 'cancelled',
  'source_guard_missing', 'source_guard_invalid', 'source_guard_unavailable', 'source_epoch_mismatch',
  'source_guard_conflict', 'lease_expired', 'invalid_guard_input']);
const SKIP_REASONS = new Set(['busy', 'cooldown', 'disabled', 'stale_control', 'paused']);
/** @param {unknown} value @returns {value is Record<string,any>} */
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {any} value */
const finiteTime = value => Number.isSafeInteger(value) && value >= 0;
/** @param {any} value */
const safeReason = value => SAFE_REASONS.has(value) ? value : 'unavailable';
/** @param {any} value */
const isoOrNull = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value ? value : null;

/** The runner accepts reviewed scopes, never a caller-supplied inventory.
 * @param {string} scope @returns {string[]}
 */
export function actionsScopeSlugs(scope) {
  const slugs = scope === 'single' ? [ACTIONS_SINGLE_SLUG] : scope === 'pilot' ? [...ACTIONS_PILOT_SLUGS]
    : scope === 'all' ? Object.keys(ORANGE_BRANCHES) : [];
  if (!slugs.length || new Set(slugs).size !== slugs.length ||
      slugs.some(slug => !Object.hasOwn(ORANGE_BRANCHES, slug)) || (scope === 'all' && slugs.length !== 38)) {
    throw new Error('invalid_configuration');
  }
  return slugs;
}

/** @param {string} repository @param {string} runId */
export const actionsOperationKey = (repository, runId) => `exchange-rates-1965/actions/operations/${repository}/${runId}`;

/** Copy the identity allowlist; credentials and extra caller fields never enter a ledger or summary.
 * @param {any} input
 */
function identityFor(input) {
  const { repository, runId, mode, scope, commit, controlVersion, target } = input;
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) ||
      typeof runId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(runId) || !SHA.test(commit ?? '') ||
      !UUID.test(controlVersion ?? '') || !['probe', 'probe-python', 'publish'].includes(mode) ||
      !['single', 'pilot', 'all'].includes(scope) || (mode !== 'publish' && scope !== 'single') || !isObject(target) ||
      (mode === 'probe-python' && target.alias !== 'preview-reviewed') ||
      !['preview-reviewed', 'production'].includes(target.alias) || !UUID.test(target.siteID ?? '') ||
      typeof target.branch !== 'string' || !/^[A-Za-z0-9_./-]{1,255}$/.test(target.branch) ||
      !SHA.test(target.commit ?? '') || !['deploy-preview', 'branch-deploy', 'production'].includes(target.context) ||
      (target.alias === 'production' ? target.context !== 'production' || target.deployID !== null
        : target.context === 'production' || !/^[0-9a-f]{24}$/.test(target.deployID ?? ''))) return null;
  return { repository, runId, mode, scope, commit, controlVersion,
    target: { alias: target.alias, siteID: target.siteID, deployID: target.deployID,
      branch: target.branch, commit: target.commit, context: target.context } };
}

/** @param {string} slug @param {string|null} [reason] */
const untouched = (slug, reason = null) => ({ slug, status: 'not_attempted', sourceSucceeded: false,
  sourceRequestCount: 0, reason, retryAt: null, diagnostics: [] });

/** Only the two HTTP stages and fixed reasons are exposed, never arbitrary headers or body text.
 * @param {unknown} value
 */
function safeDiagnostics(value) {
  return Array.isArray(value) ? value.slice(0, 2).filter(entry => isObject(entry) && ['token', 'rate'].includes(entry.stage))
    .map(entry => ({ stage: entry.stage, status: Number.isInteger(entry.status) && entry.status >= 100 && entry.status <= 599 ? entry.status : null,
      challenge: entry.cfMitigated === 'challenge' || entry.challenge === true,
      reason: entry.reason === null || entry.reason === undefined ? null : safeReason(entry.reason) })) : [];
}

/** @param {unknown} value @param {string} slug @param {string} mode */
function branchResult(value, slug, mode) {
  const invalid = { ...untouched(slug, 'invalid_result'), status: 'source_unknown' };
  if (!isObject(value) || !ACTIONS_BRANCH_STATUSES.includes(value.status) || typeof value.sourceSucceeded !== 'boolean' ||
      !Number.isSafeInteger(value.sourceRequestCount) || value.sourceRequestCount < 0 || value.sourceRequestCount > 2) return invalid;
  const success = ['probe_succeeded', 'published', 'publication_failed'].includes(value.status);
  if ((success && !value.sourceSucceeded) || (value.sourceSucceeded && !success && value.status !== 'source_unknown') ||
      (['cache_hit', 'not_attempted'].includes(value.status) && value.sourceRequestCount !== 0) ||
      (value.sourceSucceeded && value.sourceRequestCount === 0) ||
      (value.status === 'published' && mode !== 'publish') || (value.status === 'probe_succeeded' && !['probe', 'probe-python'].includes(mode))) return invalid;
  return { slug, status: value.status, sourceSucceeded: value.sourceSucceeded, sourceRequestCount: value.sourceRequestCount,
    reason: value.reason === null || value.reason === undefined ? null : safeReason(value.reason),
    retryAt: isoOrNull(value.retryAt), diagnostics: safeDiagnostics(value.diagnostics) };
}

/** @param {any} identity @param {any[]} results @param {{reason?:string|null,exitCode?:number,replayed?:boolean}} [options] */
function summarize(identity, results, { reason = null, exitCode = 0, replayed = false } = {}) {
  /** @param {string} status */
  const count = status => results.filter(result => result.status === status).length;
  const sourceRequestCount = results.reduce((total, result) => total + result.sourceRequestCount, 0);
  const sourceSucceeded = results.filter(result => result.sourceSucceeded).length;
  const requested = results.length;
  const failures = count('source_failed') + count('source_unknown') + count('publication_failed');
  const retryAt = results.map(result => result.retryAt).filter(Boolean).sort().at(-1) ?? null;
  return { schemaVersion: 1, repository: identity?.repository ?? null, runId: identity?.runId ?? null,
    commit: identity?.commit ?? null, target: identity?.target ?? null, mode: identity?.mode ?? null, scope: identity?.scope ?? null,
    requested, cacheHit: count('cache_hit'), sourceSucceeded, published: count('published'), failed: failures,
    notAttempted: count('not_attempted'), sourceRequestCount: replayed ? 0 : sourceRequestCount,
    attemptSourceRequestCount: replayed ? 0 : sourceRequestCount,
    ...(replayed ? { historicalSourceRequestCount: sourceRequestCount, historicalSourceValidated: requested > 0 && sourceSucceeded === requested } : {}),
    sourceValidated: !replayed && requested > 0 && sourceSucceeded === requested,
    stoppedSlug: results.find(result => !['cache_hit', 'probe_succeeded', 'published'].includes(result.status))?.slug ?? null,
    outcome: exitCode === 0 ? 'complete' : exitCode === 2 ? 'invalid_configuration' : exitCode === 3 ? 'skipped' : 'stopped',
    reason, retryAt, exitCode, replayed,
    results: replayed ? results.map(result => ({ ...result, historicalSourceRequestCount: result.sourceRequestCount, sourceRequestCount: 0 })) : results };
}

/** @param {Record<string,any>} value @param {string[]} keys */
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const OPERATION_KEYS = ['schemaVersion', 'identity', 'status', 'ownerId', 'createdAtMs', 'deadlineAtMs',
  'completedAtMs', 'currentSlug', 'results', 'reason', 'exitCode'];
const RESULT_KEYS = ['slug', 'status', 'sourceSucceeded', 'sourceRequestCount', 'reason', 'retryAt', 'diagnostics'];

/** A pending record is an unused intent, not a resumable collection result.
 * @param {any} value @param {any} identity @param {string[]} slugs @param {number} nowMs
 */
function validOperation(value, identity, slugs, nowMs) {
  return isObject(value) && value.schemaVersion === 1 && JSON.stringify(value.identity) === JSON.stringify(identity) &&
    exactKeys(value, OPERATION_KEYS) && finiteTime(nowMs) &&
    ['pending', 'running', 'complete', 'stopped', 'abandoned'].includes(value.status) &&
    (value.ownerId === null || typeof value.ownerId === 'string' && UUID.test(value.ownerId)) &&
    finiteTime(value.createdAtMs) && value.createdAtMs <= nowMs && finiteTime(value.deadlineAtMs) &&
    value.deadlineAtMs === value.createdAtMs + ACTIONS_BUDGET_MS && Array.isArray(value.results) &&
    value.results.length === slugs.length && value.results.every((/** @type {any} */ result, /** @type {number} */ index) => {
      if (!isObject(result) || !exactKeys(result, RESULT_KEYS) || result.slug !== slugs[index]) return false;
      const normalized = branchResult(result, slugs[index], identity.mode);
      return normalized.status === result.status && normalized.sourceSucceeded === result.sourceSucceeded &&
        normalized.sourceRequestCount === result.sourceRequestCount && normalized.reason === result.reason &&
        normalized.retryAt === result.retryAt && JSON.stringify(normalized.diagnostics) === JSON.stringify(result.diagnostics);
    }) && (value.currentSlug === null || slugs.includes(value.currentSlug)) &&
    (value.status === 'pending' ? value.ownerId === null && value.currentSlug === null && value.exitCode === null &&
      value.completedAtMs === null && value.reason === null && value.results.every((/** @type {any} */ result) =>
        result.status === 'not_attempted' && result.sourceSucceeded === false && result.sourceRequestCount === 0 &&
        result.reason === null && result.retryAt === null && result.diagnostics.length === 0)
      : value.status === 'running' ? UUID.test(value.ownerId) && value.exitCode === null &&
        value.completedAtMs === null && value.reason === null
        : finiteTime(value.completedAtMs) && value.completedAtMs >= value.createdAtMs && value.completedAtMs <= nowMs &&
          (value.status === 'complete' ? UUID.test(value.ownerId) && value.currentSlug === null && value.reason === null && value.exitCode === 0 &&
            value.results.every((/** @type {any} */ result) => ['cache_hit', 'probe_succeeded', 'published'].includes(result.status))
            : value.status === 'stopped' ? UUID.test(value.ownerId) && value.currentSlug === null &&
              typeof value.reason === 'string' && SAFE_REASONS.has(value.reason) && [1, 2, 3].includes(value.exitCode)
              : value.reason === 'unknown_outcome' && value.exitCode === 3));
}

/** @param {any} value @param {number} nowMs */
function validJob(value, nowMs) {
  return isObject(value) && value.schemaVersion === 1 && typeof value.operationKey === 'string' &&
    exactKeys(value, ['schemaVersion', 'operationKey', 'ownerId', 'status', 'deadlineAtMs']) &&
    /^exchange-rates-1965\/actions\/operations\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/[1-9][0-9]{0,19}$/.test(value.operationKey) &&
    typeof value.ownerId === 'string' && UUID.test(value.ownerId) && finiteTime(nowMs) &&
    finiteTime(value.deadlineAtMs) && value.deadlineAtMs <= nowMs + ACTIONS_BUDGET_MS &&
    ['running', 'complete', 'stopped', 'abandoned'].includes(value.status);
}

/** Durable invocation ledger and bounded serial collector. The caller supplies a reviewed
 * branch collector and its target/source stores; this module never opens a network client.
 * @param {{store:any,repository:string,runId:string,commit:string,controlVersion:string,target:any,mode:'probe'|'probe-python'|'publish',scope:'single'|'pilot'|'all',
 * collectorImpl:(input:any)=>Promise<any>,signal?:AbortSignal,nowImpl?:()=>number,randomUUIDImpl?:()=>string,
 * randomImpl?:()=>number,sleepImpl?:(ms:number,signal:AbortSignal)=>Promise<void>}} input
 */
export async function runActionsCollector(input) {
  const identity = identityFor(input);
  if (!identity || typeof input.collectorImpl !== 'function' || !input.store) return summarize(null, [], { reason: 'invalid_configuration', exitCode: 2 });
  let slugs;
  try { slugs = actionsScopeSlugs(identity.scope); } catch { return summarize(identity, [], { reason: 'invalid_configuration', exitCode: 2 }); }
  const { store, collectorImpl, nowImpl = Date.now, randomUUIDImpl = randomUUID, randomImpl = Math.random,
    sleepImpl = async (ms, signal) => { await delay(ms, undefined, { signal }); } } = input;
  const operationKey = actionsOperationKey(identity.repository, identity.runId);
  const operationId = `${identity.repository}/${identity.runId}`;
  /** @type {any[]} */
  let results = slugs.map(slug => untouched(slug));
  /** @type {any} */
  let entry = null;
  /** @type {any} */
  let jobEntry = null;
  /** @type {any} */
  let operation = null;
  /** @type {string|null} */
  let ownerId = null;
  const budgetController = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, budgetController.signal]) : budgetController.signal;
  let timeoutId;
  /** @param {number} [budget] @param {string} [expectedSlug] */
  const owns = async (budget = 0, expectedSlug) => {
    if (signal.aborted || !operation || nowImpl() + budget >= operation.deadlineAtMs) return false;
    const current = await readEntry(store, operationKey);
    const currentJob = await readEntry(store, ACTIONS_JOB_KEY);
    const checkedAtMs = nowImpl();
    return !signal.aborted && checkedAtMs + budget < operation.deadlineAtMs &&
      validOperation(current?.data, identity, slugs, checkedAtMs) && validJob(currentJob?.data, checkedAtMs) &&
      current.data.status === 'running' && current.data.ownerId === ownerId &&
      JSON.stringify(current.data.identity) === JSON.stringify(identity) && current.data.deadlineAtMs === operation.deadlineAtMs &&
      (expectedSlug === undefined || current.data.currentSlug === expectedSlug) &&
      currentJob.data.status === 'running' && currentJob.data.operationKey === operationKey &&
      currentJob.data.ownerId === ownerId && currentJob.data.deadlineAtMs === operation.deadlineAtMs;
  };
  /** @param {any} updated */
  const persistOperation = async updated => {
    const write = await conditionalSetJSON(store, operationKey, updated, entry);
    if (!write.modified || !write.etag) throw new Error('lease_lost');
    operation = updated;
    entry = { data: operation, etag: write.etag };
  };
  /** @param {string|null} reason @param {number} exitCode */
  const finish = async (reason, exitCode) => {
    if (jobEntry) {
      const job = { ...jobEntry.data, status: exitCode === 0 ? 'complete' : 'stopped' };
      try {
        const write = await conditionalSetJSON(store, ACTIONS_JOB_KEY, job, jobEntry);
        if (!write.modified) { reason = 'lease_lost'; exitCode = 1; }
        else jobEntry = null;
      } catch { reason = 'storage_unavailable'; exitCode = 1; }
    }
    await persistOperation({ ...operation, results, currentSlug: null, status: exitCode === 0 ? 'complete' : 'stopped',
      completedAtMs: nowImpl(), reason, exitCode });
    return summarize(identity, results, { reason, exitCode });
  };
  try {
    if (signal.aborted) return summarize(identity, results, { reason: 'aborted', exitCode: 1 });
    entry = await readEntry(store, operationKey);
    if (!entry) {
      const createdAtMs = nowImpl();
      if (!finiteTime(createdAtMs) || !finiteTime(createdAtMs + ACTIONS_BUDGET_MS)) return summarize(identity, results, { reason: 'invalid_configuration', exitCode: 2 });
      const pending = { schemaVersion: 1, identity, status: 'pending', ownerId: null, createdAtMs,
        deadlineAtMs: createdAtMs + ACTIONS_BUDGET_MS, completedAtMs: null, currentSlug: null, results, reason: null, exitCode: null };
      const write = await conditionalSetJSON(store, operationKey, pending, null);
      entry = write.modified ? { data: pending, etag: write.etag } : await readEntry(store, operationKey);
    }
    if (!entry || !validOperation(entry.data, identity, slugs, nowImpl())) return summarize(identity, results, { reason: 'operation_conflict', exitCode: 2 });
    operation = entry.data;
    results = operation.results.map((/** @type {any} */ result, /** @type {number} */ index) => branchResult(result, slugs[index], identity.mode));
    if (['complete', 'stopped'].includes(operation.status)) {
      return summarize(identity, results, { reason: operation.reason === null ? null : safeReason(operation.reason),
        exitCode: [0, 1, 2, 3].includes(operation.exitCode) ? operation.exitCode : 1, replayed: true });
    }
    if (operation.status === 'abandoned') return summarize(identity, results, { reason: 'operation_abandoned', exitCode: 3, replayed: true });
    if (operation.deadlineAtMs <= nowImpl()) {
      await persistOperation({ ...operation, status: 'abandoned', completedAtMs: nowImpl(), reason: 'unknown_outcome', exitCode: 3 });
      return summarize(identity, results, { reason: 'operation_abandoned', exitCode: 3, replayed: true });
    }
    if (operation.status === 'running') return summarize(identity, results, { reason: 'busy', exitCode: 3, replayed: true });
    ownerId = randomUUIDImpl();
    if (!UUID.test(ownerId)) return summarize(identity, results, { reason: 'invalid_configuration', exitCode: 2 });
    const claimed = { ...operation, ownerId, status: 'running' };
    const write = await conditionalSetJSON(store, operationKey, claimed, entry);
    if (!write.modified || !write.etag) return summarize(identity, results, { reason: 'busy', exitCode: 3 });
    operation = claimed;
    entry = { data: claimed, etag: write.etag };

    const oldJob = await readEntry(store, ACTIONS_JOB_KEY);
    if (oldJob && !validJob(oldJob.data, nowImpl())) return await finish('invalid_operation', 1);
    if (oldJob?.data.status === 'running' && oldJob.data.deadlineAtMs > nowImpl()) return await finish('busy', 3);
    if (oldJob?.data.status === 'running') {
      const oldOperation = await readEntry(store, oldJob.data.operationKey);
      const oldIdentity = identityFor(oldOperation?.data?.identity ?? {});
      if (!oldOperation || !oldIdentity || !validOperation(oldOperation.data, oldIdentity, actionsScopeSlugs(oldIdentity.scope), nowImpl()) ||
          oldOperation.data.ownerId !== oldJob.data.ownerId || !['running', 'complete', 'stopped', 'abandoned'].includes(oldOperation.data.status)) {
        return await finish('invalid_operation', 1);
      }
      if (oldOperation.data.status === 'running') {
        const abandoned = await conditionalSetJSON(store, oldJob.data.operationKey,
          { ...oldOperation.data, status: 'abandoned', completedAtMs: nowImpl(), reason: 'unknown_outcome', exitCode: 3 }, oldOperation);
        if (!abandoned.modified) return await finish('busy', 3);
      }
    }
    const job = { schemaVersion: 1, operationKey, ownerId, status: 'running', deadlineAtMs: operation.deadlineAtMs };
    const jobWrite = await conditionalSetJSON(store, ACTIONS_JOB_KEY, job, oldJob);
    if (!jobWrite.modified || !jobWrite.etag) return await finish('busy', 3);
    jobEntry = { data: job, etag: jobWrite.etag };
    timeoutId = setTimeout(() => budgetController.abort('deadline'), Math.max(0, operation.deadlineAtMs - nowImpl()));

    for (let index = 0; index < slugs.length; index++) {
      const slug = slugs[index];
      if (!await owns(15_000)) return await finish(signal.aborted && !budgetController.signal.aborted ? 'aborted'
        : nowImpl() + 15_000 >= operation.deadlineAtMs ? 'deadline' : 'lease_lost', 1);
      await persistOperation({ ...operation, currentSlug: slug, results });
      /** @type {any} */
      let observed = null;
      let returned, collectorThrew = false;
      try {
        returned = await collectorImpl({ slug, publishQuote: identity.mode === 'publish', signal,
          operationId, operationKey, ownerId, beforeSource: () => owns(15_000, slug), beforePublish: () => owns(0, slug),
          canContinue: () => !signal.aborted && nowImpl() < operation.deadlineAtMs,
          onResult: (/** @type {any} */ result) => { observed = result; } });
      } catch {
        collectorThrew = true;
        observed ??= { status: 'source_unknown', sourceSucceeded: false, sourceRequestCount: 0,
          reason: signal.aborted ? 'aborted' : 'unknown_outcome' };
      }
      results[index] = branchResult(observed ?? returned, slug, identity.mode);
      await persistOperation({ ...operation, currentSlug: null, results });
      const result = results[index];
      if (collectorThrew) return await finish(signal.aborted ? 'aborted' : 'unknown_outcome', 1);
      if (!['cache_hit', 'probe_succeeded', 'published'].includes(result.status)) {
        const sourceStarted = results.some(item => item.sourceRequestCount > 0 || item.status === 'source_unknown');
        return await finish(result.reason ?? 'unavailable', result.status === 'not_attempted' && !sourceStarted && SKIP_REASONS.has(result.reason) ? 3 : 1);
      }
      if (signal.aborted || nowImpl() >= operation.deadlineAtMs) return await finish(signal.aborted && !budgetController.signal.aborted ? 'aborted' : 'deadline', 1);
      if (index + 1 < slugs.length && result.sourceRequestCount > 0) {
        const random = randomImpl();
        const ms = 2_000 + Math.floor(Math.max(0, Math.min(1, Number.isFinite(random) ? random : 0)) * 3_000);
        if (nowImpl() + ms + 15_000 >= operation.deadlineAtMs) return await finish('deadline', 1);
        await sleepImpl(ms, signal);
      }
    }
    if (!await owns()) return await finish(signal.aborted ? 'aborted' : 'lease_lost', 1);
    return await finish(null, 0);
  } catch {
    // Never propagate storage, callback, signal or transport exception messages.
    const reason = signal.aborted ? 'aborted' : 'storage_unavailable';
    if (operation?.status === 'running' && operation.ownerId === ownerId && entry) {
      try { return await finish(reason, 1); } catch { /* Unknown writes stay closed for inspection. */ }
    }
    return summarize(identity, results, { reason, exitCode: 1 });
  } finally {
    clearTimeout(timeoutId);
  }
}
