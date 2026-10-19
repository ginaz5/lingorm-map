import { ORANGE_BRANCHES } from '../../../src/data/exchange-rates-1965-branch.js';
import { SOURCE_BASE_URL } from './exchange-rates-1965-source.mjs';
import { ANONYMOUS_SOURCE_PROFILE, createAnonymousApiSource } from './exchange-rates-1965-anonymous.mjs';

export const BROWSER_PAGE_URL = 'https://www.superrich1965.com/en/exchange-rate';
const RATE_URL = `${SOURCE_BASE_URL}/get`;
const RESPONSE_HEADERS = ['content-type', 'cf-mitigated', 'cf-ray', 'retry-after'];
export const BROWSER_SOURCE_PROFILE = Object.freeze({
  name: 'browser', concurrency: 1, minStartGapMs: 0, requestTimeoutMs: 23_000, deadlineMs: 25_000,
});

/** @param {unknown} value @returns {'http'|'browser'|'anonymous-api'} */
export function resolveSourceTransport(value) {
  if (value === undefined || value === null || value === '' || value === 'http') return 'http';
  if (value === 'browser') return value;
  if (value === 'anonymous-api') return value;
  throw new Error('invalid_source_transport');
}

/** Load bundled Linux Chromium only inside an authorized cold source request. */
async function launchBrowser() {
  const [{ default: chromium }, { chromium: playwright }] = await Promise.all([
    import('@sparticuz/chromium'), import('playwright-core'),
  ]);
  const executablePath = await chromium.executablePath();
  // Keep same-origin and TLS protections; do not expose server credentials to
  // the child browser process. Lambda still needs Chromium's sandbox flags.
  return playwright.launch({ args: chromium.args.filter(arg => !['--disable-web-security', '--allow-running-insecure-content'].includes(arg)),
    executablePath, headless: true, timeout: 8_000,
    env: Object.fromEntries(['PATH', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'HOME', 'TMPDIR']
      .filter(key => process.env[key] !== undefined).map(key => [key, /** @type {string} */ (process.env[key])])) });
}

/** A normal browser session, with no stealth patches, CAPTCHA solving or
 * imported clearance cookies. The official page initializes its own JS/cookies.
 * Automatic rate requests are suppressed so only the leased branch is fetched.
 * @param {{launchImpl?:()=>Promise<any>}} [input]
 */
export function createBrowserSource({ launchImpl = launchBrowser } = {}) {
  /** @type {any} */
  let browser = null;
  /** @type {Promise<any>|null} */
  let initialization = null;
  /** @type {string|null} */
  let permittedBody = null;
  let closed = false;
  let stage = 'launch';
  let rateRequestCount = 0;
  /** @param {string} result */
  const log = result => {
    try { console.info(JSON.stringify({ event: 'exchange_rates_1965_browser', stage, result, rateRequestCount })); }
    catch { /* Diagnostic output must not change collection. */ }
  };

  const close = async () => {
    closed = true;
    permittedBody = null;
    if (browser) {
      const current = browser;
      browser = null;
      await current.close().catch(() => {});
    }
  };
  const initialize = async () => {
    browser = await launchImpl();
    if (closed) { await close(); throw new Error('browser_closed'); }
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    stage = 'navigation';
    await page.route('**/*', async (/** @type {any} */ route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== new URL(BROWSER_PAGE_URL).origin && url.origin !== 'https://challenges.cloudflare.com') return route.abort();
      if (url.href === RATE_URL) {
        if (permittedBody !== null && request.method() === 'POST' && request.postData() === permittedBody) {
          permittedBody = null;
          rateRequestCount++;
          return route.continue();
        }
        return route.fulfill({ status: 204, body: '' });
      }
      if (['image', 'font', 'media'].includes(request.resourceType())) return route.abort();
      return route.continue();
    });
    const navigation = await page.goto(BROWSER_PAGE_URL, { waitUntil: 'networkidle', timeout: 18_000 });
    const headers = navigation ? await navigation.allHeaders() : {};
    // A challenge during navigation is returned to the existing breaker.
    if (navigation && (navigation.status() === 403 || navigation.status() === 429 || headers['cf-mitigated'] === 'challenge')) {
      log('blocked');
      return { page, blocked: { status: navigation.status(), headers } };
    }
    if (!navigation?.ok() || new URL(page.url()).origin !== new URL(BROWSER_PAGE_URL).origin) {
      throw new Error('browser_navigation_failed');
    }
    log('ready');
    return { page, blocked: null };
  };

  /** @type {typeof fetch} */
  const fetchImpl = async (input, options) => {
    if (closed || String(input) !== RATE_URL || options?.method !== 'POST' || typeof options.body !== 'string') {
      throw new Error('invalid_browser_request');
    }
    const payload = JSON.parse(options.body);
    const requestBody = options.body;
    const filters = payload?.filters;
    if (!Array.isArray(filters) || filters.length !== 2 || !Object.values(ORANGE_BRANCHES).some(branch =>
      filters[0]?.field === 'company_code' && filters[0]?.value === branch.companyCode &&
      filters[1]?.field === 'branch_no' && filters[1]?.value === branch.branchNo)) throw new Error('invalid_browser_branch');
    const signal = options.signal;
    signal?.throwIfAborted();
    /** @type {(()=>void)|undefined} */
    let abort;
    const aborted = new Promise((_, reject) => {
      abort = () => { void close(); reject(new Error('browser_aborted')); };
      signal?.addEventListener('abort', abort, { once: true });
    });
    try {
      const work = async () => {
        initialization ??= initialize();
        const session = await initialization;
        signal?.throwIfAborted();
        if (session.blocked) return new Response(null, { status: session.blocked.status,
          headers: Object.fromEntries(RESPONSE_HEADERS.filter(key => session.blocked.headers[key]).map(key => [key, session.blocked.headers[key]])) });
        permittedBody = requestBody;
        stage = 'rate';
        const result = await session.page.evaluate(async (/** @type {{url:string,body:string}} */ request) => {
          const response = await fetch(request.url, { method: 'POST', body: request.body,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            credentials: 'same-origin', cache: 'no-store', redirect: 'error', mode: 'same-origin' });
          const body = await response.text();
          if (body.length > 1_000_000) throw new Error('browser_response_too_large');
          return { status: response.status, body, headers: Object.fromEntries(
            ['content-type', 'cf-mitigated', 'cf-ray', 'retry-after'].map(key => [key, response.headers.get(key)]).filter(([, value]) => value !== null)) };
        }, { url: RATE_URL, body: requestBody });
        log(result.status === 403 || result.status === 429 || result.headers['cf-mitigated'] === 'challenge' ? 'blocked' : 'complete');
        return new Response([204, 205, 304].includes(result.status) ? null : result.body, { status: result.status, headers: result.headers });
      };
      return await Promise.race([work(), aborted]);
    } catch (error) {
      log(signal?.aborted ? 'timeout' : 'failed');
      throw error;
    } finally {
      if (abort) signal?.removeEventListener('abort', abort);
      permittedBody = null;
    }
  };
  return { fetchImpl, close };
}

/** HTTP remains the compatibility default. Each worker owns its source session;
 * no token, browser, cookie or user profile is shared across invocations.
 * @param {{transport?:unknown,fetchImpl?:typeof fetch,launchImpl?:()=>Promise<any>,nowImpl?:()=>number}} [input]
 */
export function createSourceSession({ transport = process.env.EXCHANGE_RATES_1965_SOURCE_TRANSPORT,
  fetchImpl = fetch, launchImpl, nowImpl = Date.now } = {}) {
  const selected = resolveSourceTransport(transport);
  if (selected === 'http') return { fetchImpl, sourceProfile: undefined, close: async () => {} };
  if (selected === 'anonymous-api') return { ...createAnonymousApiSource({ fetchImpl, nowImpl }), sourceProfile: ANONYMOUS_SOURCE_PROFILE };
  const source = createBrowserSource({ launchImpl });
  return { ...source, sourceProfile: BROWSER_SOURCE_PROFILE };
}
