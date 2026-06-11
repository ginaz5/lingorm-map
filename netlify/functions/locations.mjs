export default async function locations(req) {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const csvUrl = normalizeSheetUrl(globalThis.Netlify?.env?.get('GOOGLE_SHEET_CSV_URL'));
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

    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    return json({ error: error.message || 'Google Sheet CSV request failed' }, 502);
  }
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
