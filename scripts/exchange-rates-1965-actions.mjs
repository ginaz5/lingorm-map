import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createPythonSafariFetch } from './exchange-rates-1965-python.mjs';

import { openActionsTarget } from '../netlify/functions/_shared/exchange-rates-1965-actions-target.mjs';
import { actionsOperationKey, runActionsCollector, ACTIONS_MODE, ACTIONS_SCOPE } from '../netlify/functions/_shared/exchange-rates-1965-actions-runner.mjs';
import { createAnonymousApiSource, ANONYMOUS_SOURCE_PROFILE } from '../netlify/functions/_shared/exchange-rates-1965-anonymous.mjs';
import { readEffectiveControl } from '../netlify/functions/_shared/exchange-rates-1965-control.mjs';
import { EXCHANGE_KEYS, isValidBreaker } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { queryBranchRates } from '../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { readSourceGuard } from '../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { readEntry } from '../netlify/functions/_shared/exchange-rates-1965-storage.mjs';
import { TOKEN_FAILURE_REASONS } from '../netlify/functions/_shared/exchange-rates-1965-source-telemetry.mjs';
import { NETLIFY_CONTROL_KEY, validNetlifyControl } from '../netlify/functions/_shared/exchange-rates-1965-netlify.mjs';

const REPOSITORY = 'ginaz5/lingorm-map';
const SETTINGS_ERRORS = new Set(['invalid_actions_arguments', 'invalid_actions_identity', 'invalid_target_configuration',
  'target_not_configured', 'target_configuration_unavailable', 'missing_credentials', 'invalid_credentials',
  'invalid_actions_environment', 'target_metadata_mismatch', 'target_metadata_unavailable', 'target_store_unavailable']);

/** A closed interface: no caller URL, inventory, force flag or checkout ref.
 * @param {string[]} argv
 */
export function parseActionsArgs(argv) {
  const [mode, flag, alias, ...rest] = argv;
  if (!['inspect', ACTIONS_MODE].includes(mode) || flag !== '--target' || rest.length ||
      !['preview-reviewed', 'production'].includes(alias)) {
    throw new Error('invalid_actions_arguments');
  }
  return { mode, alias, scope: ACTIONS_SCOPE };
}

/** Manual dispatch only: the workflow has no schedule.
 * @param {Record<string,string|undefined>} env
 */
function executionIdentity(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== REPOSITORY ||
      !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID ?? '') || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ||
      env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('invalid_actions_identity');
  }
  return { repository: REPOSITORY, runId: /** @type {string} */ (env.GITHUB_RUN_ID), commit: /** @type {string} */ (env.GITHUB_SHA) };
}

/** @param {any} guard */
function guardSummary(guard) {
  const state = guard.state;
  return { ready: guard.ok, reason: guard.reason ?? null, retryAt: state?.paused || state?.unresolvedAttempt || guard.retryAtMs == null
    ? null : new Date(guard.retryAtMs).toISOString(),
    sourceEpoch: state?.sourceEpoch ?? null, paused: state?.paused ?? null,
    blockLevel: state?.breaker?.blockLevel ?? null, blockedUntil: state?.breaker?.blockedUntil ?? null,
    unresolved: Boolean(state?.unresolvedAttempt) };
}

/** No source work is dispatched before target metadata, existing control and common guard pass.
 * Inspect remains read-only and needs no GitHub run identity.
 * @param {string[]} argv
 * @param {{env?:Record<string,string|undefined>,openTargetImpl?:(input:any)=>Promise<any>,targetsInput?:unknown,
 * fetchImpl?:typeof fetch,pythonFetchImpl?:typeof fetch,nowImpl?:()=>number,signal?:AbortSignal,runCollectorImpl?:(input:any)=>Promise<any>,
 * queryImpl?:typeof queryBranchRates,randomUUIDImpl?:()=>string,sleepImpl?:(ms:number,signal:AbortSignal)=>Promise<void>,randomImpl?:()=>number}} [input]
 */
export async function runActionsCommand(argv, { env = process.env, openTargetImpl = openActionsTarget, targetsInput,
  fetchImpl = fetch, pythonFetchImpl, nowImpl = Date.now, signal, runCollectorImpl = runActionsCollector, queryImpl = queryBranchRates,
  randomUUIDImpl, sleepImpl, randomImpl } = {}) {
  /** @type {ReturnType<typeof createAnonymousApiSource>|undefined} */
  let source;
  let observedSourceRequests = 0;
  try {
    const { mode, alias, scope } = parseActionsArgs(argv);
    // Schedule events fail closed in every mode, including read-only inspect.
    const identity = mode === 'inspect' && env.GITHUB_EVENT_NAME !== 'schedule' ? null : executionIdentity(env);
    const opened = await openTargetImpl({ alias, targetsInput, env, fetchImpl });
    const { target, metadata, store, sourceGuardStore, verifyCurrent } = opened;
    const netlifyControl = (await readEntry(store, NETLIFY_CONTROL_KEY))?.data;
    if (netlifyControl && !validNetlifyControl(netlifyControl)) throw new Error('invalid_target_configuration');
    if (mode !== 'inspect' && netlifyControl?.enabled) return { exitCode: 3,
      summary: { mode, outcome: 'skipped', reason: 'netlify_collector_active', sourceRequestCount: 0, published: 0, sourceValidated: false } };
    if (target.kind === 'production' && typeof verifyCurrent !== 'function') throw new Error('invalid_target_configuration');
    const runnerBase = { store, ...identity, mode, scope, target: { ...target, deployID: target.deployID ?? null }, signal, nowImpl,
      ...(randomUUIDImpl ? { randomUUIDImpl } : {}), ...(sleepImpl ? { sleepImpl } : {}), ...(randomImpl ? { randomImpl } : {}) };
    if (identity) {
      const previous = await readEntry(store, actionsOperationKey(identity.repository, identity.runId));
      if (previous && ['complete', 'stopped', 'abandoned'].includes(previous.data?.status)) {
        // Replay the original terminal result before a later cooldown or control
        // change can turn a failed operation into a green, skipped attempt.
        const replay = await runCollectorImpl({ ...runnerBase, controlVersion: previous.data.identity?.controlVersion,
          collectorImpl: async () => { throw new Error('terminal_operation_must_not_collect'); } });
        return { exitCode: replay.exitCode, summary: replay };
      }
    }
    const effective = await readEffectiveControl(store, 'false');
    const guard = await readSourceGuard({ store: sourceGuardStore, nowMs: nowImpl() });
    if (mode === 'inspect') {
      const breaker = (await readEntry(store, EXCHANGE_KEYS.breaker))?.data;
      if (breaker && !isValidBreaker(breaker)) throw new Error('invalid_control');
      return { exitCode: 0, summary: { mode, target, metadata, sourceRequestCount: 0, published: 0,
        enabled: effective.enabled, controlVersion: effective.control?.controlVersion ?? null,
        breaker: breaker ? { blockLevel: breaker.blockLevel, blockedUntil: breaker.blockedUntil } : null,
        sourceGuard: guardSummary(guard), sourceValidated: false, outcome: 'inspected' } };
    }
    if (signal?.aborted || !effective.enabled || !effective.control || !guard.ok) {
      const guardError = !guard.ok && !['paused', 'cooldown', 'busy', 'unknown_outcome'].includes(guard.reason ?? '');
      const protectedSkip = !guardError;
      return { exitCode: protectedSkip ? 3 : 1, summary: { mode, target, outcome: protectedSkip ? 'skipped' : 'failed', sourceRequestCount: 0, published: 0,
        sourceValidated: false, reason: guardError ? guard.reason : signal?.aborted ? 'cancelled' : !effective.control ? 'missing_control' : !effective.enabled ? 'disabled' : guard.reason,
        sourceGuard: guardSummary(guard) } };
    }
    source = createAnonymousApiSource({ fetchImpl: pythonFetchImpl ?? createPythonSafariFetch(), nowImpl });
    const sourceFetch = source.fetchImpl;
    const session = source;
    const waitImpl = sleepImpl ?? (async (/** @type {number} */ ms, /** @type {AbortSignal} */ signal) => { await delay(ms, undefined, { signal }); });
    const result = await runCollectorImpl({ ...runnerBase,
      controlVersion: effective.control.controlVersion,
      collectorImpl: async (/** @type {any} */ options) => {
        if (target.kind === 'production' && !await verifyCurrent()) {
          const stopped = { status: 'not_attempted', sourceSucceeded: false, sourceRequestCount: 0, reason: 'stale_target' };
          options.onResult?.(stopped);
          return stopped;
        }
        return queryImpl({ ...options, store, sourceGuardStore,
        expectedControlVersion: effective.control.controlVersion, nowImpl, fetchImpl: sourceFetch, sourceProfile: { ...ANONYMOUS_SOURCE_PROFILE, name: 'anonymous-python-safari' },
        prepareSource: async () => {
          const readyAtMs = session.getReadyAtMs();
          if (readyAtMs <= nowImpl()) return null;
          const stoppedReason = () => options.signal?.aborted
            ? options.signal.reason === 'deadline' ? 'deadline' : 'cancelled'
            : options.canContinue?.() === false ? 'deadline' : 'lease_lost';
          const guard = await readSourceGuard({ store: sourceGuardStore, nowMs: nowImpl() });
          if (!guard.ok) return { reason: guard.reason ?? 'source_guard_unavailable', retryAtMs: guard.retryAtMs };
          if (nowImpl() < readyAtMs) console.info(JSON.stringify({ event: 'exchange_rates_1965_token_wait',
            waitMs: readyAtMs - nowImpl() }));
          // No token GET is attempted during this wait. Every source and target
          // gate is still checked by queryBranchRates after preparation ends.
          while (nowImpl() < readyAtMs) {
            if (!await options.beforeSource()) return { reason: stoppedReason() };
            try { await waitImpl(Math.min(1_000, readyAtMs - nowImpl()), options.signal); }
            catch (error) { if (options.signal?.aborted) return { reason: stoppedReason() }; throw error; }
          }
          if (!await options.beforeSource()) return { reason: stoppedReason() };
          if (target.kind === 'production' && !await verifyCurrent()) return { reason: 'stale_target' };
          return null;
        },
        onResult: result => { observedSourceRequests += result.sourceRequestCount; options.onResult?.(result); },
        beforePublish: async () => (target.kind !== 'production' || await verifyCurrent()) &&
          (!options.beforePublish || await options.beforePublish()),
        ...(randomUUIDImpl ? { randomUUIDImpl } : {}) });
      },
    });
    return { exitCode: result.exitCode, summary: result };
  } catch (error) {
    const code = error instanceof Error && SETTINGS_ERRORS.has(error.message) ? error.message : 'actions_unavailable';
    return { exitCode: SETTINGS_ERRORS.has(code) ? 2 : 1,
      summary: { outcome: 'failed', reason: code, sourceRequestCount: observedSourceRequests, sourceValidated: false } };
  } finally { await source?.close(); }
}

/** All interpolated identifiers are fixed or validated; upstream text is never rendered here.
 * @param {any} summary
 */
export function renderActionsSummary(summary) {
  const count = (/** @type {unknown} */ value) => Number.isSafeInteger(value) && Number(value) >= 0 ? String(value) : '0';
  const text = (/** @type {unknown} */ value) => typeof value === 'string' && /^[a-z0-9_\-]{1,64}$/.test(value) ? value : 'unavailable';
  const stoppedSlug = typeof summary.stoppedSlug === 'string' && /^superrich1965-[1-9][0-9]{0,2}$/.test(summary.stoppedSlug)
    ? summary.stoppedSlug : null;
  const stopped = stoppedSlug && Array.isArray(summary.results)
    ? summary.results.find((/** @type {any} */ result) => result?.slug === stoppedSlug) : null;
  const last = Array.isArray(stopped?.diagnostics) ? stopped.diagnostics.at(-1) : null;
  const detail = last && ['token', 'rate'].includes(last.stage)
    ? `\nStopped branch: ${stoppedSlug}\n\nSource stage: ${last.stage}\n\nHTTP status: ${Number.isInteger(last.status) && last.status >= 100 && last.status <= 599 ? last.status : 'unavailable'}\n\n` +
      `Diagnostic: ${[...TOKEN_FAILURE_REASONS, 'invalid', 'timeout', 'http_error'].includes(last.reason) ? last.reason : 'unavailable'}\n` +
      (last.stage === 'token' && Number.isSafeInteger(last.tokenRemainingSeconds) && Math.abs(last.tokenRemainingSeconds) <= 86_400
        ? `\nToken remaining seconds (bounded to ±86400): ${last.tokenRemainingSeconds}\n` : '') +
      (last.stage === 'token' && (last.tokenReissued === 0 || last.tokenReissued === 1)
        ? `\nCallback returned previous token: ${last.tokenReissued === 1 ? 'yes' : 'no'}\n` : '')
    : '';
  return `## SuperRich 1965\n\nOutcome: ${text(summary.outcome ?? summary.status)}\n\n` +
    `| Metric | Count |\n| --- | ---: |\n| Requested | ${count(summary.requested)} |\n| Cache hit | ${count(summary.cacheHit)} |\n` +
    `| Source succeeded | ${count(summary.sourceSucceeded)} |\n| Published | ${count(summary.published)} |\n| Failed | ${count(summary.failed)} |\n| Not attempted | ${count(summary.notAttempted)} |\n| Source HTTP requests | ${count(summary.sourceRequestCount)} |\n\n` +
    `Source validated this run: ${summary.sourceValidated === true && !summary.replayed ? 'yes' : 'no'}\n\n` +
    `Mode: ${text(summary.mode)}\n\nReason: ${text(summary.reason ?? 'none')}\n` + detail;
}

async function main() {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  try {
    const result = await runActionsCommand(process.argv.slice(2), { signal: controller.signal });
    console.log(JSON.stringify(result.summary));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, renderActionsSummary(result.summary));
    process.exitCode = result.exitCode;
  } catch {
    console.error('actions_summary_unavailable');
    process.exitCode = 1;
  } finally {
    process.off('SIGTERM', cancel);
    process.off('SIGINT', cancel);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
