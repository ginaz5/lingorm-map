// These handlers are bundled only into the isolated experiment draft.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getStore, getDeployStore } from '@netlify/blobs';
import { createPythonSafariFetch } from '../exchange-rates-1965-python.mjs';
import { createAnonymousApiSource } from '../../netlify/functions/_shared/exchange-rates-1965-anonymous.mjs';
import { createControl, EXCHANGE_KEYS } from '../../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { readSourceGuard } from '../../netlify/functions/_shared/exchange-rates-1965-source-guard.mjs';
import { readEntry } from '../../netlify/functions/_shared/exchange-rates-1965-storage.mjs';
import { runBackgroundProbe, summarizeProbe, PROBE_BUDGET_MS } from './netlify-python-background-probe.mjs';

const SITE_ID = 'b5ac142c-7e21-4910-90f7-1719a9d90d5d';
const runFile = promisify(execFile);
const pythonExecutable = () => resolve(process.cwd(), 'vendor/python/bin/python3');
const json = (/** @type {any} */ body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const openStore = () => getDeployStore({ name: 'netlify-python-background-probe', consistency: 'strong' });
const openGuardStore = () => getStore({ name: 'exchange-rates-1965-source-guard', consistency: 'strong' });

function pythonEnvironment() {
  const ca = ['/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/certs/ca-certificates.crt'].find(path => existsSync(path));
  return { PATH: process.env.PATH, LANG: 'C.UTF-8', ...(ca ? { SSL_CERT_FILE: ca } : {}) };
}

/** @param {Request} request @param {any} context @param {any} settings @param {number} [nowMs] */
export function authorizeProbe(request, context, settings, nowMs = Date.now()) {
  const credential = request.headers.get('authorization') ?? '';
  if (request.method !== 'POST' || !/^Bearer [a-f0-9]{64}$/.test(credential) ||
      createHash('sha256').update(credential.slice(7)).digest('hex') !== settings.capabilityDigest) return 'unauthorized';
  if (!Number.isFinite(Date.parse(settings.expiresAt)) || nowMs >= Date.parse(settings.expiresAt)) return 'probe_expired';
  if (context?.site?.id !== SITE_ID || context?.deploy?.context !== 'deploy-preview' ||
      !/^[a-f0-9]{24}$/.test(context?.deploy?.id ?? '')) return 'invalid_probe_deploy';
  return null;
}

/** @param {any} context */
async function inspectRuntime(context) {
  try {
    const { stdout } = await runFile(pythonExecutable(), ['--version'], { timeout: 3000, maxBuffer: 4096, env: pythonEnvironment() });
    const version = stdout.trim();
    return { platform: process.platform, architecture: process.arch, node: process.version,
      python: /^Python 3\.[0-9]+\.[0-9]+$/.test(version) ? version : null,
      deployID: context.deploy.id, deployContext: context.deploy.context };
  } catch { return { python: null, reason: 'python_start_failed' }; }
}

const loadSettings = async () => JSON.parse(await readFile(resolve(process.cwd(), 'probe-config.json'), 'utf8'));
/** @param {any} settings */
const jobKey = settings => `${settings.operationId}/job`;

/** @param {Request} request @param {any} context */
export async function controlHandler(request, context) {
  const settings = await loadSettings();
  const denied = authorizeProbe(request, context, settings);
  if (denied) return json({ reason: denied }, denied === 'probe_expired' ? 410 : 401);
  const action = request.headers.get('x-probe-action');
  if (action === 'runtime') return json(await inspectRuntime(context));
  if (action === 'guard') {
    const guard = await readSourceGuard({ store: openGuardStore() });
    return json({ ok: guard.ok, reason: guard.reason, state: guard.state });
  }
  if (!['start', 'status'].includes(action ?? '')) return json({ reason: 'invalid_action' }, 400);
  const store = openStore();
  const key = jobKey(settings);
  const existing = await readEntry(store, key);
  if (action === 'status' || existing) return json(existing
    ? { job: existing.data, summary: summarizeProbe(existing.data), replayed: action === 'start' }
    : { status: 'not_started' });
  const runtime = await inspectRuntime(context);
  if (!runtime.python) return json({ reason: 'python_start_failed', sourceRequestCount: 0 }, 503);
  const guard = await readSourceGuard({ store: openGuardStore() });
  if (!guard.ok) return json({ reason: guard.reason, sourceRequestCount: 0, retryAtMs: guard.retryAtMs }, 503);
  const nowMs = Date.now();
  const control = createControl({ enabled: true, controlVersion: settings.controlVersion, updatedBy: 'manual', nowMs });
  const controlWrite = await store.setJSON(EXCHANGE_KEYS.control, control, { onlyIfNew: true });
  if (!controlWrite.modified) return json({ reason: 'control_already_exists' }, 409);
  const pending = { status: 'pending', requested: 38, results: [], tokenWaits: [], currentSlug: null,
    operationId: settings.operationId, controlVersion: control.controlVersion, deployID: context.deploy.id,
    runtime, ownerId: null, createdAtMs: nowMs, startedAtMs: null, updatedAtMs: nowMs,
    completedAtMs: null, deadlineAtMs: nowMs + PROBE_BUDGET_MS, reason: null };
  const write = await store.setJSON(key, pending, { onlyIfNew: true });
  if (!write.modified) return json({ reason: 'already_started' }, 409);
  // Only this immutable draft URL receives the capability. A lost dispatch
  // response is never retried; status inspection resolves what actually ran.
  try {
    const response = await fetch(`https://${context.deploy.id}--lingorm-map.netlify.app/.netlify/functions/python-probe-worker`, {
      method: 'POST', redirect: 'error', headers: { authorization: request.headers.get('authorization') ?? '' },
      signal: AbortSignal.timeout(10_000) });
    return json({ status: response.status === 202 ? 'dispatched' : 'dispatch_rejected',
      workerHttpStatus: response.status, operationId: settings.operationId }, response.status === 202 ? 202 : 503);
  } catch { return json({ status: 'dispatch_outcome_unknown', operationId: settings.operationId }, 503); }
}

/** Background completion is persisted in Blobs; a 202 alone is not success.
 * @param {Request} request @param {any} context
 */
export async function workerHandler(request, context) {
  try {
    const settings = await loadSettings();
    if (authorizeProbe(request, context, settings)) return;
    const store = openStore();
    const entry = await readEntry(store, jobKey(settings));
    if (entry?.data.status !== 'pending' || entry.data.deployID !== context.deploy.id) return;
    const runtime = await inspectRuntime(context);
    if (!runtime.python) {
      await store.setJSON(jobKey(settings), { ...entry.data, status: 'stopped', reason: 'python_start_failed',
        completedAtMs: Date.now() }, { onlyIfMatch: entry.etag });
      return;
    }
    // The helper calls spawn's three-argument pipe form. This adapter changes
    // only the executable/helper paths and CA environment, preserving stdio.
    const spawnPython = /** @type {typeof spawn} */ (/** @type {unknown} */ (
      (/** @type {string} */ executable, /** @type {readonly string[]} */ args,
        /** @type {import('node:child_process').SpawnOptions} */ options) => spawn(pythonExecutable(),
        ['-I', '-B', resolve(process.cwd(), 'scripts/exchange-rates-1965-python-http.py')], { ...options, env: pythonEnvironment() })));
    const pythonFetch = createPythonSafariFetch({ spawnImpl: spawnPython });
    const source = createAnonymousApiSource({ fetchImpl: pythonFetch });
    const result = await runBackgroundProbe({ store, sourceGuardStore: openGuardStore(),
      jobKey: jobKey(settings), deployID: context.deploy.id, source });
    console.info(JSON.stringify({ event: 'netlify_python_background_probe', ...result }));
  } catch {
    // Platform retries must not restart a partially completed source operation.
    console.error(JSON.stringify({ event: 'netlify_python_background_probe_failed', reason: 'experiment_unavailable' }));
  }
}
