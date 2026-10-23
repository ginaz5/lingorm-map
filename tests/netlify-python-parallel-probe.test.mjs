import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import FIXTURE from './fixtures/superrich1965/exchange-rate-00.json' with {type:'json'};
import { FakeBlobStore,uuid } from './helpers/exchange-rates-store.mjs';
import { bootstrapSourceGuard,setSourceGuardPaused,SOURCE_GUARD_KEY,beginSourceAttempt } from '../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { PARALLEL_SLUGS,PARALLEL_BUDGET_MS,runParallelProbe,createParallelPythonProbe } from '../scripts/experiments/netlify-python-parallel-probe.mjs';

const START=Date.parse('2026-10-23T12:13:00Z'),DEPLOY='a'.repeat(24),KEY='parallel-38/test/job';
async function harness(){
  const store=new FakeBlobStore(),guard=new FakeBlobStore();let now=START,sequence=10,calls=0;
  await bootstrapSourceGuard({store:guard,legacyBreakers:[null],legacyReviewed:true,nowMs:now-1000,randomUUIDImpl:()=>uuid(1)});
  await setSourceGuardPaused({store:guard,paused:false,nowMs:now-1000});
  const g=guard.entries.get(SOURCE_GUARD_KEY).data;g.breaker.blockLevel=2;guard.seed(SOURCE_GUARD_KEY,g);
  store.seed(KEY,{status:'pending',deployID:DEPLOY,requested:38,plannedSlugs:PARALLEL_SLUGS,
    operationId:'netlify/parallel-38/test',deadlineAtMs:START+PARALLEL_BUDGET_MS,results:[],token:null});
  const h={store,guard,now:()=>now,advance:ms=>{now+=ms;},calls:()=>calls};
  h.input={store,sourceGuardStore:guard,jobKey:KEY,deployID:DEPLOY,nowImpl:()=>now,randomUUIDImpl:()=>uuid(sequence++),execute:async({beforeRates})=>{
    calls++;assert.equal(await beforeRates(),true);
    const held=guard.entries.get(SOURCE_GUARD_KEY).data;
    assert.equal(held.unresolvedAttempt.operationId,'netlify/parallel-38/test');
    assert.equal(store.entries.get(KEY).data.plannedSlugs.length,38);
    const competing=await beginSourceAttempt({store:guard,operationId:'other',ownerId:'other',slug:PARALLEL_SLUGS[1],nowMs:now,randomUUIDImpl:()=>uuid(99)});
    assert.equal(competing.ok,false);assert.equal(competing.reason,'busy');
    now+=5000;
    return {settled:true,token:{status:200,headers:{},reason:null,startedAtMs:START,completedAtMs:START+100},
      results:PARALLEL_SLUGS.map(slug=>({slug,startedAtMs:START+101,completedAtMs:now,status:200,headers:{},reason:null,quote:{slug}}))};
  }};
  h.run=()=>runParallelProbe(h.input);return h;
}

test('38-way operation owns one exclusive global lease, publishes nothing and consumes replays',async()=>{
  const h=await harness();const r=await h.run();
  assert.equal(r.summary.status,'complete');assert.equal(r.summary.sourceSucceeded,38);assert.equal(r.summary.published,0);
  assert.equal(r.summary.sourceRequestCount,39);assert.equal(r.summary.peakInFlight,38);assert.equal(r.summary.launchSpreadMs,0);
  assert.deepEqual([...h.store.entries.keys()],[KEY]);
  const g=h.guard.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(g.leaseId,null);assert.equal(g.unresolvedAttempt,null);assert.equal(g.breaker.blockLevel,2);
  assert.equal((await h.run()).replayed,true);assert.equal(h.calls(),1);
});

test('existing cooldown or pause prevents the parallel executor from starting',async()=>{
  for(const condition of ['paused','cooldown']){
    const h=await harness();const g=h.guard.entries.get(SOURCE_GUARD_KEY).data;
    if(condition==='paused')g.paused=true;else g.breaker.blockedUntil=new Date(START+60_000).toISOString();
    h.guard.seed(SOURCE_GUARD_KEY,g);const r=await h.run();
    assert.equal(r.summary.reason,condition);assert.equal(r.summary.sourceRequestCount,0);assert.equal(h.calls(),0);
  }
});

test('a known failed request retains all peer results and preserves source failure accounting',async()=>{
  const h=await harness();const execute=h.input.execute;
  h.input.execute=async args=>{const r=await execute(args);r.results[18].quote=null;r.results[18].reason='timeout';return r;};
  const r=await h.run();assert.equal(r.summary.status,'stopped');assert.equal(r.summary.failed,1);assert.equal(r.summary.sourceSucceeded,37);
  assert.equal(r.summary.notAttempted,0);assert.equal(r.summary.sourceRequestCount,39);
  const g=h.guard.entries.get(SOURCE_GUARD_KEY).data;
  assert.equal(g.breaker.consecutiveFailedRuns,1);assert.equal(g.breaker.blockLevel,2);assert.equal(g.unresolvedAttempt,null);
});

test('any known challenge trips the shared breaker, with no retry after the batch',async()=>{
  const h=await harness();const execute=h.input.execute;
  h.input.execute=async args=>{const r=await execute(args);Object.assign(r.results[18],{quote:null,status:429,headers:{'retry-after':'7200'}});return r;};
  const r=await h.run();assert.equal(r.summary.reason,'blocked');assert.equal(h.calls(),1);
  const g=h.guard.entries.get(SOURCE_GUARD_KEY).data;assert.equal(g.breaker.blockLevel,3);assert.equal(g.paused,true);
  assert.ok(Date.parse(g.breaker.blockedUntil)>=h.now()+7_200_000);assert.equal(g.unresolvedAttempt,null);
});

test('a lost subprocess outcome retains the durable unresolved batch anchor and pauses source',async()=>{
  const h=await harness();h.input.execute=async()=>({settled:false,token:{status:200},results:[]});
  const r=await h.run();assert.equal(r.summary.reason,'unknown');
  const g=h.guard.entries.get(SOURCE_GUARD_KEY).data;assert.equal(g.paused,true);assert.ok(g.unresolvedAttempt);assert.ok(g.leaseId);
  assert.equal(g.unresolvedAttempt.operationId,'netlify/parallel-38/test');
});

test('expired or incomplete inventory cannot start the executor',async()=>{
  const h=await harness();h.advance(PARALLEL_BUDGET_MS);assert.equal((await h.run()).reason,'invalid_job');assert.equal(h.calls(),0);
});

test('subprocess bridge waits for lease authorization, parses all 38, and drops raw source extras',async()=>{
  let authorized=false;
  const spawnImpl=()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
    child.kill=()=>{setImmediate(()=>child.emit('close',1));return true;};
    const emit=e=>child.stdout.write(JSON.stringify(e)+'\n');
    child.stdin.on('data',chunk=>{
      const text=chunk.toString();
      if(text.includes('parallel38'))setImmediate(()=>{
        emit({event:'token_started',startedAtMs:START});emit({event:'headers',stage:'token',status:200,headers:{}});
        emit({event:'token_result',reason:null,completedAtMs:START+100});emit({event:'ready',requested:38});
      });
      if(text.includes('rates')){
        assert.equal(authorized,true);
        for(const slug of PARALLEL_SLUGS)emit({event:'started',slug,startedAtMs:START+101});
        for(const slug of PARALLEL_SLUGS){
          emit({event:'headers',stage:'rate',slug,status:200,headers:{'content-type':'application/json'}});
          emit({event:'result',slug,reason:null,completedAtMs:START+1000,body:JSON.stringify({...FIXTURE,unwanted:'private-extra'})});
        }
        emit({event:'done',ratePosts:38});setImmediate(()=>child.emit('close',0));
      }
    });return child;
  };
  const execute=createParallelPythonProbe({executable:'test',helper:'test',env:{},controlVersion:uuid(2),spawnImpl});
  const r=await execute({beforeRates:async()=>{authorized=true;return true;}});
  assert.equal(r.settled,true);assert.equal(r.results.length,38);assert.ok(r.results.every(row=>row.quote!==null));
  assert.equal(JSON.stringify(r).includes('private-extra'),false);
});
