/** Public, read-only identity of the currently routed deployment. No credentials.
 * @param {Request} request @param {any} context
 */
export default function runtimeIdentity(request, context) {
  return Response.json({ schemaVersion: 1, siteID: context?.site?.id ?? null,
    deployID: context?.deploy?.id ?? null, context: context?.deploy?.context ?? null, node: process.version },
  { headers: { 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store' } });
}
export const config = { path: '/api/exchange-rates-1965-runtime', nodeVersion: '22' };
