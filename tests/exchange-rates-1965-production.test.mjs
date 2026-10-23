import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import FIXTURE from './fixtures/superrich1965/exchange-rate-00.json' with { type: 'json' };
import { parseActionsArgs, runActionsCommand, ACTIONS_SCHEDULE } from '../scripts/exchange-rates-1965-actions.mjs';
import { openActionsTarget, resolveActionsTarget, PROJECT_SITE_ID, PRODUCTION_COMMIT_ENV } from '../netlify/functions/_shared/exchange-rates-1965-actions-target.mjs';
import { EXCHANGE_KEYS, createControl } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { SOURCE_GUARD_KEY, bootstrapSourceGuard, setSourceGuardPaused } from '../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { branchCacheKey } from '../netlify/functions/_shared/exchange-rates-1965-branch-cache.mjs';
import { FakeBlobStore, uuid } from './helpers/exchange-rates-store.mjs';
import { NETLIFY_CONTROL_KEY } from '../netlify/functions/_shared/exchange-rates-1965-netlify.mjs';

const SHA = 'a'.repeat(40), DEPLOY_SHA = 'b'.repeat(40), DEPLOY = '1'.repeat(24);
const START = Date.parse('2026-10-22T01:00:00Z');
const ENV = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'ginaz5/lingorm-map', GITHUB_RUN_ID: '5678',
  GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch' };
const policy = { kind: 'production', branch: 'main', commitPolicy: 'environment-reviewed', context: 'production' };
const config = { schemaVersion: 1, siteID: PROJECT_SITE_ID, targets: { production: policy,
  'preview-reviewed': { kind: 'preview', branch: 'codex/test', commit: SHA, context: 'deploy-preview', deployID: DEPLOY } } };

async function harness(t) {
  t.mock.method(console, 'info', () => {});
  const store = new FakeBlobStore(), sourceGuardStore = new FakeBlobStore();
  store.seed(EXCHANGE_KEYS.control, createControl({ enabled: true, nowMs: START - 1000, controlVersion: uuid(1), updatedBy: 'manual' }));
  await bootstrapSourceGuard({ store: sourceGuardStore, legacyBreakers: [null], legacyReviewed: true, nowMs: START - 1000, randomUUIDImpl: () => uuid(2) });
  await setSourceGuardPaused({ store: sourceGuardStore, paused: false, nowMs: START - 1000 });
  let now = START, sequence = 10;
  const h = { store, sourceGuardStore, http: [], verified: 0, verify: () => true };
  h.input = { env: { ...ENV }, nowImpl: () => now, randomUUIDImpl: () => uuid(sequence++), randomImpl: () => 0,
    sleepImpl: async ms => { now += ms; },
    openTargetImpl: async () => ({ store, sourceGuardStore,
      target: { alias: 'production', kind: 'production', siteID: PROJECT_SITE_ID, branch: 'main', commit: DEPLOY_SHA, context: 'production' },
      metadata: { id: DEPLOY }, verifyCurrent: async () => { h.verified++; return h.verify(h.verified); } }),
    fetchImpl: async () => assert.fail('Node source transport must not run'),
    pythonFetchImpl: async (url, options) => { h.http.push({ url, options }); return Response.json(String(url).includes('oauth2/callback')
      ? { accessToken: 'PRIVATE_TEST_TOKEN', expires_in: 3600 } : FIXTURE); },
  };
  h.run = (mode = 'publish-python') => runActionsCommand([mode, '--target', 'production'], h.input);
  return h;
}

test('an enabled Netlify collector blocks GitHub source work while allowing read-only inspect', async t => {
  const h = await harness(t);
  h.store.seed(NETLIFY_CONTROL_KEY, { schemaVersion: 1, enabled: true, bindingVersion: uuid(3),
    quoteControlVersion: uuid(1), deployID: DEPLOY, commit: DEPLOY_SHA, branch: 'main', context: 'production',
    hmacKey: '1'.repeat(64), changedAt: new Date(START).toISOString() });
  const result = await h.run('publish-all-python');
  assert.equal(result.exitCode, 3);
  assert.equal(result.summary.reason, 'netlify_collector_active');
  assert.equal(h.http.length, 0);
  assert.equal((await h.run('inspect')).summary.outcome, 'inspected');
  assert.equal(h.http.length, 0);
});

test('production Python modes preserve fixed scopes and reject caller overrides or Node source', () => {
  for (const [mode, scope] of [['probe-python','single'], ['publish-python','single'], ['publish-five-python','five'], ['publish-all-python','all']]) {
    assert.deepEqual(parseActionsArgs([mode, '--target','production']), { mode, alias:'production', scope });
    for (const extra of [['--scope','all'], ['--slug','superrich1965-56'], ['--url','https://example.test'], ['--force','true']]) {
      assert.throws(() => parseActionsArgs([mode,'--target','production',...extra]));
    }
  }
  assert.throws(() => parseActionsArgs(['probe','--target','production']));
  assert.throws(() => parseActionsArgs(['publish','--target','production','--scope','all']));
});

test('production commit policy binds only the selected target and rejects invalid or mixed configuration', async () => {
  assert.equal(resolveActionsTarget('preview-reviewed',config,{}).commit,SHA);
  const target=resolveActionsTarget('production',config,{[PRODUCTION_COMMIT_ENV]:DEPLOY_SHA});
  assert.equal(target.commit,DEPLOY_SHA);assert.equal(Object.hasOwn(target,'commitPolicy'),false);
  for(const value of [undefined,'','main','A'.repeat(40),'b'.repeat(39),'b'.repeat(40)+'\n']) {
    await assert.rejects(openActionsTarget({alias:'production',targetsInput:config,env:{[PRODUCTION_COMMIT_ENV]:value},
      fetchImpl:async()=>assert.fail('unbound target must not fetch metadata'),getStoreImpl:()=>assert.fail('no store')}),/invalid_target_configuration/);
  }
  for(const extra of [{commit:DEPLOY_SHA},{deployID:DEPLOY},{commitPolicy:'published-main'}]) {
    assert.throws(()=>resolveActionsTarget('production',{...config,targets:{production:{...policy,...extra}}},{[PRODUCTION_COMMIT_ENV]:DEPLOY_SHA}));
  }
});

test('production metadata revalidation rejects a changed deployment and keeps credentials private', async () => {
  let current=DEPLOY, commit=DEPLOY_SHA;
  const opened=await openActionsTarget({alias:'production',targetsInput:config,
    env:{NETLIFY_SITE_ID:PROJECT_SITE_ID,NETLIFY_AUTH_TOKEN:'PRIVATE_ADMIN_TOKEN',[PRODUCTION_COMMIT_ENV]:DEPLOY_SHA},
    fetchImpl:async url=>Response.json(String(url).includes('/sites/')?{id:PROJECT_SITE_ID,published_deploy:{id:current}}
      :{id:current,site_id:PROJECT_SITE_ID,context:'production',branch:'main',state:'ready',commit_ref:commit}),
    getStoreImpl:()=>({}),getDeployStoreImpl:()=>assert.fail('production must use site store')});
  assert.equal(await opened.verifyCurrent(),true);
  current='2'.repeat(24);assert.equal(await opened.verifyCurrent(),false);
  current=DEPLOY;commit=SHA;assert.equal(await opened.verifyCurrent(),false);
  assert.equal(JSON.stringify(opened).includes('PRIVATE_ADMIN_TOKEN'),false);
});

for(const enabled of [undefined,'','false','TRUE','1']) test(`schedule disabled (${enabled}) never opens stores or sends HTTP`,async()=>{
  const result=await runActionsCommand(['publish-all-python','--target','production'],{
    env:{...ENV,GITHUB_EVENT_NAME:'schedule',GITHUB_EVENT_SCHEDULE:ACTIONS_SCHEDULE,EXCHANGE_RATES_1965_SCHEDULE_ENABLED:enabled},
    openTargetImpl:async()=>assert.fail('disabled schedule cannot open target'),pythonFetchImpl:async()=>assert.fail('zero source')});
  assert.equal(result.exitCode,3);assert.equal(result.summary.reason,'schedule_disabled');assert.equal(result.summary.sourceRequestCount,0);
});

test('schedule cannot select a different mode, target, cron, ref or repository',async()=>{
  const scheduled={...ENV,GITHUB_EVENT_NAME:'schedule',GITHUB_EVENT_SCHEDULE:ACTIONS_SCHEDULE,EXCHANGE_RATES_1965_SCHEDULE_ENABLED:'true'};
  for(const [mode,target,extra] of [['inspect','production',{}],['probe-python','production',{}],['publish-python','production',{}],
    ['publish-five-python','production',{}],['publish-all-python','preview-reviewed',{}],
    ['publish-all-python','production',{GITHUB_EVENT_SCHEDULE:'* * * * *'}],['publish-all-python','production',{GITHUB_REF:'refs/heads/other'}],
    ['publish-all-python','production',{GITHUB_REPOSITORY:'other/repo'}]]) {
    const result=await runActionsCommand([mode,'--target',target],{env:{...scheduled,...extra},openTargetImpl:async()=>assert.fail('invalid schedule must not open target')});
    assert.equal(result.exitCode,2);assert.equal(result.summary.reason,'invalid_actions_identity');
  }
});

test('production manual single publishes with independent exact workflow/deployment identities and zero-HTTP replay',async t=>{
  const h=await harness(t);const result=await h.run();assert.equal(result.exitCode,0);assert.equal(result.summary.published,1);
  assert.equal(result.summary.commit,SHA);assert.equal(result.summary.target.commit,DEPLOY_SHA);assert.equal(h.http.length,2);assert.equal(h.verified,2);
  await setSourceGuardPaused({store:h.sourceGuardStore,paused:true,nowMs:START});
  const replay=await h.run();assert.equal(replay.exitCode,0);assert.equal(replay.summary.replayed,true);
  assert.equal(replay.summary.sourceRequestCount,0);assert.equal(h.http.length,2);assert.equal(h.verified,2);
  h.input.env.GITHUB_SHA='c'.repeat(40);const conflict=await h.run();assert.equal(conflict.exitCode,2);assert.equal(h.http.length,2);
});

test('enabled production schedule publishes all 38 serially and preserves guard history',async t=>{
  const h=await harness(t);Object.assign(h.input.env,{GITHUB_EVENT_NAME:'schedule',GITHUB_EVENT_SCHEDULE:ACTIONS_SCHEDULE,EXCHANGE_RATES_1965_SCHEDULE_ENABLED:'true'});
  const guard=h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;guard.breaker.blockLevel=2;h.sourceGuardStore.seed(SOURCE_GUARD_KEY,guard);
  const result=await h.run('publish-all-python');assert.equal(result.exitCode,0);assert.equal(result.summary.published,38);
  assert.equal(result.summary.sourceRequestCount,39);assert.equal(result.summary.cacheHit,0);assert.equal(h.http.length,39);
  const after=h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data;assert.equal(after.breaker.blockLevel,2);assert.equal(after.unresolvedAttempt,null);assert.equal(after.leaseId,null);
});

test('deployment mismatch before source stops without source HTTP or quote publication',async t=>{
  const h=await harness(t);h.verify=()=>false;const result=await h.run();assert.equal(result.exitCode,1);
  assert.equal(result.summary.reason,'stale_target');assert.equal(h.http.length,0);assert.equal(h.store.entries.has(branchCacheKey('superrich1965-58')),false);
});

test('deployment change during source HTTP prevents publication and settles the known source attempt',async t=>{
  const h=await harness(t);h.verify=count=>count===1;const result=await h.run();assert.equal(result.exitCode,1);
  assert.equal(result.summary.sourceSucceeded,1);assert.equal(result.summary.published,0);assert.equal(h.http.length,2);
  assert.equal(h.store.entries.has(branchCacheKey('superrich1965-58')),false);assert.equal(h.sourceGuardStore.entries.get(SOURCE_GUARD_KEY).data.unresolvedAttempt,null);
});

test('missing control or paused guard keeps production source untouched',async t=>{
  for(const state of ['missing','disabled','paused']) {
    const h=await harness(t);
    if(state==='missing')h.store.entries.delete(EXCHANGE_KEYS.control);
    if(state==='disabled'){const c=h.store.entries.get(EXCHANGE_KEYS.control).data;c.enabled=false;c.disabledAt=c.changedAt;c.disabledReason='manual';h.store.seed(EXCHANGE_KEYS.control,c);}
    if(state==='paused')await setSourceGuardPaused({store:h.sourceGuardStore,paused:true,nowMs:START});
    const result=await h.run();assert.equal(result.exitCode,3);assert.equal(h.http.length,0);assert.equal(h.verified,0);
  }
});

test('workflow retains manual fallback, main-only Environment and concurrency after Netlify cron cutover',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/exchange-rates-1965.yml',import.meta.url),'utf8');
  assert.doesNotMatch(workflow,/\bcron:/);assert.match(workflow,/github.event_name == 'workflow_dispatch'/);
  assert.match(workflow,/group: exchange-rates-1965-source/);assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/environment: superrich1965-preview/);assert.match(workflow,/github.ref == 'refs\/heads\/main'/);
  assert.ok(workflow.indexOf('NETLIFY_AUTH_TOKEN:')>workflow.indexOf('Verify Python stdlib transport offline'));
  assert.doesNotMatch(workflow,/GITHUB_EVENT_SCHEDULE:/);
});
