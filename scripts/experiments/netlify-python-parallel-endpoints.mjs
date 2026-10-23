// Only immutable isolated draft wrappers import these handlers.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { getStore,getDeployStore } from '@netlify/blobs';
import { authorizeProbe } from './netlify-python-background-endpoints.mjs';
import { createParallelPythonProbe,runParallelProbe,summarizeParallelProbe,PARALLEL_SLUGS,PARALLEL_BUDGET_MS } from './netlify-python-parallel-probe.mjs';
import { readSourceGuard } from '../../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { readEntry } from '../../netlify/functions/_shared/exchange-rates-1965-storage.mjs';

const runFile=promisify(execFile);
const python=()=>resolve(process.cwd(),'vendor/python/bin/python3.12');
const settings=async()=>JSON.parse(await readFile(resolve(process.cwd(),'parallel-probe-config.json'),'utf8'));
const openStore=()=>getDeployStore({name:'netlify-python-parallel-probe',consistency:'strong'});
const openGuard=()=>getStore({name:'exchange-rates-1965-source-guard',consistency:'strong'});
const json=(/** @type {any} */data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
function environment(){
  const ca=['/etc/pki/tls/certs/ca-bundle.crt','/etc/ssl/certs/ca-certificates.crt'].find(path=>existsSync(path));
  return {PATH:process.env.PATH,LANG:'C.UTF-8',...(ca?{SSL_CERT_FILE:ca}:{})};
}
/** @param {any} context */
async function runtime(context){
  try{
    const {stdout}=await runFile(python(),['--version'],{env:environment(),timeout:3000,maxBuffer:4096});
    if(stdout.trim()!=='Python 3.12.15')return {ready:false};
    return {ready:true,node:process.version,python:'Python 3.12.15',platform:process.platform,architecture:process.arch,
      deployID:context.deploy.id,context:context.deploy.context};
  }catch{return {ready:false};}
}
/** @param {Request} request @param {any} context */
export async function controlHandler(request,context){
  const config=await settings();const denied=authorizeProbe(request,context,config);
  if(denied)return json({reason:denied},401);
  const action=request.headers.get('x-probe-action');
  if(action==='runtime')return json(await runtime(context));
  if(action==='guard'){
    const guard=await readSourceGuard({store:openGuard()});
    return json({ok:guard.ok,reason:guard.reason,state:guard.state,retryAtMs:guard.retryAtMs});
  }
  if(!['start','status'].includes(action??''))return json({reason:'invalid_action'},400);
  const store=openStore(),key=`${config.operationId}/job`;
  const current=await readEntry(store,key);
  if(action==='status'||current)return json(current?{job:current.data,summary:summarizeParallelProbe(current.data),replayed:action==='start'}:{status:'not_started'});
  const nowMs=Date.now();
  if(!Number.isFinite(Date.parse(config.notBefore))||nowMs<Date.parse(config.notBefore))return json({reason:'before_test_window',sourceRequestCount:0},503);
  const guard=await readSourceGuard({store:openGuard()});
  if(!guard.ok)return json({reason:guard.reason,retryAtMs:guard.retryAtMs,sourceRequestCount:0},503);
  const info=await runtime(context);
  if(!info.ready)return json({reason:'python_start_failed',sourceRequestCount:0},503);
  const pending={status:'pending',operationId:config.operationId,controlVersion:config.controlVersion,deployID:context.deploy.id,
    requested:38,concurrency:38,plannedSlugs:PARALLEL_SLUGS,guardAnchorSlug:PARALLEL_SLUGS[0],runtime:info,
    createdAtMs:nowMs,deadlineAtMs:nowMs+PARALLEL_BUDGET_MS,startedAtMs:null,completedAtMs:null,
    results:[],token:null,reason:null,ownerId:null};
  if(!(await store.setJSON(key,pending,{onlyIfNew:true})).modified)return json({reason:'already_started'},409);
  try{
    const response=await fetch(`https://${context.deploy.id}--lingorm-map.netlify.app/.netlify/functions/parallel-probe-worker`,{
      method:'POST',redirect:'error',headers:{authorization:request.headers.get('authorization')??''},signal:AbortSignal.timeout(8000)});
    return json({status:response.status===202?'dispatched':'dispatch_rejected',workerHttpStatus:response.status},response.status===202?202:503);
  }catch{return json({status:'dispatch_outcome_unknown'},503);}
}
/** @param {Request} request @param {any} context */
export async function workerHandler(request,context){
  try{
    const config=await settings();if(authorizeProbe(request,context,config))return;
    const info=await runtime(context);if(!info.ready)return;
    const execute=createParallelPythonProbe({executable:python(),helper:resolve(process.cwd(),'scripts/experiments/netlify-python-parallel-http.py'),
      env:environment(),controlVersion:config.controlVersion});
    const result=await runParallelProbe({store:openStore(),sourceGuardStore:openGuard(),jobKey:`${config.operationId}/job`,deployID:context.deploy.id,execute});
    console.info(JSON.stringify({event:'netlify_python_parallel_probe',...result}));
  }catch{console.error(JSON.stringify({event:'netlify_python_parallel_probe_failed',reason:'experiment_unavailable'}));}
}
