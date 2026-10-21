import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HELPER = fileURLToPath(new URL('./exchange-rates-1965-python-http.py', import.meta.url));
const TOKEN_URL = 'https://api.superrich1965.com/front/exchange-rate/oauth2/callback';
const RATE_URL = 'https://www.superrich1965.com/api/exchange-rate-service/v1/external-app-exchange-rate/get';
const MAX_OUTPUT = 7 * 1024 * 1024; // JSON escaping can expand a bounded 1 MiB body sixfold.
const DIAGNOSTIC_HEADERS = ['content-type', 'cf-mitigated', 'cf-ray', 'retry-after'];

/** The Python experiment is limited to the one reviewed branch. No caller URL,
 * credentials, headers or executable configuration passes through to Python.
 * @param {RequestInfo|URL} input @param {RequestInit|undefined} options
 */
function requestMessage(input, options) {
  if (String(input) === TOKEN_URL && options?.method === 'GET' && options.body == null) return { stage: 'token' };
  if (String(input) !== RATE_URL || options?.method !== 'POST' || typeof options.body !== 'string' || options.body.length > 4096) {
    throw new Error('invalid_python_request');
  }
  let token;
  try { token = new Headers(options.headers).get('authorization')?.match(/^Bearer ([A-Za-z0-9._~+\/-]+={0,2})$/)?.[1]; }
  catch { throw new Error('invalid_python_request'); }
  if (!token || token.length > 16_384) throw new Error('invalid_python_request');
  let body;
  try { body = JSON.parse(options.body); } catch { throw new Error('invalid_python_request'); }
  if (JSON.stringify(body) !== JSON.stringify({ filters: [
    { field: 'company_code', value: 'A04' }, { field: 'branch_no', value: '36' },
  ] })) throw new Error('invalid_python_request');
  return { stage: 'rate', token, body: options.body };
}

/** Factory and import do not start Python or HTTP. Each request gets a fresh,
 * isolated stdlib process; the anonymous session keeps its token only in memory.
 * @param {{spawnImpl?:typeof spawn}} [input]
 * @returns {typeof fetch}
 */
export function createPythonSafariFetch({ spawnImpl = spawn } = {}) {
  return async (input, options) => {
    const message = requestMessage(input, options);
    options?.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnImpl('python3', ['-I', '-B', HELPER], {
          shell: false, env: { PATH: process.env.PATH, LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch { reject(new Error('python_source_failed')); return; }
      let buffer = '', bytes = 0, failed = false, finished = false;
      /** @type {{status:number,headers:Record<string,string>}|null} */
      let headers = null;
      /** @type {string|null} */
      let body = null;
      const stop = () => { failed = true; child.kill('SIGKILL'); };
      const timer = setTimeout(stop, 12_500);
      const signal = options?.signal;
      signal?.addEventListener('abort', stop, { once: true });
      const finish = (/** @type {boolean} */ ok) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        if (!headers) { reject(new Error('python_source_failed')); return; }
        // Retain known HTTP/challenge metadata even if cancellation or a body
        // failure follows headers. Existing telemetry decides known vs unknown.
        const responseBody = ok && !failed && body !== null ? body : new ReadableStream({
          start(controller) { controller.error(new Error('python_source_failed')); },
        });
        resolve(new Response([204, 205, 304].includes(headers.status) ? null : responseBody, headers));
      };
      const line = (/** @type {string} */ value) => {
        try {
          const event = JSON.parse(value);
          if (event.event === 'headers' && !headers && body === null &&
              Object.keys(event).length === 3 && Number.isInteger(event.status) && event.status >= 200 && event.status <= 599 &&
              event.headers && typeof event.headers === 'object' && !Array.isArray(event.headers) &&
              Object.entries(event.headers).every(([key, value]) => DIAGNOSTIC_HEADERS.includes(key) &&
                typeof value === 'string' && /^[\x20-\x7e]{0,100}$/.test(value))) {
            headers = { status: event.status, headers: event.headers };
          } else if (event.event === 'body' && headers && body === null && Object.keys(event).length === 2 &&
              typeof event.body === 'string' && Buffer.byteLength(event.body) <= (message.stage === 'token' ? 65_536 : 1024 * 1024)) {
            body = event.body;
          } else stop();
        } catch { stop(); }
      };
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (/** @type {string} */ chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_OUTPUT || failed) { stop(); return; }
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) !== -1 && !failed) {
          const value = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          line(value);
        }
      });
      child.stderr?.resume(); // Never propagate Python exception/body/credential text.
      child.stdin?.on('error', stop);
      child.stdout?.on('error', stop);
      child.on('error', () => { failed = true; });
      child.once('close', code => finish(code === 0 && buffer === '' && body !== null));
      try { child.stdin?.end(JSON.stringify(message)); } catch { stop(); }
      if (signal?.aborted) stop();
    });
  };
}
