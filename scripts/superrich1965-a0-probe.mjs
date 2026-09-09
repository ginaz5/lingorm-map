// ═══════════════════════════════════════════════════
// SUPERRICH 1965 — PHASE A0 POST FEASIBILITY PROBE
// docs/superrich1965-exchange-map-plan.zh-TW.md §2.1, §6 A0.
//
// TEMPORARY. This exists only to answer one question: does a server-side POST
// (no browser, no JS, no Cloudflare challenge token) to
// `exchange-rate/get` succeed? Delete this file and
// netlify/functions/superrich1965-a0-probe.mjs once A0 is recorded.
//
// A0 is TWO steps and both are required:
//   1. Local terminal  — `node scripts/superrich1965-a0-probe.mjs`
//      A pre-check only. Proves the API accepts this request body. It does NOT
//      complete A0: a home/office IP gets different Cloudflare bot-management
//      treatment than a datacenter one.
//   2. Netlify Deploy Preview — hit the deployed probe Function's URL.
//      THIS is A0's completion criterion, because the real scheduler will run
//      from that same IP range.
// ═══════════════════════════════════════════════════

import { parseBranchExchange1965 } from '../src/data/exchange-rates-1965.js';

export const PROBE_URL = 'https://www.superrich1965.com/spr/front/exchange-rate/get';
export const PROBE_COMPANY_CODE = 'A04';
export const PROBE_BRANCH_NO = '00'; // Silom Plaza, the source's own default
export const PROBE_TIMEOUT_MS = 10_000;
// Identifiable on purpose (plan §2.1): a probe that hides what it is cannot
// be allow-listed or complained about, and that is not the relationship we
// want with the source.
export const PROBE_USER_AGENT =
  'LingOrmBangkokMap/1.0 (+https://lingorm-map.netlify.app; contact: site issue form)';

/**
 * One POST, fully self-describing result. Never throws: the failure shape is
 * the finding.
 * @param {{ branchNo?: string, fetchImpl?: typeof fetch }} [options]
 */
export async function probeExchangeRatePost(options = {}) {
  const branchNo = options.branchNo ?? PROBE_BRANCH_NO;
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = JSON.stringify({
    filters: [
      { field: 'company_code', value: PROBE_COMPANY_CODE },
      { field: 'branch_no', value: branchNo },
    ],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAtMs = Date.now();

  try {
    const response = await fetchImpl(PROBE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': PROBE_USER_AGENT,
      },
      body,
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    const elapsedMs = Date.now() - startedAtMs;

    // A Cloudflare interstitial is HTML, often still with a 2xx/403 status.
    // Distinguishing it from a real API answer is the whole point of A0.
    const looksLikeChallenge =
      /text\/html/i.test(contentType) ||
      /cf-browser-verification|challenge-platform|__cf_chl|Just a moment/i.test(text.slice(0, 4000));

    /** @type {unknown} */
    let payload = null;
    let parseError = null;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      parseError = error instanceof Error ? error.message : 'json_parse_failed';
    }

    const quote = payload === null ? null : parseBranchExchange1965(payload, { branchNo });

    return {
      ok: response.ok && !looksLikeChallenge && quote?.status === 'ok',
      httpStatus: response.status,
      contentType,
      elapsedMs,
      looksLikeChallenge,
      retryAfter: response.headers.get('retry-after'),
      cfRay: response.headers.get('cf-ray'),
      parseError,
      // The contract check: A0 passes only when the response also parses into
      // usable USD/TWD numbers, not merely when the POST returns 200.
      quoteStatus: quote?.status ?? null,
      usdRateScaledE6: quote?.rates?.USD_1965?.rateScaledE6 ?? null,
      twdRateScaledE6: quote?.rates?.TWD_1965?.rateScaledE6 ?? null,
      sourceUpdatedAtMs: quote?.sourceUpdatedAtMs ?? null,
      bodySnippet: text.slice(0, 300),
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      contentType: null,
      elapsedMs: Date.now() - startedAtMs,
      looksLikeChallenge: false,
      retryAfter: null,
      cfRay: null,
      parseError: null,
      quoteStatus: null,
      usdRateScaledE6: null,
      twdRateScaledE6: null,
      sourceUpdatedAtMs: null,
      transportError: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      bodySnippet: '',
    };
  } finally {
    clearTimeout(timer);
  }
}

// CLI entry: `node scripts/superrich1965-a0-probe.mjs [branchNo]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const branchNo = process.argv[2];
  const result = await probeExchangeRatePost(branchNo ? { branchNo } : {});
  console.log(JSON.stringify(result, null, 2));
  console.log(result.ok
    ? '\nA0 step 1 (local) PASSED — now deploy and run step 2 on a Netlify Deploy Preview.'
    : '\nA0 step 1 (local) FAILED — see the fields above before touching step 2.');
  process.exit(result.ok ? 0 : 1);
}
