import { mkdir, readFile, writeFile, lstat, readdir, readlink, access } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

export const PYTHON_URL = 'https://github.com/astral-sh/python-build-standalone/releases/download/20261021/cpython-3.12.15%2B20261021-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz';
export const PYTHON_SHA256 = '6d7521138fd33afddc1ccd08abb007d9a2829e38117c2576f9efdc0ec73ce772';
const run = promisify(execFile);

/** @param {string} root @param {string} [directory] */
async function checkLinks(root, directory = root) {
  for (const name of await readdir(directory)) {
    const path = join(directory, name), stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const target = await readlink(path);
      const local = relative(root, resolve(directory, target));
      if (isAbsolute(target) || local.startsWith('..') || isAbsolute(local)) throw new Error('invalid_python_link');
    } else if (stat.isDirectory()) await checkLinks(root, path);
  }
}

/** @param {{root?:string,fetchImpl?:typeof fetch}} [input] */
export async function preparePython({ root = resolve('.runtime/superrich1965'), fetchImpl = fetch } = {}) {
  await mkdir(root, { recursive: true });
  const archive = join(root, 'python.tar.gz');
  let bytes;
  try { bytes = await readFile(archive); } catch {
    const response = await fetchImpl(PYTHON_URL, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error('python_download_failed');
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 64 * 1024 * 1024) throw new Error('invalid_python_archive');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== PYTHON_SHA256) throw new Error('python_digest_mismatch');
  await writeFile(archive, bytes);
  const { stdout } = await run('tar', ['-tzf', archive], { maxBuffer: 4 * 1024 * 1024 });
  if (stdout.split('\n').filter(Boolean).some(path => !path.startsWith('python/') || path.split('/').includes('..'))) throw new Error('invalid_python_archive');
  await run('tar', ['--exclude=python/share', '-xzf', archive, '-C', root]);
  await checkLinks(join(root, 'python'));
  const executable = join(root, 'python/bin/python3.12');
  await access(executable);
  if (process.platform === 'linux' && process.arch === 'x64') {
    const { stdout } = await run(executable, ['-I', '-B', '-c', 'import sys,ssl,urllib.request;print(sys.version.split()[0])']);
    if (stdout.trim() !== '3.12.15') throw new Error('invalid_python_version');
  }
  console.log('Verified standalone Python 3.12.15 runtime prepared for Netlify.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await preparePython();
