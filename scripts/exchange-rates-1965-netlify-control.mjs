import { getStore, getDeployStore } from '@netlify/blobs';
import { randomUUID, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { EXCHANGE_STORE_NAME } from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { readEffectiveControl, changeControl } from '../netlify/functions/_shared/exchange-rates-1965-control.mjs';
import { readEntry, conditionalSetJSON } from '../netlify/functions/_shared/exchange-rates-1965-storage.mjs';
import { SITE_ID, NETLIFY_CONTROL_KEY, validNetlifyControl, publicNetlifyControl, dispatchNetlifyRates,
  netlifySlotKey, scheduledSlot } from '../netlify/functions/_shared/exchange-rates-1965-netlify.mjs';

/** @param {string[]} argv */
export function parseNetlifyControlArgs(argv) {
  const [command, flag, deployID, ...rest] = argv;
  if (!['status', 'bind', 'enable', 'disable', 'dispatch'].includes(command) || flag !== '--deploy' ||
      !/^[a-f0-9]{24}$/.test(deployID ?? '') || rest.length) throw new Error('invalid_netlify_control_arguments');
  return { command, deployID };
}

/** @param {string[]} argv @param {{env?:Record<string,string|undefined>,fetchImpl?:typeof fetch}} [input] */
export async function runNetlifyControlCommand(argv, { env = process.env, fetchImpl = fetch } = {}) {
  const { command, deployID } = parseNetlifyControlArgs(argv);
  const token = env.NETLIFY_AUTH_TOKEN;
  if (env.NETLIFY_SITE_ID !== SITE_ID || !token) throw new Error('missing_netlify_credentials');
  /** @param {string} path */
  const metadata = async path => {
    const response = await fetchImpl(`https://api.netlify.com/api/v1/${path}`, { redirect: 'error',
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('netlify_metadata_unavailable');
    return response.json();
  };
  const deploy = await metadata(`deploys/${deployID}`);
  if (deploy.id !== deployID || deploy.site_id !== SITE_ID || deploy.state !== 'ready' ||
      !['production', 'deploy-preview'].includes(deploy.context) || !/^[a-f0-9]{40}$/.test(deploy.commit_ref ?? '') ||
      typeof deploy.branch !== 'string' || (deploy.context === 'production' && deploy.branch !== 'main')) throw new Error('invalid_netlify_deploy');
  if (deploy.context === 'production' && (await metadata(`sites/${SITE_ID}`)).published_deploy?.id !== deployID) throw new Error('stale_netlify_deploy');
  const options = { name: EXCHANGE_STORE_NAME, siteID: SITE_ID, token, consistency: /** @type {const} */ ('strong') };
  const store = deploy.context === 'production' ? getStore(options) : getDeployStore({ ...options, deployID });
  const sourceGuardStore = getStore({ ...options, name: 'exchange-rates-1965-source-guard' });
  const identity = { siteID: SITE_ID, deployID, context: deploy.context };
  const target = { ...identity, branch: deploy.branch, commit: deploy.commit_ref };
  let entry = await readEntry(store, NETLIFY_CONTROL_KEY);
  if (entry && !validNetlifyControl(entry.data)) throw new Error('invalid_netlify_control');
  if (command === 'status') {
    const slotMs = scheduledSlot(Date.now());
    const slot = slotMs === null ? null : (await readEntry(store, netlifySlotKey(slotMs)))?.data ?? null;
    return { target, binding: publicNetlifyControl(entry?.data), slot };
  }
  if (command === 'bind') {
    if (entry?.data.enabled) throw new Error('disable_netlify_before_rebinding');
    let effective = await readEffectiveControl(store, 'false');
    if (!effective.control && deploy.context === 'deploy-preview') {
      await changeControl(store, { enabled: true, updatedBy: 'manual' });
      effective = await readEffectiveControl(store, 'false');
    }
    if (!effective.enabled || !effective.control) throw new Error('quote_control_not_enabled');
    const binding = { schemaVersion: 1, enabled: false, bindingVersion: randomUUID(),
      quoteControlVersion: effective.control.controlVersion, deployID, commit: deploy.commit_ref,
      branch: deploy.branch, context: deploy.context, hmacKey: randomBytes(32).toString('hex'), changedAt: new Date().toISOString() };
    if (!validNetlifyControl(binding)) throw new Error('invalid_netlify_control');
    const write = await conditionalSetJSON(store, NETLIFY_CONTROL_KEY, binding, entry);
    if (!write.modified) throw new Error('netlify_control_conflict');
    return { target, binding: publicNetlifyControl(binding) };
  }
  if (!entry || (command !== 'disable' && entry.data.deployID !== deployID)) throw new Error('netlify_binding_missing');
  if (command === 'enable' || command === 'disable') {
    const effective = await readEffectiveControl(store, 'false');
    if (command === 'enable' && (!effective.enabled || effective.control?.controlVersion !== entry.data.quoteControlVersion)) throw new Error('stale_quote_control');
    const binding = { ...entry.data, enabled: command === 'enable', changedAt: new Date().toISOString() };
    if (!(await conditionalSetJSON(store, NETLIFY_CONTROL_KEY, binding, entry)).modified) throw new Error('netlify_control_conflict');
    return { target, binding: publicNetlifyControl(binding) };
  }
  return { target, ...(await dispatchNetlifyRates({ store, sourceGuardStore, identity, fetchImpl, trigger: 'manual' })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runNetlifyControlCommand(process.argv.slice(2)), null, 2)); }
  catch (error) {
    const allowed = ['invalid_netlify_control_arguments', 'missing_netlify_credentials', 'netlify_metadata_unavailable',
      'invalid_netlify_deploy', 'stale_netlify_deploy', 'invalid_netlify_control', 'disable_netlify_before_rebinding',
      'quote_control_not_enabled', 'netlify_control_conflict', 'netlify_binding_missing', 'stale_quote_control'];
    console.error(error instanceof Error && allowed.includes(error.message) ? error.message : 'netlify_control_failed');
    process.exitCode = 1;
  }
}
