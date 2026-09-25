import {
  environmentEnabled,
  EXCHANGE_KEYS,
  isValidControl,
  isValidSnapshot,
  PUBLIC_SCHEMA_VERSION,
} from './_shared/exchange-rates-1965-contract.mjs';
import { createRuntimeStore, readEntry } from './_shared/exchange-rates-1965-storage.mjs';

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'netlify-cdn-cache-control': 'no-store',
};

/** @param {unknown} body @param {number} [status] */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

/** @param {{checkedAt:string, enabled:boolean|null, controlVersion:string|null, snapshot:any|null}} input */
function publicBody({ checkedAt, enabled, controlVersion, snapshot }) {
  return { schemaVersion: PUBLIC_SCHEMA_VERSION, checkedAt, enabled, controlVersion, snapshot };
}

/** @param {string} checkedAt @param {string} error */
function errorBody(checkedAt, error) {
  return { ...publicBody({ checkedAt, enabled: null, controlVersion: null, snapshot: null }), error };
}

/** @param {{store:any, enabledDefault?:unknown, nowMs?:number}} input */
export async function serveExchangeRates({
  store,
  enabledDefault = process.env.EXCHANGE_RATES_1965_ENABLED,
  nowMs = Date.now(),
}) {
  const checkedAt = new Date(nowMs).toISOString();
  let first;
  try {
    first = await readEntry(store, EXCHANGE_KEYS.control);
  } catch {
    return json(errorBody(checkedAt, 'storage_unavailable'), 503);
  }
  if (first === null) {
    let enabled;
    try { enabled = environmentEnabled(enabledDefault); } catch {
      return json(errorBody(checkedAt, 'invalid_configuration'), 503);
    }
    return json(publicBody({ checkedAt, enabled, controlVersion: null, snapshot: null }));
  }
  if (!isValidControl(first.data)) {
    return json(errorBody(checkedAt, 'invalid_control'), 503);
  }
  if (!first.data.enabled) {
    return json(publicBody({ checkedAt, enabled: false, controlVersion: first.data.controlVersion, snapshot: null }));
  }

  let snapshotEntry;
  let second;
  try {
    snapshotEntry = await readEntry(store, EXCHANGE_KEYS.snapshot);
    second = await readEntry(store, EXCHANGE_KEYS.control);
  } catch {
    return json(errorBody(checkedAt, 'storage_unavailable'), 503);
  }
  if (second === null || !isValidControl(second.data)) {
    return json(errorBody(checkedAt, 'invalid_control'), 503);
  }
  if (!second.data.enabled) {
    return json(publicBody({ checkedAt, enabled: false, controlVersion: second.data.controlVersion, snapshot: null }));
  }
  if (second.data.controlVersion !== first.data.controlVersion) {
    return json(publicBody({ checkedAt, enabled: true, controlVersion: second.data.controlVersion, snapshot: null }));
  }
  if (snapshotEntry === null) {
    return json(publicBody({ checkedAt, enabled: true, controlVersion: second.data.controlVersion, snapshot: null }));
  }
  if (!isValidSnapshot(snapshotEntry.data)) {
    return json(errorBody(checkedAt, 'invalid_snapshot'), 503);
  }
  const snapshot = snapshotEntry.data;
  const currentVersion = second.data.controlVersion;
  const usable = snapshot.controlVersion === currentVersion &&
    Date.parse(snapshot.attemptedAt) >= Date.parse(second.data.enabledAt) &&
    Date.parse(snapshot.expiresAt) > nowMs;
  return json(publicBody({ checkedAt, enabled: true, controlVersion: currentVersion, snapshot: usable ? snapshot : null }));
}

/** @param {Request} request @param {{deploy?:{context?:string}}} [context] */
export default async function exchangeRates(request, context) {
  if (request.method !== 'GET') {
    const checkedAt = new Date().toISOString();
    return json(errorBody(checkedAt, 'method_not_allowed'), 405);
  }
  return serveExchangeRates({ store: createRuntimeStore({ context: context?.deploy?.context }) });
}

export const config = {
  path: '/api/exchange-rates-1965',
  method: 'GET',
};
