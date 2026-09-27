import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// `locations:refresh` must validate the candidate snapshot before promoting it,
// and chain every step with `&&`, so a failed export or validation never
// overwrites the production snapshot.
test('locations:refresh validates the candidate snapshot before promoting it', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.deepEqual(pkg.scripts['locations:refresh'].split(' && '), [
    'npm run locations:export:notion -- --output data/locations.next.csv',
    'node scripts/validate-location-snapshot.mjs data/locations.next.csv',
    'node scripts/validate-favorite-compatibility.mjs data/locations.next.csv data/legacy-favorite-ids.json',
    'mv data/locations.next.csv data/locations.csv',
  ]);
});
