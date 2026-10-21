import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const functionsURL = new URL('../netlify/functions/', import.meta.url);

async function localDependencies(url, visited = new Set()) {
  if (visited.has(url.href)) return visited;
  visited.add(url.href);
  if (!/\.[cm]?js$/.test(url.pathname)) return visited;
  const source = await readFile(url, 'utf8');
  for (const match of source.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*['"](\.[^'"]+)['"]/g)) {
    await localDependencies(new URL(match[1] ?? match[2], url), visited);
  }
  return visited;
}

test('retired orange scheduled and background functions cannot be deployed', async () => {
  for (const name of ['exchange-rates-1965-fetch.mjs', 'exchange-rates-1965-refresh.mjs']) {
    await assert.rejects(access(new URL(name, functionsURL)), { code: 'ENOENT' });
  }
  const configuration = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  assert.doesNotMatch(configuration, /\[functions\."exchange-rates-1965-(?:fetch|refresh)"\]/);
});

test('deployed orange API entry points only expose cache readers', async () => {
  const names = (await readdir(functionsURL)).filter(name => /^exchange-rates-1965(?:-|\.)/.test(name));
  assert.ok(names.includes('exchange-rates-1965.mjs'), 'existing local snapshot API remains available');
  assert.ok(names.includes('exchange-rates-1965-cache.mjs'), 'branch cache API remains available');
  assert.ok(names.includes('exchange-rates-1965-branch.mjs'), 'single branch cache API remains available');
  for (const name of names) {
    const source = await readFile(new URL(name, functionsURL), 'utf8');
    assert.doesNotMatch(source, /\b(?:schedule|background)\s*:/, name);
    // Shared collectors remain available to an authorized external runner, but
    // a deployable Netlify API must never create a source session or fetch job.
    assert.doesNotMatch(source, /\b(?:createSourceSession|createAnonymousApiSource|collectSourceQuotes|queryBranchRates|runSlowBatch|ensureFetchControl)\b/, name);
    for (const dependency of await localDependencies(new URL(name, functionsURL))) {
      assert.doesNotMatch(dependency,
        /\/_shared\/exchange-rates-1965-(?:source(?:-telemetry)?|anonymous|browser|on-demand|background|runner)\.mjs$/,
        `${name} must not load a collector through shared dependencies`);
    }
  }
});
