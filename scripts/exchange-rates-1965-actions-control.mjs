import { pathToFileURL } from 'node:url';

import { LEGACY_PREVIEW_DEPLOY_IDS, openActionsTarget } from '../netlify/functions/_shared/exchange-rates-1965-actions-target.mjs';
import { changeControl } from '../netlify/functions/_shared/exchange-rates-1965-control.mjs';
import { EXCHANGE_KEYS, isValidBreaker, isValidControl } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { readEntry } from '../netlify/functions/_shared/exchange-rates-1965-storage.mjs';
import { BRANCH_GATE_KEY } from '../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { BATCH_JOB_KEY } from '../netlify/functions/_shared/exchange-rates-1965-background.mjs';
import { bootstrapSourceGuard, readSourceGuard, reconcileSourceAttempt, setSourceGuardPaused } from '../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_COMMANDS = ['inspect', 'status', 'enable', 'disable'];
const SOURCE_COMMANDS = ['source-status', 'source-pause', 'source-resume', 'source-bootstrap', 'source-reconcile'];

/** @param {string[]} argv */
export function parseActionsControlArgs(argv) {
  const [command, flag, alias, ...rest] = argv;
  if (![...CONTROL_COMMANDS, ...SOURCE_COMMANDS].includes(command) || flag !== '--target' ||
      !/^[a-z0-9][a-z0-9-]{0,47}$/.test(alias ?? '')) {
    throw new Error('invalid_actions_control_arguments');
  }
  if (command === 'source-bootstrap') {
    if (rest.length !== 1 || rest[0] !== '--confirm-legacy-stopped') throw new Error('invalid_actions_control_arguments');
    return { command, alias, reason: 'manual', legacyReviewed: true };
  }
  if (command === 'source-reconcile') {
    const [epochFlag, epoch, leaseFlag, leaseId, outcomeFlag, outcome, confirmed] = rest;
    if (rest.length !== 7 || epochFlag !== '--epoch' || !UUID.test(epoch ?? '') || leaseFlag !== '--lease-id' ||
        !UUID.test(leaseId ?? '') || outcomeFlag !== '--outcome' || !['blocked', 'failed', 'complete'].includes(outcome) ||
        confirmed !== '--confirm-source-reviewed') throw new Error('invalid_actions_control_arguments');
    return { command, alias, reason: 'operator_source_review', epoch, leaseId, outcome };
  }
  if (rest.length && (command !== 'disable' || rest.length !== 2 || rest[0] !== '--reason' || !/^[a-z0-9_]{1,64}$/.test(rest[1]))) {
    throw new Error('invalid_actions_control_arguments');
  }
  return { command, alias, reason: rest[1] ?? 'manual' };
}

/** Validators allow additional fields for compatibility; administration output remains an explicit allowlist.
 * @param {any} entry
 */
function publicControl(entry) {
  if (entry === null) return null;
  if (!isValidControl(entry.data)) throw new Error('invalid_control');
  const { enabled, controlVersion, enabledAt, changedAt, disabledReason, disabledAt, updatedBy } = entry.data;
  return { enabled, controlVersion, enabledAt, changedAt, disabledReason, disabledAt, updatedBy };
}

/** @param {any} entry */
function publicBreaker(entry) {
  if (entry === null) return null;
  if (!isValidBreaker(entry.data)) throw new Error('invalid_breaker');
  const { controlVersion, consecutiveFailedRuns, blockLevel, blockedUntil, lastStatus, lastError } = entry.data;
  return { controlVersion, consecutiveFailedRuns, blockLevel, blockedUntil, lastStatus, lastError };
}

/** Read every relevant legacy state before bootstrap; unknown and active workers are never discarded.
 * @param {any} store @param {number} nowMs @param {boolean} [requireDisabled]
 */
async function readLegacyBreaker(store, nowMs, requireDisabled = false) {
  try {
    const [control, breaker, gate, job] = await Promise.all([
      readEntry(store, EXCHANGE_KEYS.control), readEntry(store, EXCHANGE_KEYS.breaker),
      readEntry(store, BRANCH_GATE_KEY), readEntry(store, BATCH_JOB_KEY),
    ]);
    if ((control && !isValidControl(control.data)) || (breaker && !isValidBreaker(breaker.data))) throw new Error();
    // An idle lease does not disable an immutable old deployment's public
    // source endpoint. The reviewed legacy producers must remain disabled.
    if (requireDisabled && control?.data.enabled === true) throw new Error('legacy_source_enabled');
    const nonnegative = (/** @type {unknown} */ value) => Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
    if (gate) {
      const state = gate.data;
      if (!state || !(state.leaseId === null || (typeof state.leaseId === 'string' && UUID.test(state.leaseId))) ||
          !nonnegative(state.leaseUntilMs) || !nonnegative(state.nextRequestAtMs) ||
          (state.leaseId === null && state.leaseUntilMs !== 0)) throw new Error();
      if (state.leaseUntilMs > nowMs || state.nextRequestAtMs > nowMs) throw new Error('legacy_work_active');
    }
    if (job) {
      const state = job.data;
      if (!state || typeof state.token !== 'string' || !UUID.test(state.token) ||
          typeof state.controlVersion !== 'string' || !UUID.test(state.controlVersion) ||
          !['pending', 'running', 'complete', 'stopped', 'dispatch_failed'].includes(state.status) ||
          !nonnegative(state.scheduledAtMs) || !nonnegative(state.deadlineAtMs) ||
          !(state.leaseId === null || (typeof state.leaseId === 'string' && UUID.test(state.leaseId)))) throw new Error();
      if (['pending', 'running'].includes(state.status) && state.deadlineAtMs > nowMs) throw new Error('legacy_work_active');
    }
    return breaker?.data ?? null;
  } catch (error) {
    throw new Error(error instanceof Error && ['legacy_work_active', 'legacy_source_enabled'].includes(error.message)
      ? error.message : 'legacy_state_unknown');
  }
}

/** @param {any} state */
function publicSourceGuard(state) {
  if (!state) return null;
  const pending = state.unresolvedAttempt;
  const audit = state.lastReconciliation;
  return { sourceEpoch: state.sourceEpoch, paused: state.paused,
    breaker: publicBreaker({ data: state.breaker }), leaseId: state.leaseId, leaseUntilMs: state.leaseUntilMs,
    nextRequestAtMs: state.nextRequestAtMs, unresolvedAttempt: pending ? {
      operationId: pending.operationId, ownerId: pending.ownerId, slug: pending.slug, startedAtMs: pending.startedAtMs,
    } : null, lastReconciliation: audit ? { reason: audit.reason, outcome: audit.outcome, reviewedAtMs: audit.reviewedAtMs } : null };
}

/** Target control is separate from the common source guard: enabling a target never enables source work.
 * @param {string[]} argv
 * @param {{openTargetImpl?:(input:any)=>Promise<any>,targetsInput?:unknown,env?:Record<string,string|undefined>,nowMs?:number,randomUUIDImpl?:()=>string}} [input]
 */
export async function runActionsControlCommand(argv, { openTargetImpl = openActionsTarget, targetsInput,
  env = process.env, nowMs = Date.now(), randomUUIDImpl } = {}) {
  const args = parseActionsControlArgs(argv);
  const { command, alias, reason } = args;
  const { target, metadata, store, sourceGuardStore, openLegacyStores } = await openTargetImpl({ alias, targetsInput, env });
  try {
    if (SOURCE_COMMANDS.includes(command)) {
      let result;
      if (command === 'source-bootstrap') {
        if (typeof openLegacyStores !== 'function') throw new Error('legacy_state_unknown');
        const legacyStores = await openLegacyStores();
        const labels = ['production', ...LEGACY_PREVIEW_DEPLOY_IDS.map(id => `legacy-preview-${id}`)];
        if (!Array.isArray(legacyStores) || legacyStores.length !== labels.length ||
            !labels.every((label, index) => legacyStores[index]?.label === label)) throw new Error('legacy_state_unknown');
        const legacyBreakers = await Promise.all([
          ...legacyStores.map(entry => readLegacyBreaker(entry.store, nowMs, true)), readLegacyBreaker(store, nowMs),
        ]);
        result = await bootstrapSourceGuard({ store: sourceGuardStore, legacyBreakers, legacyReviewed: true, nowMs,
          ...(randomUUIDImpl ? { randomUUIDImpl } : {}) });
      } else if (command === 'source-reconcile') {
        if (!args.epoch || !args.leaseId) throw new Error('invalid_actions_control_arguments');
        result = await reconcileSourceAttempt({ store: sourceGuardStore, expectedEpoch: args.epoch,
          expectedLeaseId: args.leaseId, outcome: /** @type {'blocked'|'failed'|'complete'} */ (args.outcome), nowMs,
          reason: 'operator_source_review' });
      } else if (command === 'source-status') {
        result = await readSourceGuard({ store: sourceGuardStore, nowMs });
      } else {
        result = await setSourceGuardPaused({ store: sourceGuardStore, paused: command === 'source-pause', nowMs });
      }
      return { target, metadata, ok: command === 'source-status' ? Boolean(result.state) : result.ok,
        reason: result.reason, sourceGuard: publicSourceGuard(result.state), retryAtMs: 'retryAtMs' in result ? result.retryAtMs ?? null : null };
    }
    if (command === 'inspect' || command === 'status') {
      const [controlEntry, breakerEntry] = await Promise.all([
        readEntry(store, EXCHANGE_KEYS.control), readEntry(store, EXCHANGE_KEYS.breaker),
      ]);
      return { target, metadata, control: publicControl(controlEntry), breaker: publicBreaker(breakerEntry) };
    }
    const control = await changeControl(store, { enabled: command === 'enable', reason, updatedBy: 'manual', nowMs,
      ...(randomUUIDImpl ? { randomUUIDImpl } : {}) });
    return { target, metadata, control };
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    throw new Error(['invalid_control', 'invalid_breaker', 'control_write_conflict', 'breaker_write_conflict',
      'legacy_state_unknown', 'legacy_work_active', 'legacy_source_enabled'].includes(code)
      ? code : 'actions_control_unavailable');
  }
}

async function main() {
  try {
    const result = await runActionsControlCommand(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if ('ok' in result && !result.ok) process.exitCode = 1;
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'actions_control_unavailable');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
