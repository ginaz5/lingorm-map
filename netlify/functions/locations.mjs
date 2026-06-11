export default async function locations(req) {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const csvUrl = globalThis.Netlify?.env?.get('GOOGLE_SHEET_CSV_URL');
  if (!csvUrl) {
    return json({ error: 'GOOGLE_SHEET_CSV_URL is not configured' }, 500);
  }

  try {
    const upstream = await fetch(csvUrl);
    if (!upstream.ok) {
      return json({ error: `Google Sheet CSV request failed: ${upstream.status}` }, 502);
    }

    const csv = await upstream.text();
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
