import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('index UI does not render Google Maps open links', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.equal(html.includes('popup-maplink'), false);
  assert.equal(html.includes("${t('maps')}"), false);
});
