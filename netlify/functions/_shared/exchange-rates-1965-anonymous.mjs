import { ORANGE_BRANCHES } from '../../../src/data/exchange-rates-1965-branch.js';
import { SOURCE_BASE_URL, SOURCE_USER_AGENT } from './exchange-rates-1965-source.mjs';
import { recordSourceRequests } from './exchange-rates-1965-source-telemetry.mjs';

const TOKEN_URL = 'https://api.superrich1965.com/front/exchange-rate/oauth2/callback';
const RATE_URL = 'https://www.superrich1965.com/api/exchange-rate-service/v1/external-app-exchange-rate/get';
const REQUEST_URL = `${SOURCE_BASE_URL}/get`;
const TOKEN_SAFETY_MS = 30_000;
const TOKEN_RENEWAL_SKEW_MS = 2_000;

export const ANONYMOUS_SOURCE_PROFILE = Object.freeze({
  name: 'anonymous-api', concurrency: 1, minStartGapMs: 0,
  requestTimeoutMs: 12_000, deadlineMs: 15_000,
});

/** @param {unknown} value @param {string[]} keys @returns {value is Record<string, any>} */
function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Validate the same fixed branch contract the normal collector emits. No
 * caller URL, additional filter, credential or payload field reaches upstream.
 * @param {RequestInfo|URL} input @param {RequestInit|undefined} options
 */
function validRequest(input, options) {
  if (String(input) !== REQUEST_URL || options?.method !== 'POST' || typeof options.body !== 'string' || options.body.length > 4_096) return false;
  let payload;
  try { payload = JSON.parse(options.body); } catch { return false; }
  if (!hasExactKeys(payload, ['filters']) || !Array.isArray(payload.filters) || payload.filters.length !== 2 ||
      !payload.filters.every((/** @type {unknown} */ filter) => hasExactKeys(filter, ['field', 'value']))) return false;
  const company = payload.filters.find((/** @type {any} */ filter) => filter.field === 'company_code');
  const branch = payload.filters.find((/** @type {any} */ filter) => filter.field === 'branch_no');
  return company !== undefined && branch !== undefined && Object.values(ORANGE_BRANCHES).some(mapped =>
    company.value === mapped.companyCode && branch.value === mapped.branchNo);
}

/** These unsigned JWT claims are only an expiration hint. They do not verify
 * the token or authorize a request; only the fixed upstream API does that.
 * @param {string} token @param {unknown} expiresIn @param {number} startedAtMs
 */
function tokenExpiry(token, expiresIn, startedAtMs) {
  const hints = [];
  if (typeof expiresIn === 'number' && Number.isFinite(expiresIn)) hints.push(startedAtMs + expiresIn * 1_000);
  if (token.split('.').length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      if (typeof claims?.exp === 'number' && Number.isFinite(claims.exp)) hints.push(claims.exp * 1_000);
    } catch { /* Opaque tokens have no locally known lifetime. */ }
  }
  const finiteHints = hints.filter(Number.isFinite);
  return finiteHints.length ? Math.min(...finiteHints) : null;
}

/** @param {'token'|'rate'} stage @param {Response|null} response
 * @returns {import('./exchange-rates-1965-source-telemetry.mjs').SourceRequestDiagnostic}
 */
function diagnostic(stage, response) {
  const header = (/** @type {string} */ name) => response?.headers.get(name)?.replace(/[^\x20-\x7e]/g, '').slice(0, 100) ?? null;
  return { stage, status: response?.status ?? null, cfMitigated: header('cf-mitigated'),
    contentType: header('content-type'), retryAfter: header('retry-after'), rayId: header('cf-ray'), reason: null };
}

/** @param {Response} response */
const blocked = response => response.status === 403 || response.status === 429 ||
  response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge';

/** An invocation-scoped token session. Factory construction makes no request;
 * callers must first pass the existing control/cache/breaker/lease gates.
 * @param {{fetchImpl?:typeof fetch, nowImpl?:()=>number}} [input]
 */
export function createAnonymousApiSource({ fetchImpl = fetch, nowImpl = Date.now } = {}) {
  /** @type {{value:string, expiresAtMs:number}|null} */
  let cachedToken = null;
  let closed = false;
  let failed = false;
  let gate = Promise.resolve();

  const close = async () => { closed = true; cachedToken = null; };

  // The Actions caller may wait BEFORE acquiring a branch/source lease. Leave
  // enough room for startup reads as well as the unchanged 30-second margin.
  // This never fetches, clears a token, or retries a failed source request.
  const getReadyAtMs = () => {
    const nowMs = nowImpl();
    return !closed && !failed && cachedToken && Number.isFinite(cachedToken.expiresAtMs) &&
      cachedToken.expiresAtMs <= nowMs + TOKEN_SAFETY_MS + ANONYMOUS_SOURCE_PROFILE.deadlineMs
      ? Math.max(nowMs, cachedToken.expiresAtMs + TOKEN_RENEWAL_SKEW_MS) : nowMs;
  };

  /** @type {typeof fetch} */
  const wrappedFetch = async (input, options) => {
    if (!validRequest(input, options)) throw recordSourceRequests(new Error('invalid_anonymous_request'), []);
    /** @type {()=>void} */
    let release = () => {};
    const previous = gate;
    gate = new Promise(resolve => { release = () => resolve(); });
    await previous;
    /** @type {import('./exchange-rates-1965-source-telemetry.mjs').SourceRequestDiagnostic[]} */
    const diagnostics = [];
    const signal = options?.signal;
    try {
      if (closed || failed) throw new Error('anonymous_source_unavailable');
      signal?.throwIfAborted();
      let token = cachedToken;
      const previousValue = token?.value ?? null;
      if (token && token.expiresAtMs <= nowImpl() + TOKEN_SAFETY_MS) token = cachedToken = null;
      if (!token) {
        const startedAtMs = nowImpl();
        const observation = diagnostic('token', null);
        diagnostics.push(observation);
        const response = await fetchImpl(TOKEN_URL, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
          headers: { Accept: 'application/json', 'User-Agent': SOURCE_USER_AGENT }, signal });
        Object.assign(observation, diagnostic('token', response));
        if (blocked(response) || !response.ok) {
          failed = true;
          cachedToken = null;
          return recordSourceRequests(response, diagnostics);
        }
        let payload;
        try {
          const text = await response.text();
          if (text.length > 65_536) throw new Error('invalid_anonymous_token');
          payload = JSON.parse(text);
        }
        catch { observation.reason = signal?.aborted ? 'timeout' : 'invalid_token_json'; throw new Error('invalid_anonymous_token'); }
        signal?.throwIfAborted();
        if (closed) throw new Error('anonymous_source_unavailable');
        const value = payload?.accessToken;
        if (typeof value !== 'string' || !value || value.length > 16_384 || !/^[A-Za-z0-9._~+\/-]+={0,2}$/.test(value)) {
          observation.reason = 'invalid_token_value';
          throw new Error('invalid_anonymous_token');
        }
        const expiresAtMs = tokenExpiry(value, payload?.expires_in, startedAtMs);
        // Derived timing and an equality flag identify stale callback responses
        // without retaining a token, fingerprint, or JWT claims in diagnostics.
        observation.tokenReissued = previousValue === null ? null : Number(value === previousValue);
        observation.tokenRemainingSeconds = expiresAtMs === null ? null
          : Math.max(-86_400, Math.min(86_400, Math.floor((expiresAtMs - nowImpl()) / 1_000)));
        if (expiresAtMs !== null && expiresAtMs <= nowImpl() + TOKEN_SAFETY_MS) {
          observation.reason = expiresAtMs <= nowImpl() ? 'expired_token' : 'near_expiry_token';
          throw new Error('expired_anonymous_token');
        }
        // Unknown TTL permits this one quote only, never cross-quote reuse.
        token = { value, expiresAtMs: expiresAtMs ?? Number.POSITIVE_INFINITY };
        cachedToken = expiresAtMs === null ? null : token;
      }
      signal?.throwIfAborted();
      if (closed || token.expiresAtMs <= nowImpl() + TOKEN_SAFETY_MS) throw new Error('anonymous_source_unavailable');
      const observation = diagnostic('rate', null);
      diagnostics.push(observation);
      const response = await fetchImpl(RATE_URL, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': SOURCE_USER_AGENT,
          Authorization: `Bearer ${token.value}`, Referer: 'https://www.superrich1965.com/' }, body: options?.body, signal });
      Object.assign(observation, diagnostic('rate', response));
      signal?.throwIfAborted();
      if (blocked(response) || !response.ok) { failed = true; cachedToken = null; }
      return recordSourceRequests(response, diagnostics);
    } catch {
      failed = true;
      cachedToken = null;
      const last = diagnostics.at(-1);
      if (last && last.reason === null) last.reason = signal?.aborted ? 'timeout' : 'http_error';
      // Fixed messages and a private WeakMap keep token/body/exception data out
      // of public responses, logs, cache entries and propagated error text.
      throw recordSourceRequests(new Error('anonymous_source_failed'), diagnostics);
    } finally {
      release();
    }
  };
  return { fetchImpl: wrappedFetch, getReadyAtMs, close };
}
