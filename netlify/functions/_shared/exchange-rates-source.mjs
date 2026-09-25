import { branchQuoteFailure, DENOMS, parseBranchExchange, parseBranchOptions } from '../../../src/data/exchange-rates.js';
import { parseRetryAfter } from './exchange-rates-breaker.mjs';

export const SOURCE_BASE_URL = 'https://api.superrichthailand.com/api/v1';
export const SOURCE_TIMEOUT_MS = 5_000;
export const SOURCE_DEADLINE_MS = 25_000;
export const SOURCE_MIN_START_GAP_MS = 200;
export const SOURCE_RETRY_MIN_WAIT_MS = 500;
export const SOURCE_MAX_CONCURRENCY = 2;
export const SOURCE_USER_AGENT = 'LingOrmBangkokMap/1.0 (+https://lingorm-map.netlify.app; contact: site issue form)';

/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {{fetchImpl:typeof fetch, nowImpl:()=>number, sleepImpl:(ms:number)=>Promise<void>, functionStartedAtMs:number, sourceDeadlineMs:number, requestTimeoutMs:number}} input
 */
function createPacedRequester({ fetchImpl, nowImpl, sleepImpl, functionStartedAtMs, sourceDeadlineMs, requestTimeoutMs }) {
  const deadlineAt = functionStartedAtMs + sourceDeadlineMs;
  const master = new AbortController();
  let gate = Promise.resolve();
  let lastStartAt = Number.NEGATIVE_INFINITY;
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
      const waitMs = Math.max(0, lastStartAt + SOURCE_MIN_START_GAP_MS - nowImpl());
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

  /** @param {string} path */
  async function request(path) {
    const startedAt = await reserveStart();
    if (startedAt === null) return { kind: 'deadline', reason: 'timeout' };
    const remaining = deadlineAt - nowImpl();
    if (remaining <= 0) return { kind: 'deadline', reason: 'timeout' };
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort('timeout'), Math.min(requestTimeoutMs, remaining));
    const signal = AbortSignal.any([master.signal, timeoutController.signal]);
    try {
      const response = await fetchImpl(`${SOURCE_BASE_URL}/${path}`, {
        headers: { 'X-Language-Code': 'en', 'User-Agent': SOURCE_USER_AGENT },
        signal,
      });
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), nowImpl());
      if (response.status === 403 || response.status === 429) {
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
      return { kind: 'retryable', reason: timeoutController.signal.aborted ? 'timeout' : 'http_error' };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return { request, requestStartTimes, deadlineAt };
}

/** @param {number} nowMs @param {number} deadlineAt @param {number} waitMs */
function canRetry(nowMs, deadlineAt, waitMs) {
  // Reserve a full request timeout plus a conservative pacing slot. The
  // requester may not need all 200ms, but a retry must never start with less
  // than the contracted five-second request budget.
  return nowMs + waitMs + SOURCE_MIN_START_GAP_MS + SOURCE_TIMEOUT_MS <= deadlineAt;
}

/** @param {any} result */
function unavailableReason(result) {
  return result?.reason === 'timeout' ? 'timeout' : result?.reason === 'invalid' ? 'invalid' : 'http_error';
}

/** Fetch the inventory and every known branch with one shared retry budget. */
/**
 * @param {{mapping:any, fetchImpl?:typeof fetch, nowImpl?:()=>number, sleepImpl?:(ms:number)=>Promise<void>, functionStartedAtMs?:number, sourceDeadlineMs?:number, requestTimeoutMs?:number}} input
 */
export async function collectSourceQuotes({
  mapping,
  fetchImpl = fetch,
  nowImpl = Date.now,
  sleepImpl = sleep,
  functionStartedAtMs = nowImpl(),
  sourceDeadlineMs = SOURCE_DEADLINE_MS,
  requestTimeoutMs = SOURCE_TIMEOUT_MS,
}) {
  const mapped = Object.entries(mapping.branches).map(([slug, branch]) => ({ slug, ...branch }));
  const byId = new Map(mapped.map(branch => [branch.officialId, branch]));
  const requester = createPacedRequester({ fetchImpl, nowImpl, sleepImpl, functionStartedAtMs, sourceDeadlineMs, requestTimeoutMs });
  let retryUsed = false;
  let optionsResult = await requester.request('branch-client/options');
  if (optionsResult.kind === 'retryable') {
    const retryAt = optionsResult.retryAfterMs ?? nowImpl() + SOURCE_RETRY_MIN_WAIT_MS;
    const waitMs = Math.max(SOURCE_RETRY_MIN_WAIT_MS, retryAt - nowImpl());
    if (canRetry(nowImpl(), requester.deadlineAt, waitMs)) {
      retryUsed = true;
      await sleepImpl(waitMs);
      optionsResult = await requester.request('branch-client/options');
    }
  }

  /** @type {number[]} */
  let sourceBranchIds = [];
  let inventoryValid = false;
  if (optionsResult.kind === 'ok') {
    const parsed = parseBranchOptions(optionsResult.payload);
    if (parsed) {
      sourceBranchIds = parsed;
      inventoryValid = true;
    } else {
      optionsResult = { kind: 'fatal', reason: 'invalid' };
    }
  }
  const unknownIds = sourceBranchIds.filter(id => !byId.has(id));
  const missingIds = mapped.map(branch => branch.officialId).filter(id => !sourceBranchIds.includes(id));
  const branchResults = new Map();
  let blockedResult = optionsResult.kind === 'blocked' ? optionsResult : null;

  if (inventoryValid && !blockedResult) {
    const targets = sourceBranchIds.filter(id => byId.has(id));
    let cursor = 0;
    const worker = async () => {
      while (!blockedResult && cursor < targets.length) {
        const id = targets[cursor++];
        const result = await requester.request(`exchange-client/list?branchId=${id}&type=exchange`);
        branchResults.set(id, result);
        if (result.kind === 'blocked') blockedResult = result;
        if (result.kind === 'deadline') break;
      }
    };
    await Promise.all(Array.from({ length: Math.min(SOURCE_MAX_CONCURRENCY, targets.length) }, worker));

    if (!blockedResult && !retryUsed && branchResults.size === targets.length) {
      const candidate = targets.find(id => branchResults.get(id)?.kind === 'retryable');
      if (candidate !== undefined) {
        const first = branchResults.get(candidate);
        const retryAt = first.retryAfterMs ?? nowImpl() + SOURCE_RETRY_MIN_WAIT_MS;
        const waitMs = Math.max(SOURCE_RETRY_MIN_WAIT_MS, retryAt - nowImpl());
        if (canRetry(nowImpl(), requester.deadlineAt, waitMs)) {
          retryUsed = true;
          await sleepImpl(waitMs);
          branchResults.set(candidate, await requester.request(`exchange-client/list?branchId=${candidate}&type=exchange`));
          if (branchResults.get(candidate).kind === 'blocked') blockedResult = branchResults.get(candidate);
        }
      }
    }
  }

  const quotes = mapped.map(branch => {
    if (!inventoryValid) return { slug: branch.slug, expectedBranchCode: branch.branchCode, quote: branchQuoteFailure(branch.officialId, unavailableReason(optionsResult)) };
    if (!sourceBranchIds.includes(branch.officialId)) return { slug: branch.slug, expectedBranchCode: branch.branchCode, quote: branchQuoteFailure(branch.officialId, 'missing') };
    const result = branchResults.get(branch.officialId);
    const quote = result?.kind === 'ok'
      ? parseBranchExchange(result.payload, { officialId: branch.officialId, expectedBranchCode: branch.branchCode })
      : branchQuoteFailure(branch.officialId, unavailableReason(result));
    return { slug: branch.slug, expectedBranchCode: branch.branchCode, quote };
  });
  const validRateCount = quotes.reduce((count, branch) => count + DENOMS.filter(denom => branch.quote.rates[denom].rateScaledE6 !== null).length, 0);
  const complete = inventoryValid && unknownIds.length === 0 && missingIds.length === 0 && quotes.every(branch => branch.quote.status === 'ok');
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
  };
}
