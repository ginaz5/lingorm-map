import { readFile } from 'node:fs/promises';

import { parseCSV } from '../../src/csv-parser.js';

const DEFAULT_NOTION_SNAPSHOT = new URL('../../data/locations.csv', import.meta.url);

// DATA_SOURCE=sheet is retired as of the 2026-07-21 three-status cutover
// (mirrors build.sh): legacy verified/needs-review statuses now normalize to
// Paused (non-public), so the old Google Sheet proxy would render zero
// public locations. There is no live sheet path anymore — a "sheet" value
// fails closed instead of fetching anything.
export default async function locations(req) {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const dataSource = (env('DATA_SOURCE') || 'notion').trim().toLowerCase();
  if (dataSource === 'notion') {
    return serveNotionSnapshot();
  }
  if (dataSource === 'sheet') {
    return json({
      error:
        'DATA_SOURCE=sheet is retired — legacy verified/needs-review statuses now normalize to Paused (non-public), so the sheet path would render zero public locations. Set DATA_SOURCE=notion (or unset it).',
    }, 410);
  }

  return json({ error: 'DATA_SOURCE must be "notion" (sheet rollback path is retired)' }, 500);
}

export async function serveNotionSnapshot(snapshotPath = DEFAULT_NOTION_SNAPSHOT) {
  try {
    const csv = await readFile(snapshotPath, 'utf8');
    if (!isNotionSnapshot(csv)) {
      return json({
        error: 'Notion snapshot is invalid: expected a CSV with Location Name and Slug columns',
      }, 502);
    }
    return csvResponse(csv);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return json({ error: 'Notion snapshot is not available' }, 503);
    }
    return json({ error: 'Notion snapshot could not be read' }, 502);
  }
}

function env(key) {
  return globalThis.Netlify?.env?.get(key);
}

function isNotionSnapshot(body) {
  if (!body || /^\s*(?:<!doctype html|<html)/i.test(body)) return false;

  const header = body.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase();
  if (!header.includes('location name') || !header.includes('slug')) return false;

  const rows = parseCSV(body);
  return Array.isArray(rows) && rows.length > 0;
}

function csvResponse(csv) {
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    },
  });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export const config = {
  path: '/api/locations',
  method: 'GET',
};
