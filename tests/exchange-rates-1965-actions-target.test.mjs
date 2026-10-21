import assert from 'node:assert/strict';
import test from 'node:test';

import { LEGACY_PREVIEW_DEPLOY_IDS, openActionsTarget, PROJECT_SITE_ID, readActionsCredentials, resolveActionsTarget,
  SOURCE_GUARD_STORE_NAME, verifyActionsTarget } from '../netlify/functions/_shared/exchange-rates-1965-actions-target.mjs';

const DEPLOY = '0123456789abcdef01234567';
const COMMIT = 'a'.repeat(40);
const ENV = { NETLIFY_SITE_ID: PROJECT_SITE_ID, NETLIFY_AUTH_TOKEN: 'mock-only-personal-token' };
const preview = () => ({ kind: 'preview', deployID: DEPLOY, branch: 'codex/actions-test', commit: COMMIT, context: 'deploy-preview' });
const production = () => ({ kind: 'production', branch: 'main', commit: COMMIT, context: 'production' });
const config = (targets = { 'preview-reviewed': preview() }) => ({ schemaVersion: 1, siteID: PROJECT_SITE_ID, targets });
const metadata = (extra = {}) => ({ id: DEPLOY, site_id: PROJECT_SITE_ID, branch: 'codex/actions-test',
  commit_ref: COMMIT, context: 'deploy-preview', state: 'ready', ...extra });

test('reviewed aliases resolve exactly; empty targets fail closed without HTTP or store access', async () => {
  const target = resolveActionsTarget('preview-reviewed', config());
  assert.deepEqual(target, { alias: 'preview-reviewed', siteID: PROJECT_SITE_ID, ...preview() });
  assert.equal(Object.isFrozen(target), true);
  await assert.rejects(openActionsTarget({ alias: 'preview-reviewed', targetsInput: config({}), env: ENV,
    fetchImpl: async () => assert.fail('must not fetch without a reviewed target'),
    getStoreImpl: () => assert.fail('must not open a store without a reviewed target') }), /target_not_configured/);
});

test('targets reject fallback, unknown fields, invalid identity, production deploy IDs and non-main production', () => {
  const cases = [
    null, {}, { ...config(), siteID: 'another-site' }, { ...config(), apiURL: 'https://example.test' },
    config({ 'preview-reviewed': { ...preview(), kind: 'unknown' } }),
    config({ 'preview-reviewed': { ...preview(), region: 'us-east-2' } }),
    config({ 'preview-reviewed': { ...preview(), deployID: 'https://example.test' } }),
    config({ 'preview-reviewed': { ...preview(), commit: 'main' } }),
    config({ 'preview-reviewed': { ...preview(), branch: 'bad\nbranch' } }),
    config({ 'preview-reviewed': { ...preview(), context: 'production' } }),
    config({ production: { ...production(), deployID: DEPLOY } }),
    config({ production: { ...production(), branch: 'feature' } }),
  ];
  for (const input of cases) assert.throws(() => resolveActionsTarget('preview-reviewed', input), /invalid_target_configuration/);
  assert.throws(() => resolveActionsTarget('https://example.test', config()), /invalid_target_configuration/);
  assert.throws(() => resolveActionsTarget('production', config()), /target_not_configured/);
});

test('known immutable source-enabled previews cannot become a new reviewed quote target', async () => {
  for (const deployID of LEGACY_PREVIEW_DEPLOY_IDS) {
    const targetsInput = config({ 'preview-reviewed': { ...preview(), deployID } });
    assert.throws(() => resolveActionsTarget('preview-reviewed', targetsInput), /invalid_target_configuration/);
    await assert.rejects(openActionsTarget({ alias: 'preview-reviewed', targetsInput, env: ENV,
      fetchImpl: async () => assert.fail('must not contact a legacy source deployment') }), /invalid_target_configuration/);
  }
});

test('credentials require the fixed site, never accept inherited runtime context or print credential values', () => {
  assert.deepEqual(readActionsCredentials(ENV), { siteID: PROJECT_SITE_ID, token: ENV.NETLIFY_AUTH_TOKEN });
  for (const env of [
    {}, { ...ENV, NETLIFY_SITE_ID: 'another-site' }, { ...ENV, NETLIFY_AUTH_TOKEN: 'mock-token\n' },
    { ...ENV, NETLIFY_DEV: 'false' }, { ...ENV, NETLIFY_BLOBS_CONTEXT: '' },
  ]) {
    assert.throws(() => readActionsCredentials(env), error => {
      assert.match(error.message, /^(missing_credentials|invalid_credentials|invalid_actions_environment)$/);
      assert.equal(error.message.includes(ENV.NETLIFY_AUTH_TOKEN), false);
      return true;
    });
  }
  globalThis.netlifyBlobsContext = 'mock-runtime-context';
  try { assert.throws(() => readActionsCredentials(ENV), /invalid_actions_environment/); }
  finally { delete globalThis.netlifyBlobsContext; }
});

test('preview metadata uses one fixed-host GET and constructs separate strong deploy and source stores', async () => {
  const requests = [], stores = [];
  const opened = await openActionsTarget({ alias: 'preview-reviewed', targetsInput: config(), env: ENV,
    fetchImpl: async (url, options) => { requests.push({ url, options }); return Response.json(metadata({ secret_extra: 'omit-me' })); },
    getDeployStoreImpl: options => { stores.push({ kind: 'deploy', options }); return { label: 'quote' }; },
    getStoreImpl: options => { stores.push({ kind: 'site', options }); return { label: 'guard' }; },
  });
  assert.equal(requests[0].url, `https://api.netlify.com/api/v1/deploys/${DEPLOY}`);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${ENV.NETLIFY_AUTH_TOKEN}`);
  assert.equal(requests[0].options.signal instanceof AbortSignal, true);
  assert.deepEqual(stores, [
    { kind: 'deploy', options: { name: 'exchange-rates-1965', consistency: 'strong', siteID: PROJECT_SITE_ID,
      token: ENV.NETLIFY_AUTH_TOKEN, deployID: DEPLOY } },
    { kind: 'site', options: { name: SOURCE_GUARD_STORE_NAME, consistency: 'strong', siteID: PROJECT_SITE_ID,
      token: ENV.NETLIFY_AUTH_TOKEN } },
  ]);
  assert.deepEqual(opened.metadata, { id: DEPLOY, siteID: PROJECT_SITE_ID, branch: 'codex/actions-test',
    commit: COMMIT, context: 'deploy-preview', state: 'ready' });
  assert.equal(JSON.stringify(opened).includes(ENV.NETLIFY_AUTH_TOKEN), false);
  assert.equal(JSON.stringify(opened).includes('omit-me'), false);
});

test('production explicitly verifies published deploy metadata before opening only site-wide stores', async () => {
  const requests = [], stores = [];
  const opened = await openActionsTarget({ alias: 'production', targetsInput: config({ production: production() }), env: ENV,
    fetchImpl: async url => {
      requests.push(url);
      return Response.json(requests.length === 1 ? { id: PROJECT_SITE_ID, published_deploy: { id: DEPLOY } }
        : metadata({ context: 'production', branch: 'main' }));
    },
    getDeployStoreImpl: () => assert.fail('production must not open a deploy store'),
    getStoreImpl: options => { stores.push(options); return {}; },
  });
  assert.deepEqual(requests, [`https://api.netlify.com/api/v1/sites/${PROJECT_SITE_ID}`,
    `https://api.netlify.com/api/v1/deploys/${DEPLOY}`]);
  assert.equal(opened.target.deployID, undefined);
  assert.equal(opened.metadata.id, DEPLOY);
  assert.deepEqual(stores.map(store => store.name), ['exchange-rates-1965', SOURCE_GUARD_STORE_NAME]);
  assert.equal(stores.some(store => Object.hasOwn(store, 'deployID')), false);
});

test('a mismatched deploy never opens any store, even when the API returns ready', async () => {
  for (const overrides of [
    { id: '1'.repeat(24) }, { site_id: 'another-site' }, { branch: 'main' },
    { commit_ref: 'b'.repeat(40) }, { context: 'production' }, { state: 'building' },
  ]) {
    await assert.rejects(openActionsTarget({ alias: 'preview-reviewed', targetsInput: config(), env: ENV,
      fetchImpl: async () => Response.json(metadata(overrides)),
      getStoreImpl: () => assert.fail('must not open a mismatched store'),
      getDeployStoreImpl: () => assert.fail('must not open a mismatched store'),
    }), /^Error: target_metadata_mismatch$/);
  }
});

test('production cannot use a missing published deploy, another site or a promoted preview context', async () => {
  const target = resolveActionsTarget('production', config({ production: production() }));
  for (const site of [{ id: PROJECT_SITE_ID }, { id: 'another-site', published_deploy: { id: DEPLOY } },
    { id: PROJECT_SITE_ID, published_deploy: { id: '../../arbitrary' } }]) {
    await assert.rejects(verifyActionsTarget(target, { token: 'mock', fetchImpl: async () => Response.json(site) }), /target_metadata_mismatch/);
  }
  let calls = 0;
  await assert.rejects(verifyActionsTarget(target, { token: 'mock', fetchImpl: async () => Response.json(++calls === 1
    ? { id: PROJECT_SITE_ID, published_deploy: { id: DEPLOY } } : metadata({ branch: 'main' })) }), /target_metadata_mismatch/);
});

test('metadata transport, parsing and SDK errors use fixed messages without leaking bodies or exception text', async () => {
  const secret = 'mock-sensitive-value';
  const failures = [
    async () => { throw new Error(secret); },
    async () => new Response(secret, { status: 403 }),
    async () => new Response(secret, { status: 302, headers: { location: 'https://example.test' } }),
    async () => new Response(secret, { headers: { 'content-type': 'text/html' } }),
    async () => new Response(secret, { headers: { 'content-type': 'application/json' } }),
    async () => Response.json(null),
    async () => new Response('x'.repeat(262_145), { headers: { 'content-type': 'application/json' } }),
  ];
  for (const fetchImpl of failures) {
    await assert.rejects(openActionsTarget({ alias: 'preview-reviewed', targetsInput: config(), env: ENV, fetchImpl }),
      /^Error: target_metadata_unavailable$/);
  }
  await assert.rejects(openActionsTarget({ alias: 'preview-reviewed', targetsInput: config(), env: ENV,
    fetchImpl: async () => Response.json(metadata()), getDeployStoreImpl: () => { throw new Error(secret); } }),
  /^Error: target_store_unavailable$/);
});

test('bootstrap recovery stores are fixed to production and the two known legacy previews', async () => {
  const requests = [], opened = [];
  const result = await openActionsTarget({ alias: 'preview-reviewed', targetsInput: config(), env: ENV,
    fetchImpl: async url => {
      requests.push(url);
      return Response.json(metadata({ id: url.split('/').at(-1) }));
    },
    getDeployStoreImpl: options => { opened.push(options); return { deployID: options.deployID }; },
    getStoreImpl: options => { opened.push(options); return { name: options.name }; },
  });
  assert.equal(requests.length, 1, 'regular commands must not read legacy deployments');
  const legacy = await result.openLegacyStores();
  assert.deepEqual(legacy.map(entry => entry.label), ['production', ...LEGACY_PREVIEW_DEPLOY_IDS.map(id => `legacy-preview-${id}`)]);
  assert.deepEqual(legacy.slice(1).map(entry => entry.store.deployID), LEGACY_PREVIEW_DEPLOY_IDS);
  assert.deepEqual(requests.slice(1), LEGACY_PREVIEW_DEPLOY_IDS.map(id => `https://api.netlify.com/api/v1/deploys/${id}`));
  assert.equal(opened.every(options => options.siteID === PROJECT_SITE_ID && options.consistency === 'strong'), true);
});

test('legacy deployment metadata mismatch refuses bootstrap store construction', async () => {
  let calls = 0;
  const result = await openActionsTarget({ alias: 'preview-reviewed', targetsInput: config(), env: ENV,
    fetchImpl: async () => Response.json(++calls === 1 ? metadata() : metadata({ site_id: 'other-site' })),
    getDeployStoreImpl: () => ({}), getStoreImpl: () => ({}),
  });
  await assert.rejects(result.openLegacyStores(), /legacy_state_unknown/);
});
