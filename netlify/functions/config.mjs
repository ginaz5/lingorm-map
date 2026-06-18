export default async function getConfig(req) {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const hereApiKey = globalThis.Netlify?.env?.get('HERE_API_KEY');
  const googleMapsKey = globalThis.Netlify?.env?.get('GOOGLE_MAPS_KEY');
  const googleMapId = globalThis.Netlify?.env?.get('GOOGLE_MAP_ID');

  if (!hereApiKey) {
    return json({ error: 'HERE_API_KEY is required' }, 500);
  }

  const result = { hereApiKey };
  if (googleMapsKey && googleMapId) {
    result.googleMapsKey = googleMapsKey;
    result.googleMapId = googleMapId;
  }

  return json(result, 200, 'public, max-age=300');
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
