import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPythonSafariFetch } from '../../../scripts/exchange-rates-1965-python.mjs';
import { createAnonymousApiSource } from './exchange-rates-1965-anonymous.mjs';

const executable = () => resolve(process.cwd(), '.runtime/superrich1965/python/bin/python3.12');
function pythonEnvironment() {
  const ca = ['/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/certs/ca-certificates.crt'].find(path => existsSync(path));
  return { PATH: process.env.PATH, LANG: 'C.UTF-8', ...(ca ? { SSL_CERT_FILE: ca } : {}) };
}
export async function createRuntimePythonSource() {
  const { stdout } = await promisify(execFile)(executable(), ['--version'], { timeout: 3000, maxBuffer: 4096, env: pythonEnvironment() });
  if (stdout.trim() !== 'Python 3.12.15') throw new Error('invalid_python_runtime');
  const spawnPython = /** @type {typeof spawn} */ (/** @type {unknown} */ (
    (/** @type {string} */ command, /** @type {readonly string[]} */ args,
      /** @type {import('node:child_process').SpawnOptions} */ options) => spawn(executable(),
      ['-I', '-B', resolve(process.cwd(), 'scripts/exchange-rates-1965-python-http.py')], { ...options, env: pythonEnvironment() })));
  return createAnonymousApiSource({ fetchImpl: createPythonSafariFetch({ spawnImpl: spawnPython }) });
}
