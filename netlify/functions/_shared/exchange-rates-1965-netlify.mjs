import { createHmac, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readEffectiveControl } from './exchange-rates-1965-control.mjs';
import { readEntry, conditionalSetJSON } from './exchange-rates-1965-storage.mjs';
import { readSourceGuard } from './exchange-rates-1965-source-guard.mjs';
import { runActionsCollector } from './exchange-rates-1965-actions-runner.mjs';
import { queryBranchRates } from './exchange-rates-1965-on-demand.mjs';
import { ANONYMOUS_SOURCE_PROFILE } from './exchange-rates-1965-anonymous.mjs';

export const NETLIFY_SCHEDULE = '0,30 1-15 * * *';
export const NETLIFY_CONTROL_KEY = 'exchange-rates-1965/netlify/control';
export const SITE_ID = 'b5ac142c-7e21-4910-90f7-1719a9d90d5d';
const HALF_HOUR = 1_800_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HEX64 = /^[a-f0-9]{64}$/;
const DEPLOY = /^[a-f0-9]{24}$/;
/** @param {any} value @param {string[]} keys */
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Server-only binding. Its HMAC key must never enter a public response or log.
 * @param {any} value
 */
export function validNetlifyControl(value) {
  return exact(value, ['schemaVersion', 'enabled', 'bindingVersion', 'quoteControlVersion', 'deployID', 'commit', 'branch', 'context', 'hmacKey', 'changedAt']) &&
    value.schemaVersion === 1 && typeof value.enabled === 'boolean' && UUID.test(value.bindingVersion) &&
    UUID.test(value.quoteControlVersion) && DEPLOY.test(value.deployID) && /^[a-f0-9]{40}$/.test(value.commit) &&
    typeof value.branch === 'string' && /^[A-Za-z0-9_./-]{1,255}$/.test(value.branch) &&
    ['production', 'deploy-preview'].includes(value.context) && (value.context !== 'production' || value.branch === 'main') &&
    HEX64.test(value.hmacKey) && typeof value.changedAt === 'string' && Number.isFinite(Date.parse(value.changedAt));
}

/** @param {any} binding */
export function publicNetlifyControl(binding) {
  if (!validNetlifyControl(binding)) return null;
  const { hmacKey, ...safe } = binding;
  return safe;
}

/** @param {number} nowMs */
export function scheduledSlot(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  const slotMs = Math.floor(nowMs / HALF_HOUR) * HALF_HOUR;
  const hour = new Date(slotMs).getUTCHours();
  return hour >= 1 && hour <= 15 ? slotMs : null;
}
/** @param {number} slotMs */
export const netlifySlotKey = slotMs => `exchange-rates-1965/netlify/slots/${slotMs}`;
/** @param {any} binding */
export const bindingBaseURL = binding => binding.context === 'production'
  ? 'https://lingorm-map.netlify.app' : `https://${binding.deployID}--lingorm-map.netlify.app`;
/** @param {any} identity @param {any} binding */
function matches(identity, binding) {
  return validNetlifyControl(binding) && binding.enabled && identity.siteID === SITE_ID &&
    identity.deployID === binding.deployID && identity.context === binding.context;
}
/** @param {string} body @param {any} binding */
export const signNetlifyWork = (body, binding) => createHmac('sha256', binding.hmacKey).update(body).digest('hex');

/** The fixed published URL detects a deployment change without exposing a PAT.
 * Preview verification uses the immutable reviewed deploy URL.
 * @param {any} binding @param {typeof fetch} [fetchImpl]
 */
export async function verifyRuntimeBinding(binding, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${bindingBaseURL(binding)}/api/exchange-rates-1965-runtime`, {
      method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const text = await response.text();
    if (text.length > 4096) return false;
    const value = JSON.parse(text);
    return value.schemaVersion === 1 && value.siteID === SITE_ID && value.deployID === binding.deployID && value.context === binding.context;
  } catch { return false; }
}

/** @param {any} store @param {any} identity */
async function readyBinding(store, identity) {
  const binding = (await readEntry(store, NETLIFY_CONTROL_KEY))?.data;
  if (!matches(identity, binding)) return null;
  const effective = await readEffectiveControl(store, 'false');
  return effective.enabled && effective.control?.controlVersion === binding.quoteControlVersion ? binding : null;
}

/** No public URL can invoke a scheduled function. The admin CLI may call this
 * same dispatcher after independently verifying deploy metadata.
 * @param {{store:any,sourceGuardStore:any,identity:any,fetchImpl?:typeof fetch,nowImpl?:()=>number,trigger?:'schedule'|'manual'}} input
 */
export async function dispatchNetlifyRates({ store, sourceGuardStore, identity, fetchImpl = fetch, nowImpl = Date.now, trigger = 'schedule' }) {
  const slotMs = scheduledSlot(nowImpl());
  if (slotMs === null) return { status: 'skipped', reason: 'outside_schedule' };
  const binding = await readyBinding(store, identity);
  if (!binding) return { status: 'skipped', reason: 'netlify_disabled_or_stale_binding' };
  if (trigger === 'schedule' && identity.context !== 'production') return { status: 'skipped', reason: 'preview_schedule_disabled' };
  if (!await verifyRuntimeBinding(binding, fetchImpl)) return { status: 'skipped', reason: 'stale_target' };
  const guard = await readSourceGuard({ store: sourceGuardStore, nowMs: nowImpl() });
  if (!guard.ok) return { status: 'skipped', reason: guard.reason };
  const key = netlifySlotKey(slotMs);
  const body = JSON.stringify({ slotMs, bindingVersion: binding.bindingVersion, deployID: binding.deployID, trigger });
  const record = { schemaVersion: 1, slotMs, bindingVersion: binding.bindingVersion, deployID: binding.deployID,
    trigger, status: 'pending', createdAtMs: nowImpl(), completedAtMs: null, summary: null };
  const write = await conditionalSetJSON(store, key, record, null);
  if (!write.modified) return { status: 'skipped', reason: 'slot_already_dispatched', slotMs };
  // A timeout is an unknown dispatch outcome. Never send another worker for
  // the same slot; only its persistent receipt can establish completion.
  try {
    const response = await fetchImpl(`https://${binding.deployID}--lingorm-map.netlify.app/.netlify/functions/exchange-rates-1965-worker`, {
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-lingorm-signature': signNetlifyWork(body, binding) },
      body, signal: AbortSignal.timeout(8000),
    });
    return { status: response.status === 202 ? 'dispatched' : 'dispatch_rejected', slotMs, workerHttpStatus: response.status };
  } catch { return { status: 'dispatch_outcome_unknown', slotMs }; }
}

/** @param {string} body @param {string|null} signature @param {any} binding @param {number} nowMs */
export function parseNetlifyWork(body, signature, binding, nowMs) {
  if (!validNetlifyControl(binding) || !HEX64.test(signature ?? '') || body.length > 1024) return null;
  if (!timingSafeEqual(Buffer.from(signature ?? ''), Buffer.from(signNetlifyWork(body, binding)))) return null;
  try {
    const value = JSON.parse(body);
    return exact(value, ['slotMs', 'bindingVersion', 'deployID', 'trigger']) &&
      value.slotMs === scheduledSlot(value.slotMs) && value.slotMs <= nowMs && nowMs - value.slotMs < HALF_HOUR &&
      value.bindingVersion === binding.bindingVersion && value.deployID === binding.deployID &&
      ['schedule', 'manual'].includes(value.trigger) ? value : null;
  } catch { return null; }
}

/** @param {{store:any,sourceGuardStore:any,identity:any,body:string,signature:string|null,source:any,
 * fetchImpl?:typeof fetch,nowImpl?:()=>number,sleepImpl?:(ms:number,signal:AbortSignal)=>Promise<void>,randomImpl?:()=>number}} input
 */
export async function runNetlifyRates({ store, sourceGuardStore, identity, body, signature, source,
  fetchImpl = fetch, nowImpl = Date.now, sleepImpl = async (ms, signal) => { await delay(ms, undefined, { signal }); }, randomImpl }) {
  try {
    const binding = await readyBinding(store, identity);
    const work = binding && parseNetlifyWork(body, signature, binding, nowImpl());
    if (!work) return { status: 'skipped', reason: 'unauthorized_or_stale_work' };
    const key = netlifySlotKey(work.slotMs);
    const entry = await readEntry(store, key);
    const slot = entry?.data;
    if (!slot || slot.status !== 'pending' || slot.deployID !== binding.deployID || slot.bindingVersion !== binding.bindingVersion ||
        slot.slotMs !== work.slotMs || nowImpl() >= slot.createdAtMs + 12 * 60_000) return { status: 'skipped', reason: 'slot_already_started_or_expired' };
    if (!await verifyRuntimeBinding(binding, fetchImpl)) return { status: 'skipped', reason: 'stale_target' };
    const claimed = await conditionalSetJSON(store, key, { ...slot, status: 'running' }, entry);
    if (!claimed.modified || !claimed.etag) return { status: 'skipped', reason: 'slot_already_started' };
    const verifyCurrent = async () => {
      const current = await readyBinding(store, identity);
      return current?.bindingVersion === binding.bindingVersion && await verifyRuntimeBinding(binding, fetchImpl);
    };
    const summary = await runActionsCollector({ store, repository: `netlify/${SITE_ID}`, runId: String(work.slotMs),
      commit: binding.commit, controlVersion: binding.quoteControlVersion, mode: 'publish-all-python', scope: 'all',
      target: { alias: binding.context === 'production' ? 'production' : 'preview-reviewed', siteID: SITE_ID,
        deployID: binding.context === 'production' ? null : binding.deployID, branch: binding.branch, commit: binding.commit, context: binding.context },
      nowImpl, sleepImpl, ...(randomImpl ? { randomImpl } : {}),
      collectorImpl: async (/** @type {any} */ options) => queryBranchRates({ ...options, store, sourceGuardStore,
        requireExistingControl: true, enabledDefault: 'false', expectedControlVersion: binding.quoteControlVersion,
        refreshDue: true, fetchImpl: source.fetchImpl, nowImpl,
        sourceProfile: { ...ANONYMOUS_SOURCE_PROFILE, name: 'netlify-python-safari' },
        beforeSource: async () => await options.beforeSource() && await verifyCurrent(),
        beforePublish: async () => await options.beforePublish() && await verifyCurrent(),
        prepareSource: async () => {
          const readyAtMs = source.getReadyAtMs();
          if (readyAtMs <= nowImpl()) return null;
          const guard = await readSourceGuard({ store: sourceGuardStore, nowMs: nowImpl() });
          if (!guard.ok) return { reason: guard.reason ?? 'source_guard_unavailable' };
          console.info(JSON.stringify({ event: 'exchange_rates_1965_token_wait', waitMs: readyAtMs - nowImpl() }));
          while (nowImpl() < readyAtMs) {
            if (!await options.beforeSource()) return { reason: 'lease_lost_or_deadline' };
            await sleepImpl(Math.min(1000, readyAtMs - nowImpl()), options.signal);
          }
          return await verifyCurrent() ? null : { reason: 'stale_target' };
        },
      }),
    });
    const receipt = await conditionalSetJSON(store, key, { ...slot, status: summary.exitCode === 0 ? 'complete' : 'stopped',
      completedAtMs: nowImpl(), summary }, { data: slot, etag: claimed.etag });
    if (!receipt.modified) return { status: 'receipt_unavailable', slotMs: work.slotMs, summary };
    return { status: summary.exitCode === 0 ? 'complete' : 'stopped', slotMs: work.slotMs, summary };
  } finally { await source.close(); }
}
