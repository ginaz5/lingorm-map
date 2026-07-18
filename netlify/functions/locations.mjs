import { readFile } from 'node:fs/promises';

import { parseCSV } from '../../src/csv-parser.js';

const DEFAULT_NOTION_SNAPSHOT = new URL('../../data/locations.csv', import.meta.url);

export default async function locations(req) {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const dataSource = (env('DATA_SOURCE') || 'sheet').trim().toLowerCase();
  if (dataSource === 'notion') {
    return serveNotionSnapshot();
  }
  if (dataSource !== 'sheet') {
    return json({ error: 'DATA_SOURCE must be either "sheet" or "notion"' }, 500);
  }

  return serveSheet();
}

async function serveSheet() {
  const csvUrl = normalizeSheetUrl(env('GOOGLE_SHEET_CSV_URL'));
  if (!csvUrl) {
    return json({ error: 'GOOGLE_SHEET_CSV_URL is not configured' }, 500);
  }

  try {
    const upstream = await fetch(csvUrl);
    if (!upstream.ok) {
      return json({ error: `Google Sheet CSV request failed: ${upstream.status}` }, 502);
    }

    const csv = await upstream.text();
    if (isHtmlResponse(upstream, csv)) {
      return json({
        error: 'Google Sheet URL did not return CSV. Use a published CSV URL or a share URL that can be exported as CSV.',
      }, 502);
    }

    return csvResponse(csv);
  } catch (error) {
    return json({ error: error.message || 'Google Sheet CSV request failed' }, 502);
  }
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

function normalizeSheetUrl(value) {
  if (!value) return '';

  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
    if (!match || !url.pathname.includes('/edit')) return value;

    const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${match[1]}/export`);
    exportUrl.searchParams.set('format', 'csv');
    const gid = url.searchParams.get('gid') || value.match(/[#&?]gid=(\d+)/)?.[1];
    if (gid) exportUrl.searchParams.set('gid', gid);
    return exportUrl.toString();
  } catch {
    return value;
  }
}

function isHtmlResponse(response, body) {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('text/html') || /^\s*<!doctype html/i.test(body) || /^\s*<html/i.test(body);
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
