// ═══════════════════════════════════════════════════
// SUPERRICH 1965 — PHASE A0 STEP 2 / DIAGNOSTIC (Netlify Deploy Preview only)
// docs/superrich1965-exchange-map-plan.zh-TW.md §2.1, §6 A0.
//
// TEMPORARY — DELETE once A0 is settled, together with
// scripts/superrich1965-a0-probe.mjs. Not production code: no scheduling,
// no retry, no circuit breaker, no storage. Do NOT merge to main.
//
//   /.netlify/functions/superrich1965-a0-probe            → 3-request diagnostic matrix
//   /.netlify/functions/superrich1965-a0-probe?only=rate  → just the original POST
// ═══════════════════════════════════════════════════

import { probeExchangeRatePost, runDiagnosticMatrix } from '../../scripts/superrich1965-a0-probe.mjs';

export default async function superrich1965A0Probe(request) {
  const params = new URL(request.url).searchParams;

  if (params.get('only') === 'rate') {
    const result = await probeExchangeRatePost(
      params.get('branch') ? { branchNo: params.get('branch') } : {}
    );
    console.log(JSON.stringify({ event: 'superrich1965_a0_probe', ...result }));
    return json({ environment: 'netlify', mode: 'rate-only', ...result }, result.ok ? 200 : 502);
  }

  const matrix = await runDiagnosticMatrix();
  console.log(JSON.stringify({ event: 'superrich1965_a0_matrix', verdict: matrix.verdict, summary: matrix.summary }));
  return json({ environment: 'netlify', mode: 'diagnostic-matrix', ...matrix }, 200);
}

/** @param {unknown} payload @param {number} status */
function json(payload, status) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
