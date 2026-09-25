import { branchQuoteFailure1965, DENOMS_1965, parseBranchExchange1965 } from '../../../src/data/exchange-rates-1965.js';
import { parseRetryAfter } from './exchange-rates-1965-breaker.mjs';

export const SOURCE_BASE_URL = 'https://www.superrich1965.com/spr/front/exchange-rate';
export const SOURCE_TIMEOUT_MS = 5_000;
export const SOURCE_DEADLINE_MS = 25_000;
export const SOURCE_MIN_START_GAP_MS = 200;
export const SOURCE_RETRY_MIN_WAIT_MS = 500;
export const SOURCE_MAX_CONCURRENCY = 2;
export const SOURCE_USER_AGENT = 'LingOrmBangkokMap/1.0 (+https://lingorm-map.netlify.app; contact: site issue form)';

/**
 * Pacing profiles. Every timing decision — start gap, per-request timeout,
 * whole-round deadline and the retry budget check — reads the SAME resolved
 * profile, so a slower client can never disagree with `canRetry()`.
 * @typedef {{name:string, concurrency:number, minStartGapMs:number, requestTimeoutMs:number, deadlineMs:number}} SourceProfile
 */

/** Netlify Scheduled Function defaults. Unchanged from the original constants. */
/** @type {SourceProfile} */
export const NETLIFY_SOURCE_PROFILE = Object.freeze({
  name: 'netlify',
  concurrency: SOURCE_MAX_CONCURRENCY,
  minStartGapMs: SOURCE_MIN_START_GAP_MS,
  requestTimeoutMs: SOURCE_TIMEOUT_MS,
  deadlineMs: SOURCE_DEADLINE_MS,
});

/** Local collector: one request at a time, 1.5s apart, 180s whole-round budget. */
/** @type {SourceProfile} */
export const LOCAL_SOURCE_PROFILE = Object.freeze({
  name: 'local',
  concurrency: 1,
  minStartGapMs: 1_500,
  requestTimeoutMs: SOURCE_TIMEOUT_MS,
  deadlineMs: 180_000,
});

export const SOURCE_PROFILES = Object.freeze({
  netlify: NETLIFY_SOURCE_PROFILE,
  local: LOCAL_SOURCE_PROFILE,
});

/**
 * @param {SourceProfile|'netlify'|'local'} [profile]
 * @param {{sourceDeadlineMs?:number, requestTimeoutMs?:number}} [overrides]
 * @returns {SourceProfile}
 */
export function resolveSourceProfile(profile = NETLIFY_SOURCE_PROFILE, overrides = {}) {
  const base = typeof profile === 'string' ? SOURCE_PROFILES[profile] : profile;
  if (!base || typeof base !== 'object') throw new Error('invalid_source_profile');
  const resolved = {
    name: typeof base.name === 'string' && base.name ? base.name : 'custom',
    concurrency: base.concurrency,
    minStartGapMs: base.minStartGapMs,
    requestTimeoutMs: overrides.requestTimeoutMs ?? base.requestTimeoutMs,
    deadlineMs: overrides.sourceDeadlineMs ?? base.deadlineMs,
  };
  const positive = (/** @type {unknown} */ value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (!positive(resolved.requestTimeoutMs) || !positive(resolved.deadlineMs) ||
      !Number.isSafeInteger(resolved.concurrency) || resolved.concurrency < 1 ||
      typeof resolved.minStartGapMs !== 'number' || !Number.isFinite(resolved.minStartGapMs) || resolved.minStartGapMs < 0) {
    throw new Error('invalid_source_profile');
  }
  return Object.freeze(resolved);
}

/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {{fetchImpl:typeof fetch, nowImpl:()=>number, sleepImpl:(ms:number)=>Promise<void>, functionStartedAtMs:number, profile:SourceProfile}} input
 */
function createPacedRequester({ fetchImpl, nowImpl, sleepImpl, functionStartedAtMs, profile }) {
  const deadlineAt = functionStartedAtMs + profile.deadlineMs;
  const master = new AbortController();
  let gate = Promise.resolve();
  let lastStartAt = Number.NEGATIVE_INFINITY;
  /** @type {Array<Record<string, string|number|null>>} */
  const diagnostics = [];
  /** @type {number[]} */
  const requestStartTimes = [];

  async function reserveStart() {
    /** @type {()=>void} */
    let release = () => {};
    /** @type {Promise<void>} */
    const mine = new Promise(resolve => { release = () => resolve(); });
    const previous = gate;
    gate = mine;
    await previous;
    try {
      const waitMs = Math.max(0, lastStartAt + profile.minStartGapMs - nowImpl());
      if (nowImpl() + waitMs >= deadlineAt) return null;
      if (waitMs > 0) await sleepImpl(waitMs);
      const startedAt = nowImpl();
      if (startedAt >= deadlineAt || master.signal.aborted) return null;
      lastStartAt = startedAt;
      requestStartTimes.push(startedAt);
      return startedAt;
    } finally {
      release();
    }
  }

  /** @param {{officialId:number, branchNo:string, companyCode:string}} branch */
  async function request(branch) {
    const startedAt = await reserveStart();
    if (startedAt === null) return { kind: 'deadline', reason: 'timeout' };
    const remaining = deadlineAt - nowImpl();
    if (remaining <= 0) return { kind: 'deadline', reason: 'timeout' };
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort('timeout'), Math.min(profile.requestTimeoutMs, remaining));
    const signal = AbortSignal.any([master.signal, timeoutController.signal]);
    try {
      const response = await fetchImpl(`${SOURCE_BASE_URL}/get`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': SOURCE_USER_AGENT,
        },
        body: JSON.stringify({ filters: [
          { field: 'company_code', value: branch.companyCode },
          { field: 'branch_no', value: branch.branchNo },
        ] }),
        signal,
      });
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), nowImpl());
      // Diagnostics contain bounded headers only, never the source payload.
      const header = (/** @type {string} */ name) => response.headers.get(name)?.replace(/[^\x20-\x7e]/g, '').slice(0, 100) ?? null;
      diagnostics.push({ officialId: branch.officialId, status: response.status,
        cfMitigated: header('cf-mitigated'), contentType: header('content-type'),
        retryAfter: header('retry-after'), rayId: header('cf-ray') });
      if (response.status === 403 || response.status === 429 || response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') {
        master.abort('source_blocked');
        return { kind: 'blocked', status: response.status, retryAfterMs };
      }
      if (!response.ok) {
        return response.status >= 500
          ? { kind: 'retryable', reason: 'http_error', status: response.status, retryAfterMs }
          : { kind: 'fatal', reason: 'http_error', status: response.status };
      }
      const body = await response.text();
      let payload;
      try { payload = JSON.parse(body); } catch { return { kind: 'fatal', reason: 'invalid' }; }
      return { kind: 'ok', payload };
    } catch {
      diagnostics.push({ officialId: branch.officialId, status: null, reason: timeoutController.signal.aborted ? 'timeout' : 'http_error' });
      return { kind: 'retryable', reason: timeoutController.signal.aborted ? 'timeout' : 'http_error' };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return { request, requestStartTimes, deadlineAt, diagnostics };
}

/** @param {number} nowMs @param {number} deadlineAt @param {number} waitMs @param {SourceProfile} profile */
function canRetry(nowMs, deadlineAt, waitMs, profile) {
  // Reserve a full request timeout plus a conservative pacing slot, both taken
  // from the SAME profile the requester paces with. The requester may not need
  // the whole gap, but a retry must never start with less than the profile's
  // contracted request budget.
  return nowMs + waitMs + profile.minStartGapMs + profile.requestTimeoutMs <= deadlineAt;
}

/** @param {any} result */
function unavailableReason(result) {
  return result?.reason === 'timeout' ? 'timeout' : result?.reason === 'invalid' ? 'invalid' : 'http_error';
}

/** Fetch only the reviewed fixed mapping. No live inventory or automatic identity matching. */
/**
 * @param {{mapping:any, fetchImpl?:typeof fetch, nowImpl?:()=>number, sleepImpl?:(ms:number)=>Promise<void>, functionStartedAtMs?:number, sourceDeadlineMs?:number, requestTimeoutMs?:number, profile?:SourceProfile|'netlify'|'local'}} input
 */
export async function collectSourceQuotes({
  mapping,
  fetchImpl = fetch,
  nowImpl = Date.now,
  sleepImpl = sleep,
  functionStartedAtMs = nowImpl(),
  sourceDeadlineMs,
  requestTimeoutMs,
  profile: requestedProfile = NETLIFY_SOURCE_PROFILE,
}) {
  const profile = resolveSourceProfile(requestedProfile, {
    ...(sourceDeadlineMs === undefined ? {} : { sourceDeadlineMs }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  });
  const mapped = Object.entries(mapping.branches).map(([slug, branch]) => ({ slug, ...branch }));
  const requester = createPacedRequester({ fetchImpl, nowImpl, sleepImpl, functionStartedAtMs, profile });
  let retryUsed = false;
  // These IDs describe the requested inventory, not an upstream identity claim.
  const sourceBranchIds = mapped.map(branch => branch.officialId);
  /** @type {number[]} */
  const unknownIds = [];
  /** @type {number[]} */
  const missingIds = [];
  const branchResults = new Map();
  /** @type {any} */
  let blockedResult = null;

  if (!blockedResult) {
    const targets = mapped;
    let cursor = 0;
    const worker = async () => {
      while (!blockedResult && cursor < targets.length) {
        const branch = targets[cursor++];
        const result = await requester.request(branch);
        branchResults.set(branch.officialId, result);
        if (result.kind === 'blocked') blockedResult = result;
        if (result.kind === 'deadline') break;
      }
    };
    await Promise.all(Array.from({ length: Math.min(profile.concurrency, targets.length) }, worker));

    if (!blockedResult && !retryUsed && branchResults.size === targets.length) {
      const candidate = targets.find(branch => branchResults.get(branch.officialId)?.kind === 'retryable');
      if (candidate !== undefined) {
        const first = branchResults.get(candidate.officialId);
        const retryAt = first.retryAfterMs ?? nowImpl() + SOURCE_RETRY_MIN_WAIT_MS;
        const waitMs = Math.max(SOURCE_RETRY_MIN_WAIT_MS, retryAt - nowImpl());
        if (canRetry(nowImpl(), requester.deadlineAt, waitMs, profile)) {
          retryUsed = true;
          await sleepImpl(waitMs);
          branchResults.set(candidate.officialId, await requester.request(candidate));
          if (branchResults.get(candidate.officialId).kind === 'blocked') blockedResult = branchResults.get(candidate.officialId);
        }
      }
    }
  }

  const quotes = mapped.map(branch => {
    const result = branchResults.get(branch.officialId);
    const quote = result?.kind === 'ok'
      ? parseBranchExchange1965(result.payload, { branchNo: branch.branchNo })
      : branchQuoteFailure1965(branch.branchNo, unavailableReason(result));
    return { slug: branch.slug, officialId: branch.officialId, companyCode: branch.companyCode, quote };
  });
  const validRateCount = quotes.reduce((count, branch) => count + DENOMS_1965.filter(denom => branch.quote.rates[denom].rateScaledE6 !== null).length, 0);
  const complete = quotes.length > 0 && quotes.every(branch => branch.quote.status === 'ok');
  const outcome = blockedResult ? 'blocked' : complete ? 'complete' : validRateCount > 0 ? 'partial' : 'failed';
  return {
    sourceBranchIds,
    unknownIds,
    missingIds,
    quotes,
    outcome,
    blockedStatus: blockedResult?.status ?? null,
    retryAfterMs: blockedResult?.retryAfterMs ?? null,
    requestCount: requester.requestStartTimes.length,
    requestStartTimes: requester.requestStartTimes,
    retryUsed,
    profile,
    diagnostics: requester.diagnostics,
  };
}
