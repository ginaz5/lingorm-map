import { state } from '../core/state.js';
import { ORANGE_BRANCHES, parseBranchQueryPayload } from '../data/exchange-rates-1965-branch.js';

export const BRANCH_QUERY_API = '/api/exchange-rates-1965-branch';
export const BRANCH_QUERY_TIMEOUT_MS = 12_000;
/** @typedef {{quote:any|null, expiresAtMs:number|null, loading:boolean, reason:string|null, retryAtMs:number|null}} BranchQueryState */
/** @type {Map<string,Promise<void>>} */
const requests = new Map();
/** @type {Map<string,AbortController>} */
const controllers = new Map();
/** @type {ReturnType<typeof setTimeout>|null} */
let timer = null;
/** @type {(()=>void)|null} */
let onChange = null;
let generation = 0;

/** @param {string} slug @returns {BranchQueryState|undefined} */
export function getBranchQueryState(slug) {
  const entry = state.exchange1965Branches[slug];
  if (!entry) return undefined;
  // Render paths independently guard time, including a suspended tab that has
  // not processed its expiry callback yet.
  return { ...entry, quote: entry.expiresAtMs !== null && entry.expiresAtMs > Date.now() ? entry.quote : null };
}

function notify() { onChange?.(); }

export function expireBranchQueries() {
  const now = Date.now();
  let changed = false;
  for (const entry of Object.values(state.exchange1965Branches)) {
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= now) {
      entry.quote = null;
      entry.expiresAtMs = null;
      changed = true;
    }
    if (entry.retryAtMs !== null && entry.retryAtMs <= now) {
      entry.retryAtMs = null;
      changed = true;
    }
  }
  if (changed) notify();
  scheduleExpiry();
}

function scheduleExpiry() {
  if (timer !== null) clearTimeout(timer);
  const deadlines = Object.values(state.exchange1965Branches).flatMap(entry =>
    [entry.expiresAtMs, entry.retryAtMs].filter((/** @type {number|null} */ value) => value !== null));
  timer = deadlines.length ? setTimeout(expireBranchQueries, Math.max(0, Math.min(.../** @type {number[]} */ (deadlines)) - Date.now())) : null;
}

/** Explicit user action only. No request is triggered by rendering or timers.
 * @param {string} slug @returns {Promise<void>}
 */
export function queryOrangeBranch(slug) {
  if (!Object.hasOwn(ORANGE_BRANCHES, slug)) return Promise.resolve();
  const pending = requests.get(slug);
  if (pending) return pending;
  const current = getBranchQueryState(slug);
  if (current?.quote || (current?.retryAtMs ?? 0) > Date.now()) return Promise.resolve();
  const sequence = generation;
  // Queue the async work after registering it, including synchronous fetch
  // failures; duplicate clicks always receive the same promise.
  const request = Promise.resolve().then(async () => {
    const entry = { quote: null, expiresAtMs: null, loading: true, reason: null, retryAtMs: null };
    state.exchange1965Branches[slug] = entry;
    const controller = new AbortController();
    controllers.set(slug, controller);
    const startedAtMs = Date.now();
    notify();
    const timeout = setTimeout(() => controller.abort(), BRANCH_QUERY_TIMEOUT_MS);
    try {
      const response = await fetch(BRANCH_QUERY_API, { method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }), signal: controller.signal });
      const payload = parseBranchQueryPayload(await response.json(), slug);
      if (!payload || (payload.quote && response.status !== 200)) throw new Error('invalid_branch_response');
      if (generation !== sequence) return;
      const observedAtMs = Date.parse(payload.checkedAt);
      if (observedAtMs < state.exchange1965BranchObservedAtMs && payload.controlVersion !== state.exchange1965BranchControlVersion) {
        state.exchange1965Branches[slug] = { quote: null, expiresAtMs: null, loading: false, reason: 'stale_control', retryAtMs: null };
        return;
      }
      state.exchange1965BranchObservedAtMs = Math.max(state.exchange1965BranchObservedAtMs, observedAtMs);
      if (payload.enabled === false || (payload.controlVersion && payload.controlVersion !== state.exchange1965BranchControlVersion)) {
        // Every manual quote belongs to one service-control generation. A
        // disable/re-enable observed by any card invalidates the others too.
        for (const [key, value] of Object.entries(state.exchange1965Branches)) {
          if (key !== slug) { value.quote = null; value.expiresAtMs = null; }
        }
        state.exchange1965BranchControlVersion = payload.controlVersion;
      }
      const expiresAtMs = payload.quote
        ? startedAtMs + Date.parse(payload.quote.expiresAt) - Date.parse(payload.checkedAt) : null;
      state.exchange1965Branches[slug] = {
        quote: expiresAtMs !== null && expiresAtMs > Date.now() ? payload.quote : null,
        expiresAtMs: expiresAtMs !== null && expiresAtMs > Date.now() ? expiresAtMs : null,
        loading: false, reason: payload.reason,
        retryAtMs: payload.retryAfterSeconds > 0 ? Date.now() + payload.retryAfterSeconds * 1000 : null,
      };
    } catch {
      if (generation !== sequence) return;
      state.exchange1965Branches[slug] = { quote: null, expiresAtMs: null, loading: false,
        reason: 'unavailable', retryAtMs: Date.now() + 60_000 };
    } finally {
      clearTimeout(timeout);
      if (generation === sequence) {
        controllers.delete(slug);
        requests.delete(slug);
        notify();
        scheduleExpiry();
      }
    }
  });
  requests.set(slug, request);
  return request;
}

export function cancelBranchQueries() {
  generation++;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  controllers.forEach(controller => controller.abort());
  controllers.clear();
  requests.clear();
  Object.values(state.exchange1965Branches).forEach(entry => { entry.loading = false; });
}

/** @param {()=>void} listener */
export function initBranchQueries(listener) {
  onChange = listener;
  // Capture avoids activating the surrounding list card before its button
  // handles the event; works for re-rendered list cards and both map popups.
  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-orange-query]') : null;
    if (!(button instanceof HTMLButtonElement)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!button.disabled) void queryOrangeBranch(button.dataset.orangeQuery || '');
  }, true);
  document.addEventListener('visibilitychange', expireBranchQueries);
  window.addEventListener('pageshow', expireBranchQueries);
  // Expiry continues offline. Reconnecting never triggers an upstream query.
  window.addEventListener('online', expireBranchQueries);
  expireBranchQueries();
}
