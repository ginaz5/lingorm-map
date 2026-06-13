import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadSourceRenderer() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const cMatch = html.match(/const C=\{[\s\S]*?\};/);
  const renderMatch = html.match(/function renderSources\(row\)\{[\s\S]*?\n\}/);

  assert.ok(cMatch, 'column indexes should exist in index.html');
  assert.ok(renderMatch, 'renderSources function should exist in index.html');

  return Function(`${cMatch[0]}\n${renderMatch[0]}; return {C, renderSources};`)();
}

test('renderSources labels repeated Threads tags by handle', async () => {
  const { C, renderSources } = await loadSourceRenderer();
  const row = [];
  row[C.SRC] = 'Trip.com + Threads + Threads + Google Maps';
  row[C.SOURCE_URL] = [
    'https://tw.trip.com/moments/detail/bangkok-191-140507082/',
    'https://www.threads.com/@nightviper74/post/DId7paOJUKp',
    'https://www.threads.com/@my_go_go_d/post/DDVt-bayjvt',
    'https://maps.app.goo.gl/KoHpGcDNJB7bxsQ49',
  ].join(', ');

  const html = renderSources(row);

  assert.match(html, />Trip.com</);
  assert.match(html, />Threads @nightviper74</);
  assert.match(html, />Threads @my_go_go_d</);
  assert.match(html, />Google Maps</);
});
