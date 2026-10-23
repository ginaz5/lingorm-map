import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const COLLECTOR = /^(?:netlify\/functions\/_shared\/exchange-rates-1965-(?:actions-runner|actions-target|anonymous|background|on-demand|runner|source|source-guard)\.mjs|scripts\/exchange-rates-1965-(?:actions(?:-control)?|python)\.mjs)$/;

function localImports(code) {
  const declared = /\b(?:import\s+(?:[^;"'`]*?\s+from\s*)?|export\s+[^;"'`]*?\s+from\s*)["']([^"']+)["']/g;
  const dynamic = /\bimport\s*\(\s*["']([^"']+)["']/g;
  return [...code.matchAll(declared), ...code.matchAll(dynamic)]
    .map(match => match[1]).filter(specifier => specifier.startsWith('.'));
}

test('public Function and page dependency graphs remain isolated from the orange collector', async () => {
  const functions = await readdir(resolve(ROOT, 'netlify/functions'), { withFileTypes: true });
  const privateCollectors = ['exchange-rates-1965-worker.mjs', 'exchange-rates-1965-schedule.mjs'];
  const roots = functions.filter(entry => entry.isFile() && /\.[cm]?js$/.test(entry.name) && !privateCollectors.includes(entry.name))
    .map(entry => resolve(ROOT, 'netlify/functions', entry.name));
  assert.ok(roots.length > 0, 'must inspect the deployable Function entrypoints');
  for (const html of ['index.html', 'changelog.html']) {
    const code = await readFile(resolve(ROOT, html), 'utf8');
    for (const match of code.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) {
      if (/^(?:https?:)?\/\//.test(match[1])) continue;
      roots.push(resolve(ROOT, match[1].replace(/^\//, '').split(/[?#]/)[0]));
    }
  }
  const visited = new Set();
  async function visit(path) {
    if (visited.has(path)) return;
    visited.add(path);
    const name = relative(ROOT, path).split(sep).join('/');
    assert.equal(COLLECTOR.test(name), false, `public dependency reaches collector: ${name}`);
    if (!/\.[cm]?js$/.test(path)) return;
    const code = await readFile(path, 'utf8');
    for (const specifier of localImports(code)) await visit(resolve(dirname(path), specifier));
  }
  for (const root of roots) await visit(root);
  assert.ok(visited.size > roots.length, 'must traverse imported modules as well as entrypoints');
});

test('importing Actions tools and creating an anonymous session performs zero HTTP requests', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('unexpected_http_during_import'); };
    await import('./scripts/exchange-rates-1965-actions.mjs');
    await import('./scripts/exchange-rates-1965-actions-control.mjs');
    const { createAnonymousApiSource } = await import('./netlify/functions/_shared/exchange-rates-1965-anonymous.mjs');
    const session = createAnonymousApiSource();
    await session.close();
    if (requests !== 0) throw new Error('unexpected_http_count');
    process.stdout.write('zero-http');
  `], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.stdout, 'zero-http');
});
