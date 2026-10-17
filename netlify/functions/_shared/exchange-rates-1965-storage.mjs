import { getDeployStore, getStore } from '@netlify/blobs';

import { EXCHANGE_STORE_NAME } from './exchange-rates-1965-contract.mjs';

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

// Netlify Dev can omit ETags for existing local blobs. Serialize that local
// fallback within the Function worker and compare the data again before writing.
// Deployed runtimes never use it: absent ETags must still fail closed there.
let localWrites = Promise.resolve();

/** @param {any} store @param {string} key @param {unknown} value @param {any|null} previousEntry */
export async function conditionalSetJSON(store, key, value, previousEntry) {
  if (previousEntry?.etag) return store.setJSON(key, value, { onlyIfMatch: previousEntry.etag });
  if (previousEntry && process.env.NETLIFY_DEV === 'true') {
    const write = localWrites.then(async () => {
      const current = await readEntry(store, key);
      if (!current || JSON.stringify(current.data) !== JSON.stringify(previousEntry.data)) {
        return { modified: false, etag: current?.etag };
      }
      return current.etag
        ? store.setJSON(key, value, { onlyIfMatch: current.etag })
        : store.setJSON(key, value);
    });
    localWrites = write.then(() => {}, () => {});
    return write;
  }
  return store.setJSON(key, value, { onlyIfNew: true });
}
