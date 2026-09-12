import { getDeployStore, getStore } from '@netlify/blobs';

import { EXCHANGE_STORE_NAME } from './exchange-rates-contract.mjs';

/** Open a site-wide store for the function's production deploy context. */
/** @param {{context?:string, getStoreImpl?:typeof getStore, getDeployStoreImpl?:typeof getDeployStore}} [input] */
export function createRuntimeStore({
  context,
  getStoreImpl = getStore,
  getDeployStoreImpl = getDeployStore,
} = {}) {
  /** @type {{name:string, consistency:'strong'}} */
  const options = { name: EXCHANGE_STORE_NAME, consistency: 'strong' };
  return context === 'production' ? getStoreImpl(options) : getDeployStoreImpl(options);
}

/** Open the production site-wide store from the local admin CLI. */
/** @param {{siteID?:string, token?:string, getStoreImpl?:typeof getStore}} [input] */
export function createAdminStore({
  siteID = process.env.NETLIFY_SITE_ID,
  token = process.env.NETLIFY_AUTH_TOKEN,
  getStoreImpl = getStore,
} = {}) {
  if (!siteID || !token) throw new Error('NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN are required.');
  return getStoreImpl({ name: EXCHANGE_STORE_NAME, consistency: 'strong', siteID, token });
}

/** @param {any} store @param {string} key */
export async function readEntry(store, key) {
  return store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
}

/** @param {any} store @param {string} key @param {unknown} value @param {any|null} previousEntry */
export async function conditionalSetJSON(store, key, value, previousEntry) {
  const options = previousEntry?.etag ? { onlyIfMatch: previousEntry.etag } : { onlyIfNew: true };
  return store.setJSON(key, value, options);
}
