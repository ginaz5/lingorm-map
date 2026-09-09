// ═══════════════════════════════════════════════════
// SUPERRICH 1965 — PHASE A0 STEP 2 (Netlify Deploy Preview only)
// docs/superrich1965-exchange-map-plan.zh-TW.md §2.1, §6 A0.
//
// TEMPORARY — DELETE AFTER A0 IS RECORDED, together with
// scripts/superrich1965-a0-probe.mjs. This is not production code: no
// scheduling, no retry, no circuit breaker, no storage (those are Phase C).
//
// It exists because a successful POST from a home network does not predict a
// successful POST from Netlify's datacenter IP range, and the scheduler will
// run here. Deploy to a Deploy Preview branch and hit:
//   <deploy-preview-url>/.netlify/functions/superrich1965-a0-probe
// Do NOT merge this to main.
// ═══════════════════════════════════════════════════

import { probeExchangeRatePost } from '../../scripts/superrich1965-a0-probe.mjs';

export default async function superrich1965A0Probe(request) {
  const branchNo = new URL(request.url).searchParams.get('branch') ?? undefined;
  const result = await probeExchangeRatePost(branchNo ? { branchNo } : {});
  console.log(JSON.stringify({ event: 'superrich1965_a0_probe', ...result }));
  return new Response(JSON.stringify({ environment: 'netlify', ...result }, null, 2), {
    status: result.ok ? 200 : 502,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
