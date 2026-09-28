export class FakeBlobStore {
  constructor() {
    this.entries = new Map();
    this.calls = [];
    this.sequence = 0;
    this.beforeSet = null;
  }

  seed(key, data) {
    const etag = `etag-${++this.sequence}`;
    this.entries.set(key, { data: structuredClone(data), etag, metadata: {} });
    return etag;
  }

  async getWithMetadata(key, options) {
    this.calls.push({ operation: 'get', key, options });
    const entry = this.entries.get(key);
    return entry ? structuredClone(entry) : null;
  }

  async setJSON(key, data, options = {}) {
    this.calls.push({ operation: 'set', key, data: structuredClone(data), options });
    if (this.beforeSet) await this.beforeSet({ key, data, options, store: this });
    const current = this.entries.get(key);
    if (options.onlyIfNew && current) return { modified: false, etag: current.etag };
    if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) {
      return { modified: false, etag: current?.etag };
    }
    const etag = `etag-${++this.sequence}`;
    this.entries.set(key, { data: structuredClone(data), etag, metadata: {} });
    return { modified: true, etag };
  }
}

export const uuid = suffix => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

export function enabledControl(controlVersion = uuid(1), nowMs = Date.parse('2026-09-09T00:00:00Z')) {
  const now = new Date(nowMs).toISOString();
  return {
    enabled: true,
    controlVersion,
    enabledAt: now,
    changedAt: now,
    disabledReason: null,
    disabledAt: null,
    updatedBy: 'manual',
  };
}

export function sourceOptions(ids) {
  return { statusCode: 200, code: 'SUCCESS', data: ids.map(value => ({ value, label: `source-${value}` })) };
}

export function sourceQuote(branchCode, values = {}) {
  const row = (unit, denomRem, buyText) => ({ unit, denomRem, buyText, sellText: '999', branchCode });
  return {
    statusCode: 200,
    code: 'SUCCESS',
    data: {
      exchange: {
        USD: [row('USD', '100', values.USD_100 ?? '32.83'), row('USD', '50', values.USD_50 ?? '32.81')],
        TWD: [row('TWD', '2000 - 100', values.TWD ?? '0.995')],
      },
    },
  };
}

export function jsonResponse(value, status = 200, headers = {}) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers });
}

export function twoBranchMapping() {
  return {
    schemaVersion: 1,
    branches: {
      'superrich-thailand-10': { officialId: 10, branchCode: 'H01' },
      'superrich-thailand-11': { officialId: 11, branchCode: 'B01' },
    },
  };
}
