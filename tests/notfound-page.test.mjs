import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the 404 page title links back to the map', async () => {
  const html = await readFile(new URL('../404.html', import.meta.url), 'utf8');

  assert.match(html, /<a class="logo" href="\/"[^>]*>🗺 LingOrm Map<\/a>/);
  assert.doesNotMatch(html, /<span class="logo">/);
  // The existing call-to-action button stays; the title is an extra way home.
  assert.match(html, /<a class="btn" href="\/">/);
  // A link needs the underline removed, like the page's other anchors.
  assert.match(html, /\.logo\{[^}]*text-decoration:none/s);
});
