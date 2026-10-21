import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ORANGE_BRANCHES, isValidBranchQuote } from '../../../src/data/exchange-rates-1965-branch.js';
import { nextUtcHalfHour } from '../../../src/data/exchange-rate-timing.js';
import { readEffectiveControl } from './exchange-rates-1965-control.mjs';
import { branchCacheKey, queryBranchRates } from './exchange-rates-1965-on-demand.mjs';
import { conditionalSetJSON, readEntry } from './exchange-rates-1965-storage.mjs';

export const BATCH_JOB_KEY = 'exchange-rates-1965/background-job';
export const BATCH_BUDGET_MS = 12 * 60_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {any} value */
function validJob(value) {
  return value && uuidPattern.test(value.token) && uuidPattern.test(value.controlVersion) &&
    ['pending', 'running', 'complete', 'stopped', 'dispatch_failed'].includes(value.status) &&
    Number.isSafeInteger(value.scheduledAtMs) && Number.isSafeInteger(value.deadlineAtMs) &&
    (value.leaseId === null || uuidPattern.test(value.leaseId));
}

/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** No UI progress and no all-or-nothing snapshot: each success retains its own
 * expiry. Errors stop this job and leave all previously cached quotes intact.
 * @param {{store:any,token:string,enabledDefault?:unknown,nowImpl?:()=>number,fetchImpl?:typeof fetch,sleepImpl?:(ms:number)=>Promise<void>,randomImpl?:()=>number,randomUUIDImpl?:()=>string,slugs?:string[],sourceProfile?:import('./exchange-rates-1965-source.mjs').SourceProfile}} input
 */
export async function runSlowBatch({ store, token, enabledDefault = process.env.EXCHANGE_RATES_1965_ENABLED,
  nowImpl = Date.now, fetchImpl = fetch, sleepImpl = sleep, randomImpl = Math.random, randomUUIDImpl = randomUUID,
  slugs = Object.keys(ORANGE_BRANCHES), sourceProfile }) {
  if (!uuidPattern.test(token)) return { status: 'unauthorized', loaded: 0 };
  const entry = await readEntry(store, BATCH_JOB_KEY);
  const job = entry?.data;
  if (!validJob(job) || !timingSafeEqual(Buffer.from(token), Buffer.from(job.token)) ||
      job.status !== 'pending' || job.deadlineAtMs <= nowImpl()) return { status: 'unauthorized', loaded: 0 };
  const lease = { ...job, status: 'running', leaseId: randomUUIDImpl() };
  const acquired = await conditionalSetJSON(store, BATCH_JOB_KEY, lease, entry);
  if (!acquired.modified) return { status: 'skipped', loaded: 0 };
  let status = 'complete', reason = null, loaded = 0;
  /** @type {string|null} */
  let stoppedSlug = null;
  try {
    for (let index = 0; index < slugs.length; index++) {
      if (nowImpl() + (sourceProfile?.deadlineMs ?? 6_000) + 1_000 >= lease.deadlineAtMs) { status = 'stopped'; reason = 'deadline'; break; }
      const currentJob = (await readEntry(store, BATCH_JOB_KEY))?.data;
      if (currentJob?.leaseId !== lease.leaseId) { status = 'stopped'; reason = 'lease_lost'; break; }
      const control = await readEffectiveControl(store, enabledDefault);
      if (!control.enabled || control.control?.controlVersion !== job.controlVersion) { status = 'stopped'; reason = 'stale_control'; break; }
      const slug = slugs[index];
      if (!Object.hasOwn(ORANGE_BRANCHES, slug)) { status = 'stopped'; reason = 'invalid_branch'; break; }
      const cached = (await readEntry(store, branchCacheKey(slug)))?.data;
      if (isValidBranchQuote(cached) && cached.slug === slug && cached.controlVersion === job.controlVersion &&
          Date.parse(cached.attemptedAt) >= Date.parse(control.control.enabledAt ?? '') &&
          Date.parse(cached.expiresAt) > nowImpl() && nowImpl() < nextUtcHalfHour(Date.parse(cached.attemptedAt))) continue;
      const response = await queryBranchRates({ store, slug, enabledDefault, nowImpl, fetchImpl, randomUUIDImpl,
        refreshDue: true, expectedControlVersion: job.controlVersion, sourceProfile });
      const body = await response.json();
      if (response.status !== 200 || !body.quote) { status = 'stopped'; reason = body.reason ?? 'unavailable'; stoppedSlug = slug; break; }
      loaded++;
      if (index + 1 < slugs.length) {
        const delay = 2_000 + Math.floor(Math.max(0, Math.min(1, randomImpl())) * 3_000);
        await sleepImpl(delay);
      }
    }
  } catch { status = 'stopped'; reason = 'storage_unavailable'; }
  await conditionalSetJSON(store, BATCH_JOB_KEY, { ...lease, status }, { data: lease, etag: acquired.etag });
  return { status, reason, loaded, stoppedSlug };
}
