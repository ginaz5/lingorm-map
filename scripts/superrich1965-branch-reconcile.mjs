#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// SUPERRICH 1965 — PHASE A1 BRANCH RECONCILIATION (local only)
// docs/superrich1965-exchange-map-plan.zh-TW.md §2.3, §4, §6 A1.
//
// Cross-references the two branch lists that use DIFFERENT numbering:
//
//   GET  /spr/front/branch-groups   → which group slug means "Our Branch"
//   GET  /spr/front/branches        → id, slug, title, lat/lng, address, groups[]
//   POST /spr/front/exchange-rate/branch-list → code (= branch_no), name
//
// The two lists share no key — only names, and the names do not match exactly
// ("Central World" vs "CentralWorld", "Big C Ratchadapisek" vs "Big C Place
// Ratchadapisek"). So this script PROPOSES pairings with a confidence tier and
// writes a review report; it never decides. Plan §2.3 requires per-entry human
// verification before anything reaches Notion.
//
// RUN THIS LOCALLY, NOT ON NETLIFY. `GET /spr/front/branches` is the request
// Cloudflare challenges from datacenter IPs (progress doc, A0 #3); it answers
// normally from a residential connection.
//
//   node scripts/superrich1965-branch-reconcile.mjs
//   node scripts/superrich1965-branch-reconcile.mjs --dump tmp/raw
//
// Outputs (both are DRAFTS for review, neither is production data):
//   docs/superrich1965-branch-verification.zh-TW.md
//   data/superrich1965-branches.draft.json
// ═══════════════════════════════════════════════════

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBranchList1965 } from '../src/data/exchange-rates-1965.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://www.superrich1965.com';
const USER_AGENT =
  'LingOrmBangkokMap/1.0 (+https://lingorm-map.netlify.app; contact: site issue form)';
const TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [2_000, 5_000];
const GAP_MS = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch JSON, retrying only on an intermittent Cloudflare challenge.
 * We adjust WHEN we retry, never WHO we say we are: the User-Agent stays
 * identifiable. If the challenge persists, that is a real answer, not a
 * puzzle to solve.
 */
async function fetchJson(path, { method = 'GET', body } = {}) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${ORIGIN}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          'user-agent': USER_AGENT,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const text = await response.text();
      const challenged =
        response.headers.get('cf-mitigated') === 'challenge' ||
        /text\/html/i.test(response.headers.get('content-type') ?? '');

      if (challenged) {
        if (attempt < RETRY_DELAYS_MS.length) {
          console.error(`  ⚠ ${method} ${path} 被 Cloudflare 挑戰，${RETRY_DELAYS_MS[attempt] / 1000}s 後重試…`);
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new Error(
          `${method} ${path} 連續被 Cloudflare 挑戰。這支請從住宅網路跑，不要從資料中心/VPN。稍後再試也可能就過了（挑戰是間歇性的）。`
        );
      }
      if (!response.ok) throw new Error(`${method} ${path} → HTTP ${response.status}`);
      return JSON.parse(text);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── name normalisation ─────────────────────────────────────────────────────
// Drops parenthesised Thai, punctuation and spacing so "Central World" and
// "CentralWorld" collapse to the same key. Deliberately lossy: it is a
// candidate generator, not an identity test.
export function normalize(name) {
  return String(name ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function tokens(name) {
  return String(name ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Dice coefficient over character bigrams. No dependencies, good enough for ranking. */
export function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s) => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  for (const [g, count] of ga) shared += Math.min(count, gb.get(g) ?? 0);
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

/**
 * @param {{code:string,name:string,companyCode:string,isDefault:boolean}} entry
 * @param {any[]} branches
 */
export function proposeMatch(entry, branches) {
  const key = entry.name;
  const norm = normalize(key);
  const toks = tokens(key);

  const scored = branches.map((branch) => {
    const candidates = [branch.title?.en, branch.title?.cn, branch.title?.th, branch.slug]
      .filter((v) => typeof v === 'string' && v.trim());
    let best = { tier: 'none', score: 0, via: null };
    for (const candidate of candidates) {
      const cNorm = normalize(candidate);
      const cToks = tokens(candidate);
      let tier = null;
      if (cNorm && cNorm === norm) tier = 'exact';
      else if (cNorm && norm && (cNorm.includes(norm) || norm.includes(cNorm))) tier = 'contained';
      else if (toks.length && cToks.length &&
               (toks.every((t) => cToks.includes(t)) || cToks.every((t) => toks.includes(t)))) tier = 'token-subset';
      const score = similarity(norm, cNorm);
      const rank = { exact: 3, contained: 2, 'token-subset': 1 }[tier] ?? 0;
      const bestRank = { exact: 3, contained: 2, 'token-subset': 1 }[best.tier] ?? 0;
      if (rank > bestRank || (rank === bestRank && score > best.score)) {
        best = { tier: tier ?? 'fuzzy', score, via: candidate };
      }
    }
    return { branch, ...best };
  }).sort((a, b) => {
    const rank = (t) => ({ exact: 3, contained: 2, 'token-subset': 1, fuzzy: 0, none: 0 })[t] ?? 0;
    return rank(b.tier) - rank(a.tier) || b.score - a.score;
  });

  const top = scored[0];
  const runnerUp = scored[1];
  // An "exact" that a second branch also matches exactly is not exact enough.
  const ambiguous = Boolean(top && runnerUp && top.tier === runnerUp.tier && Math.abs(top.score - runnerUp.score) < 0.02);
  return { top, runnerUp, ambiguous };
}

export function groupsOf(branch) {
  return (Array.isArray(branch?.groups) ? branch.groups : [])
    .map((g) => (typeof g === 'string' ? g : g?.slug ?? g?.name ?? ''))
    .filter(Boolean);
}

/**
 * Pair every branch-list entry with a /branches candidate.
 *
 * Also catches the failure the per-entry check cannot see: TWO entries landing
 * on the SAME official branch. The draft mapping is keyed by
 * `superrich1965-{officialId}`, so a collision would silently overwrite one
 * entry and ship a branch_no under the wrong branch's name — and the orange
 * source sends no branch identifier to catch that later (plan §2). Loud here
 * or wrong forever.
 *
 * @param {{code:string,name:string,companyCode:string,isDefault:boolean}[]} rateBranches
 * @param {any[]} branches
 */
export function reconcile(rateBranches, branches) {
  const rows = rateBranches.map((entry) => {
    const { top, runnerUp, ambiguous } = proposeMatch(entry, branches);
    const branch = top?.branch;
    const grp = branch ? groupsOf(branch) : [];
    return {
      code: entry.code,
      name: entry.name,
      companyCode: entry.companyCode,
      isDefault: entry.isDefault,
      tier: ambiguous ? 'ambiguous' : (top?.tier ?? 'none'),
      score: Number((top?.score ?? 0).toFixed(3)),
      matchedVia: top?.via ?? null,
      officialId: branch?.id ?? null,
      officialSlug: branch?.slug ?? null,
      officialTitleEn: branch?.title?.en ?? null,
      lat: branch?.latitude ?? null,
      lng: branch?.longitude ?? null,
      groups: grp,
      runnerUp: runnerUp ? `${runnerUp.branch?.title?.en ?? runnerUp.branch?.slug} (${runnerUp.score.toFixed(2)})` : null,
      collision: false,
    };
  });

  const byOfficialId = new Map();
  for (const row of rows) {
    if (row.officialId === null) continue;
    const seen = byOfficialId.get(row.officialId);
    if (seen) seen.push(row);
    else byOfficialId.set(row.officialId, [row]);
  }
  const collisions = [];
  for (const [officialId, group] of byOfficialId) {
    if (group.length < 2) continue;
    for (const row of group) row.collision = true;
    collisions.push({ officialId, codes: group.map((r) => r.code), names: group.map((r) => r.name) });
  }

  return { rows, collisions };
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
const dumpFlag = process.argv.indexOf('--dump');
const dumpDir = dumpFlag > -1 ? process.argv[dumpFlag + 1] : null;
const dump = (name, value) => {
  if (!dumpDir) return;
  const target = resolve(ROOT, dumpDir, `${name}.json`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(value, null, 2));
};

console.log('抓取三個來源…');

const groupsPayload = await fetchJson('/spr/front/branch-groups?page=1&limit=100');
dump('branch-groups', groupsPayload);
await sleep(GAP_MS);

const branchesPayload = await fetchJson('/spr/front/branches?page=1&limit=1000');
dump('branches', branchesPayload);
await sleep(GAP_MS);

const listPayload = await fetchJson('/spr/front/exchange-rate/branch-list', {
  method: 'POST',
  body: { filters: [{ field: 'company_code', value: 'A04' }] },
});
dump('exchange-rate-branch-list', listPayload);

const groupList = groupsPayload?.data?.datas ?? groupsPayload?.data ?? [];
const branches = branchesPayload?.data?.datas ?? branchesPayload?.data ?? [];
const rateBranches = parseBranchList1965(listPayload);

if (!Array.isArray(branches) || branches.length === 0) {
  throw new Error('/spr/front/branches 沒有回傳可用的陣列——請用 --dump 存下原始回應再看。');
}
if (!rateBranches) {
  throw new Error('exchange-rate/branch-list 不符合 parseBranchList1965 的契約——用 --dump 存下原始回應。');
}

console.log(`  branch-groups : ${Array.isArray(groupList) ? groupList.length : '?'} 組`);
console.log(`  branches      : ${branches.length} 筆`);
console.log(`  branch-list   : ${rateBranches.length} 筆\n`);

const { rows, collisions } = reconcile(rateBranches, branches);

const needsReview = rows.filter((r) => r.tier !== 'exact' || r.collision);
const ourBranchGuess = rows.filter((r) => r.groups.some((g) => /main|our/i.test(g)));
const partnerGuess = rows.filter((r) => r.groups.some((g) => /partner/i.test(g)));
const noGroup = rows.filter((r) => r.groups.length === 0);

console.log(`配對結果：exact ${rows.length - needsReview.length} / 需人工確認 ${needsReview.length}`);
console.log(`分組推測：Our ${ourBranchGuess.length} / Partner ${partnerGuess.length} / 無分組或未配對 ${noGroup.length}\n`);
if (collisions.length) {
  console.log(`\n  ✗ ${collisions.length} 組配對衝突——多筆 branch-list 對到同一間分店，必須人工拆開：`);
  for (const c of collisions) {
    console.log(`      officialId ${c.officialId} ← ${c.codes.join(', ')}  (${c.names.join(' / ')})`);
  }
  console.log('');
}
for (const r of needsReview) {
  console.log(`  [${(r.collision ? 'COLLISION' : r.tier).padEnd(12)}] ${r.code.padEnd(6)} ${r.name}`);
  console.log(`                  → ${r.officialTitleEn ?? '(無候選)'}  score=${r.score}${r.runnerUp ? `  次佳=${r.runnerUp}` : ''}`);
}

// ─── draft mapping ──────────────────────────────────────────────────────────
const draftBranches = {};
for (const r of rows) {
  // A collision would overwrite a sibling entry under the same key, so those
  // are left out entirely rather than written half-right.
  if (r.officialId === null || r.collision) continue;
  draftBranches[`superrich1965-${r.officialId}`] = {
    officialId: r.officialId,
    branchNo: r.code,
    _review: { tier: r.tier, name: r.name, groups: r.groups, companyCode: r.companyCode },
  };
}
const draftPath = resolve(ROOT, 'data/superrich1965-branches.draft.json');
writeFileSync(draftPath, JSON.stringify({
  schemaVersion: 1,
  _draft: 'Phase A1 自動配對草稿，未經人工核對，不可直接當成正式對照檔使用。核對後移除每筆的 _review 與本欄位，另存為 superrich1965-branches.json。',
  generatedAt: new Date().toISOString(),
  branches: draftBranches,
}, null, 2) + '\n');

// ─── review report ──────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const esc = (v) => String(v ?? '').replace(/\|/g, '\\|');
const report = `# SuperRich 1965（橘標）分店建檔查證（${today}）

> **這份是機器產生的草稿，不是結論。** 由 \`scripts/superrich1965-branch-reconcile.mjs\` 依 \`/spr/front/branches\` 與 \`exchange-rate/branch-list\` 自動配對產生。計畫 §2.3 要求逐筆人工核對後才能建 Notion；請直接在本檔上修改、把確認過的列標記起來。

- 規格：[實作計畫](superrich1965-exchange-map-plan.zh-TW.md)｜進度：[進度紀錄](superrich1965-exchange-map-progress.zh-TW.md)
- \`/spr/front/branches\`：${branches.length} 筆
- \`exchange-rate/branch-list\`：${rateBranches.length} 筆
- 自動配對：exact ${rows.length - needsReview.length} 筆、需人工確認 ${needsReview.length} 筆
- 分組推測：Our ${ourBranchGuess.length}、Partner ${partnerGuess.length}、無分組或未配對 ${noGroup.length}

## branch-groups 原始內容

\`\`\`json
${JSON.stringify(groupList, null, 2)}
\`\`\`

${collisions.length ? `## ⚠ 配對衝突（${collisions.length} 組）——最優先處理

多筆 \`branch-list\` 對到同一間 \`/branches\` 分店。草稿對照檔以 \`superrich1965-{officialId}\` 為 key，衝突的話會互相覆蓋，把某個 \`branch_no\` 掛到別間店名下——**而橘標的匯率回應不帶分店識別碼，事後查不出來**（計畫 §2）。這幾筆已從草稿檔剔除，必須人工拆開後手動補回。

| officialId | 衝突的 code | 名稱 |
| --- | --- | --- |
${collisions.map((c) => `| ${c.officialId} | ${c.codes.map((x) => `\`${x}\``).join(', ')} | ${c.names.map(esc).join(' / ')} |`).join('\n')}

` : ''}## 需人工確認（${needsReview.length} 筆）

配對層級：\`exact\` 正規化後完全相同｜\`contained\` 一方包含另一方｜\`token-subset\` 詞彙子集｜\`fuzzy\` 只有相似度｜\`ambiguous\` 前兩名分不出高下｜\`none\` 找不到候選。**只有 \`exact\` 可以略過細看，其餘都要開官網對照。**

| code | branch-list 名稱 | 配對層級 | 相似度 | 對到的 /branches | id | 分組 | 次佳候選 | ✅ 已確認 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${needsReview.map((r) => `| \`${esc(r.code)}\` | ${esc(r.name)} | ${r.collision ? '**衝突**/' : ''}${r.tier} | ${r.score} | ${esc(r.officialTitleEn ?? '（無）')} | ${r.officialId ?? '—'} | ${esc(r.groups.join(', ') || '（無）')} | ${esc(r.runnerUp ?? '—')} | ☐ |`).join('\n')}

## 全部 ${rows.length} 筆

| code | branch-list 名稱 | company | 配對層級 | /branches 名稱 | id | slug | lat | lng | 分組 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.map((r) => `| \`${esc(r.code)}\`${r.isDefault ? ' ★' : ''} | ${esc(r.name)} | ${esc(r.companyCode)} | ${r.tier} | ${esc(r.officialTitleEn ?? '（無）')} | ${r.officialId ?? '—'} | ${esc(r.officialSlug ?? '—')} | ${esc(r.lat ?? '—')} | ${esc(r.lng ?? '—')} | ${esc(r.groups.join(', ') || '（無）')} |`).join('\n')}

★ = \`is_default\`（官網預設分店）

## 待決定

1. **\`E52-01\` Terminal 21 Pattaya**（\`company_code: E52\`，其餘 38 筆是 \`A04\`）算不算 Our Branch？看上表它的分組欄位再定。芭達雅也不在曼谷都會區，另外要確認目的地歸屬。
2. 分組欄位空白或未配對的那幾筆，要開官網逐一確認。
3. 確認完的 Our Branch 名單，回填進度紀錄的 M1 · Phase A1，並據以重估 Phase C 的每輪請求數（計畫 §5 目前只用 39 當上限估算）。

## 產出的草稿對照檔

\`data/superrich1965-branches.draft.json\`——**不是正式對照檔**。逐筆核對後刪掉每筆的 \`_review\` 與最上層的 \`_draft\`，另存成 \`data/superrich1965-branches.json\`，再交給 Phase B 的 validator（審閱意見 16）。
`;

const reportPath = resolve(ROOT, 'docs/superrich1965-branch-verification.zh-TW.md');
writeFileSync(reportPath, report);

console.log(`\n已寫出：`);
console.log(`  docs/superrich1965-branch-verification.zh-TW.md   （審查報告）`);
console.log(`  data/superrich1965-branches.draft.json            （草稿對照檔，非正式）`);
if (dumpDir) console.log(`  ${dumpDir}/*.json                                 （原始回應）`);
if (collisions.length) {
  console.error(`\n✗ 有 ${collisions.length} 組配對衝突未解，草稿對照檔不完整。`);
  process.exitCode = 1;
}
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
