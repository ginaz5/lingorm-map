export default async function getConfig(req) {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const googleMapsKey = globalThis.Netlify?.env?.get('GOOGLE_MAPS_KEY');
  const googleMapId = globalThis.Netlify?.env?.get('GOOGLE_MAP_ID');

  if (!googleMapsKey || !googleMapId) {
    return json({ error: 'GOOGLE_MAPS_KEY and GOOGLE_MAP_ID are required' }, 500);
  }

  return json({ googleMapsKey, googleMapId }, 200, 'public, max-age=300');
}

function json(body, status, cacheControl = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': cacheControl,
    },
  });
}

export const config = {
  path: '/api/config',
  method: 'GET',
};
