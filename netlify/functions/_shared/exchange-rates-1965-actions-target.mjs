import { readFile } from 'node:fs/promises';
import { getDeployStore, getStore } from '@netlify/blobs';

import { EXCHANGE_STORE_NAME } from './exchange-rates-1965-contract.mjs';

export const PROJECT_SITE_ID = 'b5ac142c-7e21-4910-90f7-1719a9d90d5d';
export const SOURCE_GUARD_STORE_NAME = 'exchange-rates-1965-source-guard';
export const LEGACY_PREVIEW_DEPLOY_IDS = Object.freeze(['6ad48de20cfce14e8ddd926f', '6ad62ddf1a2369d43e1e364e']);
export const TARGET_CONFIG_URL = new URL('../../../config/exchange-rates-1965-actions-targets.json', import.meta.url);
const DEPLOY_ID = /^[a-f0-9]{24}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ALIAS = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** @typedef {{alias:string,kind:'preview'|'production',siteID:string,branch:string,commit:string,context:'deploy-preview'|'production',deployID?:string}} ActionsTarget */
/** @typedef {{id:string,siteID:string,branch:string,commit:string,context:string,state:'ready'}} TargetMetadata */

/** @param {unknown} value @returns {value is Record<string,any>} */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {Record<string,any>} value @param {string[]} keys */
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Resolve only reviewed aliases. No environment, Netlify link, URL or alias lookup can select a deployment.
 * @param {string} alias @param {unknown} input @returns {ActionsTarget}
 */
export function resolveActionsTarget(alias, input) {
  if (!ALIAS.test(alias) || !object(input) || !exactKeys(input, ['schemaVersion', 'siteID', 'targets']) ||
      input.schemaVersion !== 1 || input.siteID !== PROJECT_SITE_ID || !object(input.targets)) {
    throw new Error('invalid_target_configuration');
  }
  for (const [name, value] of Object.entries(input.targets)) {
    if (!ALIAS.test(name) || !object(value)) throw new Error('invalid_target_configuration');
    const preview = value.kind === 'preview';
    const keys = preview ? ['kind', 'deployID', 'branch', 'commit', 'context'] : ['kind', 'branch', 'commit', 'context'];
    if (!exactKeys(value, keys) || !['preview', 'production'].includes(value.kind) ||
        typeof value.branch !== 'string' || !value.branch || value.branch.length > 200 || /[\x00-\x1f\x7f]/.test(value.branch) ||
        typeof value.commit !== 'string' || !COMMIT.test(value.commit) ||
        (preview ? typeof value.deployID !== 'string' || !DEPLOY_ID.test(value.deployID) ||
          LEGACY_PREVIEW_DEPLOY_IDS.includes(value.deployID) || value.context !== 'deploy-preview'
          : value.branch !== 'main' || value.context !== 'production')) {
      throw new Error('invalid_target_configuration');
    }
  }
  if (!Object.hasOwn(input.targets, alias)) throw new Error('target_not_configured');
  const selected = input.targets[alias];
  return Object.freeze({ alias, siteID: PROJECT_SITE_ID, ...selected });
}

/** Reject inherited Netlify runtime credentials before loading metadata or constructing SDK clients.
 * @param {Record<string,string|undefined>} env
 */
export function readActionsCredentials(env) {
  if (env.NETLIFY_DEV !== undefined || env.NETLIFY_BLOBS_CONTEXT !== undefined ||
      /** @type {any} */ (globalThis).netlifyBlobsContext !== undefined) throw new Error('invalid_actions_environment');
  if (!env.NETLIFY_SITE_ID || !env.NETLIFY_AUTH_TOKEN) throw new Error('missing_credentials');
  if (env.NETLIFY_SITE_ID !== PROJECT_SITE_ID || env.NETLIFY_AUTH_TOKEN.length > 4_096 ||
      !/^[\x21-\x7e]+$/.test(env.NETLIFY_AUTH_TOKEN)) throw new Error('invalid_credentials');
  return { siteID: PROJECT_SITE_ID, token: env.NETLIFY_AUTH_TOKEN };
}

/** Only this fixed API host receives the PAT. Redirects and raw error bodies are never accepted.
 * @param {string} path @param {string} token @param {typeof fetch} fetchImpl
 */
async function readMetadata(path, token, fetchImpl) {
  try {
    const response = await fetchImpl(`https://api.netlify.com/api/v1/${path}`, {
      method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error();
    const text = await response.text();
    if (text.length > 262_144) throw new Error();
    const data = JSON.parse(text);
    if (!object(data)) throw new Error();
    return data;
  } catch { throw new Error('target_metadata_unavailable'); }
}

/** Validate deploy metadata, returning only the reviewed non-secret identity.
 * @param {ActionsTarget} target @param {{token:string,fetchImpl?:typeof fetch}} input @returns {Promise<TargetMetadata>}
 */
export async function verifyActionsTarget(target, { token, fetchImpl = fetch }) {
  let deployID = target.deployID;
  if (target.kind === 'production') {
    const site = await readMetadata(`sites/${PROJECT_SITE_ID}`, token, fetchImpl);
    if (site.id !== PROJECT_SITE_ID || !object(site.published_deploy) || !DEPLOY_ID.test(site.published_deploy.id)) {
      throw new Error('target_metadata_mismatch');
    }
    deployID = site.published_deploy.id;
  }
  if (!deployID || !DEPLOY_ID.test(deployID)) throw new Error('target_metadata_mismatch');
  const deploy = await readMetadata(`deploys/${deployID}`, token, fetchImpl);
  if (deploy.id !== deployID || deploy.site_id !== PROJECT_SITE_ID || deploy.context !== target.context ||
      deploy.branch !== target.branch || deploy.commit_ref !== target.commit || deploy.state !== 'ready') {
    throw new Error('target_metadata_mismatch');
  }
  return { id: deploy.id, siteID: PROJECT_SITE_ID, branch: deploy.branch, commit: deploy.commit_ref,
    context: deploy.context, state: 'ready' };
}

/** A reviewed target must pass credentials and metadata checks before either store can be opened.
 * The checked-in configuration is deliberately empty until a deployment is reviewed.
 * @param {{alias:string,targetsInput?:unknown,env?:Record<string,string|undefined>,fetchImpl?:typeof fetch,getStoreImpl?:typeof getStore,getDeployStoreImpl?:typeof getDeployStore}} input
 */
export async function openActionsTarget({ alias, targetsInput, env = process.env, fetchImpl = fetch,
  getStoreImpl = getStore, getDeployStoreImpl = getDeployStore }) {
  let config = targetsInput;
  if (config === undefined) {
    try { config = JSON.parse(await readFile(TARGET_CONFIG_URL, 'utf8')); }
    catch { throw new Error('target_configuration_unavailable'); }
  }
  const target = resolveActionsTarget(alias, config);
  const credentials = readActionsCredentials(env);
  const metadata = await verifyActionsTarget(target, { token: credentials.token, fetchImpl });
  // This fixed recovery set is deliberately unrelated to the selected quote
  // target. A new Preview must not hide an older deployment's source block.
  const openLegacyStores = async () => {
    for (const deployID of LEGACY_PREVIEW_DEPLOY_IDS) {
      const legacy = await readMetadata(`deploys/${deployID}`, credentials.token, fetchImpl);
      if (legacy.id !== deployID || legacy.site_id !== PROJECT_SITE_ID || legacy.context !== 'deploy-preview') {
        throw new Error('legacy_state_unknown');
      }
    }
    try {
      const options = { name: EXCHANGE_STORE_NAME, consistency: /** @type {const} */ ('strong'), ...credentials };
      return [{ label: 'production', store: getStoreImpl(options) }, ...LEGACY_PREVIEW_DEPLOY_IDS.map(deployID => ({
        label: `legacy-preview-${deployID}`, store: getDeployStoreImpl({ ...options, deployID }),
      }))];
    } catch { throw new Error('legacy_state_unknown'); }
  };
  try {
    const options = { name: EXCHANGE_STORE_NAME, consistency: /** @type {const} */ ('strong'), ...credentials };
    const store = target.kind === 'production' ? getStoreImpl(options)
      : getDeployStoreImpl({ ...options, deployID: target.deployID });
    const sourceGuardStore = getStoreImpl({ ...options, name: SOURCE_GUARD_STORE_NAME });
    return { target, metadata, store, sourceGuardStore, openLegacyStores };
  } catch { throw new Error('target_store_unavailable'); }
}
