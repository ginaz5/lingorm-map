import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('configures strict JavaScript type checking', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const config = JSON.parse(await readFile(new URL('../jsconfig.json', import.meta.url), 'utf8'));

  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit -p jsconfig.json');
  assert.equal(typeof pkg.devDependencies.typescript, 'string');
  assert.equal(config.compilerOptions.allowJs, true);
  assert.equal(config.compilerOptions.checkJs, true);
  assert.equal(config.compilerOptions.noEmit, true);
  assert.equal(config.compilerOptions.strict, true);
  assert.deepEqual(config.include, [
    'src/state.js',
    'src/csv-parser.js',
    'src/map.js',
    'src/forms.js',
    'src/map-globals.d.ts',
  ]);
});
