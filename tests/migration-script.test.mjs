import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, '..', 'scripts', 'migrate-sheet-to-notion.mjs');
const header = 'Location Name,Category,Verification Status,Lat,Lng';

function runMigration(sourceRows, existingSlugs) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'lingorm-migration-test-'));
  const sourcePath = path.join(cwd, 'source.csv');
  const existingPath = path.join(cwd, 'existing.json');
  writeFileSync(sourcePath, [header, ...sourceRows].join('\n'));
  writeFileSync(existingPath, JSON.stringify(existingSlugs));

  const result = spawnSync(process.execPath, [
    scriptPath,
    sourcePath,
    '--existing-slugs',
    existingPath,
  ], { cwd, encoding: 'utf8' });

  return { cwd, result };
}

test('migration skips every slug present in the current Notion snapshot', (t) => {
  const { cwd, result } = runMigration([
    'Alpha Cafe,Cafe,Verified,13.75,100.50',
    'Beta Cafe,Cafe,Verified,13.76,100.51',
  ], ['alpha-cafe', 'beta-cafe']);
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  assert.equal(result.status, 0, result.stderr);
  const createOutput = JSON.parse(readFileSync(path.join(cwd, 'migration-output', 'pages-to-create.json'), 'utf8'));
  const updateOutput = JSON.parse(readFileSync(path.join(cwd, 'migration-output', 'pages-to-update.json'), 'utf8'));
  assert.deepEqual(createOutput, []);
  assert.deepEqual(updateOutput, []);
});

test('migration rejects slug collisions before writing a payload', (t) => {
  const { cwd, result } = runMigration([
    'Cafe!,Cafe,Verified,13.75,100.50',
    'Cafe?,Cafe,Verified,13.76,100.51',
  ], []);
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Slug collisions detected/);
  assert.equal(existsSync(path.join(cwd, 'migration-output', 'pages-to-create.json')), false);
});
