// ═══════════════════════════════════════════════════
// SUPERRICH 1965 — PHASE A0 FEASIBILITY PROBE
// docs/superrich1965-exchange-map-plan.zh-TW.md §2.1, §6 A0.
//
// TEMPORARY. Delete this file and netlify/functions/superrich1965-a0-probe.mjs
// once A0 is settled.
//
// 2026-09-10: Step 2 came back 403 + Cloudflare "Just a moment..." from the
// Netlify (US datacenter) environment. This revision adds a three-request
// DIAGNOSTIC MATRIX to tell apart the three possible causes:
//
//   GET /spr/front/branches            ← known to answer cleanly elsewhere
//   POST /spr/front/exchange-rate/branch-list   ← a different POST, same prefix
//   POST /spr/front/exchange-rate/get           ← the one that 403'd
//
//   all pass ................ earlier failure was transient
//   GET ok, both POST 403 ... POST is blocked from datacenter IPs
//   GET + list ok, get 403 .. that one endpoint has a stricter rule
//   all 403 ................. the whole domain blocks datacenter IPs
//
// Every request carries the same identifiable User-Agent. The matrix varies
// ONLY method and path: this is diagnosis, not an attempt to find a request
// shape that slips past the challenge. Working around Cloudflare's challenge
// (spoofed browser UA, headless-browser token solving, residential proxies)
// is out of scope for this project — the challenge is the operator saying no.
// ═══════════════════════════════════════════════════

import { parseBranchExchange1965, parseBranchList1965 } from '../src/data/exchange-rates-1965.js';

export const SOURCE_ORIGIN = 'https://www.superrich1965.com';
export const PROBE_COMPANY_CODE = 'A04';
export const PROBE_BRANCH_NO = '00'; // Silom Plaza, the source's own default
export const PROBE_TIMEOUT_MS = 10_000;
export const PROBE_GAP_MS = 500; // don't burst three requests at the source
export const PROBE_USER_AGENT =
  'LingOrmBangkokMap/1.0 (+https://lingorm-map.netlify.app; contact: site issue form)';

const rateBody = (branchNo) => ({
  filters: [
    { field: 'company_code', value: PROBE_COMPANY_CODE },
    { field: 'branch_no', value: branchNo },
  ],
});

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One request, fully self-describing result. Never throws: the failure shape
 * is the finding.
 * @param {{ method:string, path:string, body?:unknown, label:string,
 *           interpret?:(payload:unknown)=>Record<string, unknown>,
 *           fetchImpl?:typeof fetch }} spec
 */
export async function probeEndpoint(spec) {
  const { method, path, body, label, interpret, fetchImpl = fetch } = spec;
  const url = `${SOURCE_ORIGIN}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAtMs = Date.now();

  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        accept: 'application/json',
        'user-agent': PROBE_USER_AGENT,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();

    // A Cloudflare interstitial is HTML, often with a 403. Telling it apart
    // from a real API answer is the whole point of this probe.
    const looksLikeChallenge =
      /text\/html/i.test(contentType) ||
      /cf-browser-verification|challenge-platform|__cf_chl|Just a moment/i.test(text.slice(0, 4000));

    /** @type {unknown} */
    let payload = null;
    let parseError = null;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      parseError = error instanceof Error ? error.message.slice(0, 80) : 'json_parse_failed';
    }

    const detail = payload !== null && interpret ? interpret(payload) : {};
    const contractOk = detail.contractOk !== false && payload !== null;

    return {
      label, method, path,
      ok: response.ok && !looksLikeChallenge && contractOk,
      httpStatus: response.status,
      contentType,
      elapsedMs: Date.now() - startedAtMs,
      looksLikeChallenge,
      retryAfter: response.headers.get('retry-after'),
      cfRay: response.headers.get('cf-ray'),
      cfMitigated: response.headers.get('cf-mitigated'),
      parseError,
      ...detail,
      bodySnippet: text.slice(0, 200),
    };
  } catch (error) {
    return {
      label, method, path,
      ok: false,
      httpStatus: null,
      contentType: null,
      elapsedMs: Date.now() - startedAtMs,
      looksLikeChallenge: false,
      retryAfter: null,
      cfRay: null,
      cfMitigated: null,
      parseError: null,
      transportError: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      bodySnippet: '',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The original Step 1 / Step 2 check: a single POST to exchange-rate/get.
 * @param {{ branchNo?: string, fetchImpl?: typeof fetch }} [options]
 */
export async function probeExchangeRatePost(options = {}) {
  const branchNo = options.branchNo ?? PROBE_BRANCH_NO;
  return probeEndpoint({
    label: 'rate-get',
    method: 'POST',
    path: '/spr/front/exchange-rate/get',
    body: rateBody(branchNo),
    fetchImpl: options.fetchImpl,
    interpret: (payload) => {
      const quote = parseBranchExchange1965(payload, { branchNo });
      return {
        contractOk: quote.status === 'ok',
        quoteStatus: quote.status,
        usdRateScaledE6: quote.rates.USD_1965.rateScaledE6,
        twdRateScaledE6: quote.rates.TWD_1965.rateScaledE6,
        sourceUpdatedAtMs: quote.sourceUpdatedAtMs,
      };
    },
  });
}

/**
 * Three requests from one environment, so the results are directly
 * comparable. Sequential with a gap — never a burst.
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export async function runDiagnosticMatrix(options = {}) {
  const { fetchImpl } = options;
  /** @type {any[]} */
  const results = [];

  results.push(await probeEndpoint({
    label: 'branches-get',
    method: 'GET',
    path: '/spr/front/branches?page=1&limit=5',
    fetchImpl,
    interpret: (payload) => ({
      contractOk: typeof payload === 'object' && payload !== null,
      shapeHint: Object.keys(/** @type {object} */ (payload)).slice(0, 6).join(','),
    }),
  }));
  await sleep(PROBE_GAP_MS);

  results.push(await probeEndpoint({
    label: 'branch-list-post',
    method: 'POST',
    path: '/spr/front/exchange-rate/branch-list',
    body: { filters: [{ field: 'company_code', value: PROBE_COMPANY_CODE }] },
    fetchImpl,
    interpret: (payload) => {
      const entries = parseBranchList1965(payload);
      return { contractOk: entries !== null, branchCount: entries?.length ?? null };
    },
  }));
  await sleep(PROBE_GAP_MS);

  results.push(await probeExchangeRatePost({ fetchImpl }));

  const [get, list, rate] = results;
  let verdict;
  if (get.ok && list.ok && rate.ok) verdict = 'all_pass__earlier_failure_was_transient';
  else if (!get.ok && !list.ok && !rate.ok) verdict = 'all_blocked__domain_blocks_datacenter_ips';
  else if (get.ok && !list.ok && !rate.ok) verdict = 'post_blocked__method_level_rule';
  else if (get.ok && list.ok && !rate.ok) verdict = 'rate_endpoint_blocked__endpoint_specific_rule';
  else verdict = 'mixed__see_individual_results';

  return {
    verdict,
    summary: results.map((r) => `${r.label} ${r.method} → ${r.ok ? 'OK' : `${r.httpStatus ?? 'ERR'}${r.looksLikeChallenge ? ' CHALLENGE' : ''}`}`),
    results,
  };
}

// CLI: `node scripts/superrich1965-a0-probe.mjs`           → single POST (Step 1)
//      `node scripts/superrich1965-a0-probe.mjs --matrix`  → the 3-request diagnostic
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes('--matrix')) {
    const matrix = await runDiagnosticMatrix();
    console.log(JSON.stringify(matrix, null, 2));
    console.log(`\nverdict: ${matrix.verdict}`);
    process.exit(0);
  }
  const branchNo = args.find((a) => !a.startsWith('--'));
  const result = await probeExchangeRatePost(branchNo ? { branchNo } : {});
  console.log(JSON.stringify(result, null, 2));
  console.log(result.ok
    ? '\nStep 1 (local) PASSED — now run step 2 on a Netlify Deploy Preview.'
    : '\nStep 1 (local) FAILED — see the fields above.');
  process.exit(result.ok ? 0 : 1);
}
