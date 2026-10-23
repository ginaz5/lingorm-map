// Experimental full-inventory probe. No production entry point imports this file.
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ORANGE_BRANCHES, isValidBranchQuote } from '../../src/data/exchange-rates-1965-branch.js';
import { queryBranchRates } from '../../netlify/functions/_shared/exchange-rates-1965-on-demand.mjs';
import { readSourceGuard } from '../../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { conditionalSetJSON, readEntry } from '../../netlify/functions/_shared/exchange-rates-1965-storage.mjs';
import { ANONYMOUS_SOURCE_PROFILE } from '../../netlify/functions/_shared/exchange-rates-1965-anonymous.mjs';

export const PROBE_BUDGET_MS = 12 * 60_000;
const SLUGS = Object.keys(ORANGE_BRANCHES);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** @param {any} job */
export function summarizeProbe(job) {
  const results = job.results ?? [];
  const succeeded = results.filter((/** @type {any} */ row) => row.status === 'probe_succeeded').length;
  return { status: job.status, reason: job.reason ?? null, requested: SLUGS.length, sourceSucceeded: succeeded,
    failed: results.filter((/** @type {any} */ row) => ['source_failed', 'source_unknown', 'publication_failed'].includes(row.status)).length,
    notAttempted: SLUGS.length - results.filter((/** @type {any} */ row) => row.status !== 'not_attempted').length,
    published: 0, cacheHit: results.filter((/** @type {any} */ row) => row.status === 'cache_hit').length,
    sourceRequestCount: results.reduce((/** @type {number} */ total, /** @type {any} */ row) => total + row.sourceRequestCount, 0),
    tokenGets: results.flatMap((/** @type {any} */ row) => row.diagnostics ?? []).filter((/** @type {any} */ row) => row.stage === 'token').length,
    ratePosts: results.flatMap((/** @type {any} */ row) => row.diagnostics ?? []).filter((/** @type {any} */ row) => row.stage === 'rate').length,
    elapsedMs: job.startedAtMs == null ? 0 : (job.completedAtMs ?? job.updatedAtMs ?? job.startedAtMs) - job.startedAtMs,
    currentSlug: job.currentSlug ?? null, tokenWaits: job.tokenWaits ?? [] };
}

/** A single CAS claim consumes the entire operation, including platform retries.
 * The caller supplies a fresh anonymous session and an isolated draft store.
 * @param {{store:any,sourceGuardStore:any,jobKey:string,deployID:string,source:any,
 * nowImpl?:()=>number,sleepImpl?:(ms:number,signal:AbortSignal)=>Promise<void>,randomImpl?:()=>number,
 * randomUUIDImpl?:()=>string}} input
 */
export async function runBackgroundProbe({ store, sourceGuardStore, jobKey, deployID, source,
  nowImpl = Date.now, sleepImpl = async (ms, signal) => { await delay(ms, undefined, { signal }); },
  randomImpl = Math.random, randomUUIDImpl = randomUUID }) {
  let entry = await readEntry(store, jobKey);
  if (!entry || entry.data?.deployID !== deployID || entry.data?.status !== 'pending') {
    await source.close();
    return { replayed: true, summary: entry ? summarizeProbe(entry.data) : null };
  }
  const pending = entry.data;
  const checkedAtMs = nowImpl();
  if (!UUID.test(pending.controlVersion ?? '') || !Number.isSafeInteger(pending.deadlineAtMs) ||
      pending.deadlineAtMs <= checkedAtMs || pending.deadlineAtMs > checkedAtMs + PROBE_BUDGET_MS ||
      pending.results?.length !== 0 || pending.requested !== SLUGS.length || SLUGS.length !== 38) {
    await source.close();
    return { replayed: true, reason: 'invalid_or_expired_job' };
  }
  const ownerId = randomUUIDImpl();
  const controller = new AbortController();
  const signal = controller.signal;
  const claim = { ...pending, ownerId, status: 'running', startedAtMs: checkedAtMs, updatedAtMs: checkedAtMs };
  const claimed = await conditionalSetJSON(store, jobKey, claim, entry);
  if (!claimed.modified || !claimed.etag) { await source.close(); return { replayed: true, reason: 'already_claimed' }; }
  let job = claim;
  entry = { data: job, etag: claimed.etag };
  const timer = setTimeout(() => controller.abort('deadline'), job.deadlineAtMs - nowImpl());
  const owns = async () => {
    if (signal.aborted || nowImpl() + 15_000 >= job.deadlineAtMs) return false;
    const current = await readEntry(store, jobKey);
    return !signal.aborted && current?.data.status === 'running' && current.data.ownerId === ownerId &&
      current.data.controlVersion === job.controlVersion && current.data.deadlineAtMs === job.deadlineAtMs;
  };
  /** @param {any} changes */
  const save = async changes => {
    const next = { ...job, ...changes, updatedAtMs: nowImpl() };
    const write = await conditionalSetJSON(store, jobKey, next, entry);
    if (!write.modified || !write.etag) throw new Error('lease_lost');
    job = next;
    entry = { data: next, etag: write.etag };
  };
  /** @param {string} reason */
  const stop = async reason => {
    await save({ status: 'stopped', reason, currentSlug: null, completedAtMs: nowImpl() });
    return { replayed: false, summary: summarizeProbe(job) };
  };
  try {
    for (const [index, slug] of SLUGS.entries()) {
      if (!await owns()) return await stop(signal.aborted ? 'deadline' : 'lease_lost_or_deadline');
      await save({ currentSlug: slug });
      const readyAtMs = source.getReadyAtMs();
      if (readyAtMs > nowImpl()) {
        const guard = await readSourceGuard({ store: sourceGuardStore, nowMs: nowImpl() });
        if (!guard.ok) return await stop(guard.reason ?? 'source_guard_unavailable');
        if (readyAtMs + 15_000 >= job.deadlineAtMs) return await stop('deadline');
        await save({ tokenWaits: [...job.tokenWaits, { beforeSlug: slug, startedAtMs: nowImpl(), waitMs: readyAtMs - nowImpl() }] });
        while (nowImpl() < readyAtMs) {
          if (!await owns()) return await stop('lease_lost_or_deadline');
          await sleepImpl(Math.min(1_000, readyAtMs - nowImpl()), signal);
        }
      }
      /** @type {any} */
      let observed = null;
      const response = await queryBranchRates({ store, sourceGuardStore, slug,
        requireExistingControl: true, enabledDefault: 'false', expectedControlVersion: job.controlVersion,
        operationId: job.operationId, ownerId, publishQuote: false, refreshDue: true,
        fetchImpl: source.fetchImpl, sourceProfile: { ...ANONYMOUS_SOURCE_PROFILE, name: 'netlify-python-background-probe' },
        signal, nowImpl, randomUUIDImpl, beforeSource: owns,
        canContinue: () => !signal.aborted && nowImpl() < job.deadlineAtMs,
        onResult: value => { observed = value; } });
      const payload = await response.json();
      const quote = isValidBranchQuote(payload.quote) && payload.quote.slug === slug &&
        payload.quote.controlVersion === job.controlVersion ? payload.quote : null;
      const result = { slug, ...(observed ?? { status: 'source_unknown', sourceSucceeded: false,
        sourceRequestCount: 0, reason: 'missing_result', diagnostics: [] }), httpStatus: response.status, quote,
        completedAtMs: nowImpl() };
      if (result.status === 'probe_succeeded' && !quote) Object.assign(result, { status: 'source_unknown', reason: 'invalid_probe_result' });
      await save({ results: [...job.results, result], currentSlug: null });
      if (result.status !== 'probe_succeeded' || !quote || response.status !== 200) return await stop(result.reason ?? 'invalid_probe_result');
      if (index + 1 < SLUGS.length) {
        const random = randomImpl();
        const ms = 2_000 + Math.floor(Math.max(0, Math.min(1, Number.isFinite(random) ? random : 0)) * 3_000);
        if (nowImpl() + ms + 15_000 >= job.deadlineAtMs) return await stop('deadline');
        await sleepImpl(ms, signal);
      }
    }
    if (!await owns()) return await stop('lease_lost_or_deadline');
    await save({ status: 'complete', reason: null, completedAtMs: nowImpl() });
    return { replayed: false, summary: summarizeProbe(job) };
  } catch {
    try { return await stop(signal.aborted ? 'deadline' : 'background_probe_failed'); }
    catch { return { replayed: false, reason: 'job_state_unavailable' }; }
  } finally { clearTimeout(timer); await source.close(); }
}
