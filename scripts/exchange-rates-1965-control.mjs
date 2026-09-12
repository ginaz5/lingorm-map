import { pathToFileURL } from 'node:url';

import {
  EXCHANGE_KEYS, isValidBreaker, isValidControl, isValidLastAttempt, isValidSnapshot,
} from '../netlify/functions/_shared/exchange-rates-1965-contract.mjs';
import { changeControl } from '../netlify/functions/_shared/exchange-rates-1965-control.mjs';
import { createAdminStore, readEntry } from '../netlify/functions/_shared/exchange-rates-1965-storage.mjs';

const REASON_PATTERN = /^[a-z0-9_]{1,64}$/;

/** @param {string[]} argv */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['status', 'enable', 'disable'].includes(command) || rest.length > 2) {
    throw new Error('Usage: npm run fx:1965:control -- status|enable|disable [--reason code]');
  }
  let reason = 'manual';
  if (rest.length) {
    if (command !== 'disable' || rest.length !== 2 || rest[0] !== '--reason' || !REASON_PATTERN.test(rest[1])) {
      throw new Error('Disable reason must match [a-z0-9_]{1,64}.');
    }
    reason = rest[1];
  }
  return { command, reason };
}

/** @param {any|null} entry @param {(value:unknown)=>boolean} validator */
function serializeEntry(entry, validator) {
  if (entry === null) return null;
  if (!validator(entry.data)) throw new Error('Stored exchange-rate state is invalid.');
  return entry.data;
}

/**
 * @param {string[]} argv
 * @param {{store?:any, nowMs?:number, randomUUIDImpl?:()=>string}} [input]
 */
export async function runControlCommand(argv, {
  store = null,
  nowMs = Date.now(),
  randomUUIDImpl,
} = {}) {
  const { command, reason } = parseArgs(argv);
  const targetStore = store ?? createAdminStore();
  if (command === 'status') {
    const [controlEntry, breakerEntry, snapshotEntry, lastAttemptEntry] = await Promise.all([
      readEntry(targetStore, EXCHANGE_KEYS.control),
      readEntry(targetStore, EXCHANGE_KEYS.breaker),
      readEntry(targetStore, EXCHANGE_KEYS.snapshot),
      readEntry(targetStore, EXCHANGE_KEYS.lastAttempt),
    ]);
    const control = serializeEntry(controlEntry, isValidControl);
    const breaker = serializeEntry(breakerEntry, isValidBreaker);
    const snapshot = serializeEntry(snapshotEntry, isValidSnapshot);
    const lastAttempt = serializeEntry(lastAttemptEntry, isValidLastAttempt);
    return {
      control,
      breaker,
      lastAttempt,
      snapshot: snapshot === null ? null : {
        runId: snapshot.runId,
        controlVersion: snapshot.controlVersion,
        completedAt: snapshot.completedAt,
        expiresAt: snapshot.expiresAt,
      },
    };
  }
  const control = await changeControl(targetStore, {
    enabled: command === 'enable',
    reason,
    updatedBy: 'manual',
    nowMs,
    ...(randomUUIDImpl ? { randomUUIDImpl } : {}),
  });
  return { control };
}

async function main() {
  try {
    console.log(JSON.stringify(await runControlCommand(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Exchange-rate control failed.');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
