import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

test('the 404 page title links back to the map', async () => {
  const html = await readFile(new URL('../404.html', import.meta.url), 'utf8');

  assert.match(html, /<a class="logo" href="\/"[^>]*>🗺 LingOrm Map<\/a>/);
  assert.doesNotMatch(html, /<span class="logo">/);
  // The existing call-to-action button stays; the title is an extra way home.
  assert.match(html, /<a class="btn" href="\/">/);
  // A link needs the underline removed, like the page's other anchors.
  assert.match(html, /\.logo\{[^}]*text-decoration:none/s);
});

test('the production build ships the custom 404 page with root home links', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const output = await mkdtemp(join(tmpdir(), 'lingorm-notfound-build-'));
  try {
    await build({
      root,
      configFile: join(root, 'vite.config.js'),
      logLevel: 'silent',
      build: { outDir: output, emptyOutDir: true },
    });
    const html = await readFile(join(output, '404.html'), 'utf8');
    assert.match(html, /<title>404 · LingOrm Map<\/title>/);
    assert.match(html, /<a class="logo" href="\/"[^>]*>🗺 LingOrm Map<\/a>/);
    assert.match(html, /<a class="btn" href="\/">/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
