// Experimental only. No production function imports this module.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ORANGE_BRANCHES, isValidBranchQuote } from '../../src/data/exchange-rates-1965-branch.js';
import { parseBranchExchange1965 } from '../../src/data/exchange-rates-1965.js';
import { quoteExpiryMs } from '../../src/data/exchange-rate-timing.js';
import { beginSourceAttempt, validateSourceAttemptLease, finishSourceAttempt, releaseSourceAttempt } from '../../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { readEntry, conditionalSetJSON } from '../../netlify/functions/_shared/exchange-rates-1965-storage.mjs';
import { parseRetryAfter } from '../../netlify/functions/_shared/exchange-rates-1965-breaker.mjs';

export const PARALLEL_SLUGS = Object.freeze(Object.keys(ORANGE_BRANCHES));
export const PARALLEL_BUDGET_MS = 90_000;
const REASONS = new Set([null, 'timeout', 'http_error', 'near_expiry_token']);
const HEADERS = new Set(['content-type', 'cf-mitigated', 'cf-ray', 'retry-after']);
/** @param {any} row */
const blocked = row => row?.status === 403 || row?.status === 429 || row?.headers?.['cf-mitigated']?.toLowerCase() === 'challenge';

/** Bodies are parsed in memory and discarded. Only existing quote fields and
 * bounded diagnostics leave the subprocess bridge.
 * @param {{executable:string,helper:string,env:NodeJS.ProcessEnv,controlVersion:string,spawnImpl?:typeof spawn}} input
 */
export function createParallelPythonProbe({ executable, helper, env, controlVersion, spawnImpl = spawn }) {
  /** @param {{beforeRates:()=>Promise<boolean>}} input */
  return async ({ beforeRates }) => new Promise(resolve => {
    /** @type {Map<string,any>} */
    const rows = new Map();
    /** @type {any} */
    let token = null;
    let ready = false, done = false, stopped = false, buffer = '', totalBytes = 0;
    const child = spawnImpl(executable, ['-I', '-B', helper], { shell: false, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stop = () => { stopped = true; child.kill('SIGKILL'); };
    let phaseTimer = setTimeout(stop, 15_000);
    const totalTimer = setTimeout(stop, 40_000);
    const nextPhase = () => { clearTimeout(phaseTimer); phaseTimer = setTimeout(stop, 15_000); };
    /** @param {any} event */
    const observe = event => {
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('invalid_event');
      if (event.event === 'token_started' && !token && Number.isSafeInteger(event.startedAtMs)) {
        token = { startedAtMs: event.startedAtMs, status: null, headers: {}, reason: null, completedAtMs: null };
      } else if (event.event === 'headers') {
        const row = event.stage === 'token' ? token : event.stage === 'rate' ? rows.get(event.slug) : null;
        if (!row || row.status !== null || !Number.isInteger(event.status) || event.status < 100 || event.status > 599 ||
            !event.headers || typeof event.headers !== 'object' || Array.isArray(event.headers) ||
            !Object.entries(event.headers).every(([k,v]) => HEADERS.has(k) && typeof v === 'string' && /^[\x20-\x7e]{0,100}$/.test(v))) throw new Error('invalid_headers');
        row.status = event.status; row.headers = { ...event.headers };
      } else if (event.event === 'token_result' && token && token.completedAtMs === null &&
          REASONS.has(event.reason) && Number.isSafeInteger(event.completedAtMs)) {
        token.reason = event.reason; token.completedAtMs = event.completedAtMs;
      } else if (event.event === 'ready' && !ready && token?.completedAtMs && token.reason === null &&
          token.status === 200 && !blocked(token) && event.requested === 38) {
        ready = true;
        clearTimeout(phaseTimer);
        void beforeRates().then(allowed => {
          if (!allowed || stopped) return stop();
          nextPhase(); child.stdin?.end('{"action":"rates"}\n');
        }).catch(stop);
      } else if (event.event === 'started' && ready && Object.hasOwn(ORANGE_BRANCHES, event.slug) &&
          !rows.has(event.slug) && Number.isSafeInteger(event.startedAtMs)) {
        rows.set(event.slug, { slug: event.slug, startedAtMs: event.startedAtMs, completedAtMs: null,
          status: null, headers: {}, reason: null, quote: null });
      } else if (event.event === 'result') {
        const row = rows.get(event.slug);
        if (!row || row.completedAtMs !== null || !REASONS.has(event.reason) ||
            typeof event.body !== 'string' || Buffer.byteLength(event.body) > 1024 * 1024 ||
            !Number.isSafeInteger(event.completedAtMs) || event.completedAtMs < row.startedAtMs) throw new Error('invalid_result');
        row.completedAtMs = event.completedAtMs; row.reason = event.reason;
        if (row.status === 200 && !blocked(row) && event.reason === null) {
          try {
            const mapping = ORANGE_BRANCHES[row.slug];
            const parsed = parseBranchExchange1965(JSON.parse(event.body), { branchNo: mapping.branchNo });
            const quote = { schemaVersion: 1, slug: row.slug, controlVersion,
              attemptedAt: new Date(row.startedAtMs).toISOString(), completedAt: new Date(row.completedAtMs).toISOString(),
              expiresAt: new Date(quoteExpiryMs(row.startedAtMs)).toISOString(),
              branch: { slug: row.slug, ...mapping, status: parsed.status, rates: parsed.rates } };
            if (isValidBranchQuote(quote)) row.quote = quote;
            else row.reason = 'invalid';
          } catch { row.reason = 'invalid'; }
        } else if (row.reason === null) row.reason = 'http_error';
      } else if (event.event === 'done' && !done && [0,38].includes(event.ratePosts) &&
          event.ratePosts === rows.size && [...rows.values()].every(row => row.completedAtMs !== null)) {
        done = true; clearTimeout(phaseTimer);
      } else throw new Error('invalid_event');
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (/** @type {string} */ chunk) => {
      totalBytes += Buffer.byteLength(chunk);
      if (stopped || totalBytes > 38 * 7 * 1024 * 1024 + 128 * 1024) return stop();
      buffer += chunk;
      let index;
      while (!stopped && (index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0,index); buffer = buffer.slice(index+1);
        try { observe(JSON.parse(line)); } catch { stop(); }
      }
      if (Buffer.byteLength(buffer) > 7 * 1024 * 1024) stop();
    });
    child.stderr?.resume();
    child.stdin?.on('error', stop); child.stdout?.on('error', stop); child.on('error', stop);
    child.once('close', code => {
      clearTimeout(totalTimer); clearTimeout(phaseTimer);
      resolve({ settled: code === 0 && done && !stopped && buffer === '', token, results: [...rows.values()] });
    });
    child.stdin?.write('{"operation":"parallel38"}\n');
  });
}

/** @param {any} job */
export function summarizeParallelProbe(job) {
  const results = job.results ?? [];
  const starts = results.map((/** @type {any} */ row) => row.startedAtMs);
  const events = results.flatMap((/** @type {any} */ row) => [[row.startedAtMs,1],[row.completedAtMs ?? job.completedAtMs,-1]])
    .sort((/** @type {number[]} */ a,/** @type {number[]} */ b) => a[0]-b[0] || a[1]-b[1]);
  let current = 0, peakInFlight = 0;
  for (const [,delta] of events) { current += delta; peakInFlight = Math.max(peakInFlight,current); }
  return { status: job.status, reason: job.reason ?? null, requested: 38, concurrency: 38,
    sourceSucceeded: results.filter((/** @type {any} */ row) => row.quote !== null).length,
    failed: results.filter((/** @type {any} */ row) => row.completedAtMs !== null && row.quote === null).length,
    notAttempted: 38-results.length, published: 0, cacheHit: 0,
    tokenGets: job.token ? 1 : 0, ratePosts: results.length, sourceRequestCount: (job.token ? 1 : 0)+results.length,
    peakInFlight, launchSpreadMs: starts.length ? Math.max(...starts)-Math.min(...starts) : null,
    elapsedMs: job.startedAtMs ? (job.completedAtMs ?? job.startedAtMs)-job.startedAtMs : 0 };
}

/** One exclusive shared source lease covers the whole explicitly recorded batch.
 * Its legacy slug is the anchor only; the isolated durable job records ALL 38
 * planned slugs before any HTTP. Unknown subprocess outcomes keep the source
 * paused/unresolved; no partial result is ever published as a quote cache.
 * @param {{store:any,sourceGuardStore:any,jobKey:string,deployID:string,execute:any,nowImpl?:()=>number,randomUUIDImpl?:()=>string}} input
 */
export async function runParallelProbe({ store, sourceGuardStore, jobKey, deployID, execute, nowImpl = Date.now, randomUUIDImpl = randomUUID }) {
  let entry = await readEntry(store,jobKey);
  if (!entry || entry.data?.status !== 'pending' || entry.data.deployID !== deployID) return { replayed:true };
  let job = entry.data;
  if (job.requested !== 38 || JSON.stringify(job.plannedSlugs) !== JSON.stringify(PARALLEL_SLUGS) ||
      job.deadlineAtMs <= nowImpl() || job.deadlineAtMs > nowImpl()+PARALLEL_BUDGET_MS) return { replayed:true,reason:'invalid_job' };
  const ownerId = randomUUIDImpl();
  const claim = { ...job,status:'running',ownerId,startedAtMs:nowImpl() };
  const claimed = await conditionalSetJSON(store,jobKey,claim,entry);
  if (!claimed.modified || !claimed.etag) return { replayed:true };
  job=claim; entry={data:job,etag:claimed.etag};
  /** @param {any} changes */
  const save = async changes => {
    const next={...job,...changes};const write=await conditionalSetJSON(store,jobKey,next,entry);
    if(!write.modified || !write.etag) throw new Error('job_conflict');
    job=next;entry={data:next,etag:write.etag};
  };
  const begun = await beginSourceAttempt({ store:sourceGuardStore,operationId:job.operationId,ownerId,
    slug:PARALLEL_SLUGS[0],leaseMs:PARALLEL_BUDGET_MS,nowMs:nowImpl(),randomUUIDImpl });
  if (!begun.ok) { await save({status:'stopped',reason:begun.reason,completedAtMs:nowImpl()});return {replayed:false,summary:summarizeParallelProbe(job)}; }
  let recorded = false;
  try {
    const beforeRates = async () => {
      const current = await readEntry(store,jobKey);
      return nowImpl()+15_000 < job.deadlineAtMs && current?.data.ownerId===ownerId && current.data.status==='running' &&
        (await validateSourceAttemptLease({store:sourceGuardStore,lease:begun.lease,nowMs:nowImpl()})).ok;
    };
    if (!await beforeRates()) throw new Error('source_lease_lost');
    const result = await execute({beforeRates});
    const complete = result.settled && result.results.length===38 && result.results.every((/** @type {any} */ row)=>row.quote!==null);
    const outcome = !result.settled ? 'unknown' : [result.token,...result.results].some(blocked) ? 'blocked' : complete ? 'complete' : 'failed';
    await save({token:result.token,results:result.results,status:complete?'complete':'stopped',reason:complete?null:outcome,
      completedAtMs:nowImpl()});
    const retryAfterMs = Math.max(0,...[result.token,...result.results].map(row=>parseRetryAfter(row?.headers?.['retry-after'],nowImpl())??0));
    const finished = await finishSourceAttempt({store:sourceGuardStore,lease:begun.lease,outcome,nowMs:nowImpl(),retryAfterMs});
    recorded=finished.ok;
    if(!finished.ok) await save({status:'stopped',reason:'guard_outcome_unavailable'});
    return {replayed:false,summary:summarizeParallelProbe(job)};
  } catch {
    const finished = await finishSourceAttempt({store:sourceGuardStore,lease:begun.lease,outcome:'unknown',nowMs:nowImpl()});
    recorded=finished.ok;
    try {await save({status:'stopped',reason:'unknown',completedAtMs:nowImpl()});}catch{}
    return {replayed:false,summary:summarizeParallelProbe(job)};
  } finally {
    if(recorded) await releaseSourceAttempt({store:sourceGuardStore,lease:begun.lease,nowMs:nowImpl()});
  }
}
