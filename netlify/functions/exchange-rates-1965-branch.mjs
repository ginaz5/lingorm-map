import { ORANGE_BRANCHES } from '../../src/data/exchange-rates-1965-branch.js';
import { branchResponse, queryBranchRates } from './_shared/exchange-rates-1965-on-demand.mjs';
import { createRuntimeStore } from './_shared/exchange-rates-1965-storage.mjs';

/** @param {Request} request @param {{deploy?:{context?:string}}} [context] */
export default async function exchangeRatesBranch(request, context) {
  if (request.method !== 'POST') return branchResponse('', Date.now(), { status: 405, reason: 'method_not_allowed' });
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site' ||
      request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return branchResponse('', Date.now(), { status: 400, reason: 'invalid_request' });
  }
  let body;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 512) throw new Error('large_body');
    const text = await request.text();
    if (text.length > 512) throw new Error('large_body');
    body = JSON.parse(text);
  } catch { return branchResponse('', Date.now(), { status: 400, reason: 'invalid_request' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
      typeof body.slug !== 'string' || !Object.hasOwn(ORANGE_BRANCHES, body.slug)) {
    return branchResponse('', Date.now(), { status: 400, reason: 'invalid_request' });
  }
  try {
    return await queryBranchRates({ slug: body.slug, store: createRuntimeStore({ context: context?.deploy?.context }) });
  } catch {
    return branchResponse(body.slug, Date.now(), { status: 503, reason: 'storage_unavailable' });
  }
}

// Method checks live in the handler so non-POST requests receive a JSON 405.
export const config = { path: '/api/exchange-rates-1965-branch' };
