// Luminary API proxy (Cloudflare Worker).
// Holds the Pexels, Unsplash and Pixabay keys as secrets so they never appear in index.html.
//
// Deploy from the Cloudflare dashboard:
//   1. Workers & Pages → Create → Create Worker, paste this file, Deploy.
//   2. Worker → Settings → Variables and Secrets → add secrets PEXELS_KEY, UNSPLASH_KEY, PIXABAY_KEY.
//   3. Optional: add a plain variable ALLOWED_ORIGINS with your site's address, e.g.
//      https://yourname.github.io  (comma-separate several; leave unset to allow any site).
//   4. Put the worker's URL (https://<name>.<account>.workers.dev) in PROXY_URL in index.html.
// Or from this folder with the Wrangler CLI: `npx wrangler deploy`, then
// `npx wrangler secret put PEXELS_KEY` (and the same for UNSPLASH_KEY and PIXABAY_KEY).

const ROUTES = {
  pexels: {
    url: 'https://api.pexels.com/v1/search',
    params: ['query', 'per_page', 'page'],
    sign: (upstream, headers, env) => headers.set('Authorization', env.PEXELS_KEY),
  },
  unsplash: {
    url: 'https://api.unsplash.com/search/photos',
    params: ['query', 'per_page', 'page', 'content_filter'],
    sign: (upstream, headers, env) => headers.set('Authorization', `Client-ID ${env.UNSPLASH_KEY}`),
  },
  pixabay: {
    url: 'https://pixabay.com/api/',
    params: ['q', 'per_page', 'page', 'safesearch'],
    sign: (upstream, headers, env) => upstream.searchParams.set('key', env.PIXABAY_KEY),
  },
};

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  const allowOrigin = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : null;
  return allowOrigin && {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get('Origin') || '', env);
    if (!cors) return new Response('Origin not allowed', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const url = new URL(request.url);
    const route = ROUTES[url.pathname.replace(/^\/+|\/+$/g, '')];
    if (!route) return new Response('Not found', { status: 404, headers: cors });

    // Forward only the parameters the app uses, so the proxy can't be used to reach other endpoints
    const upstream = new URL(route.url);
    for (const name of route.params) {
      const value = url.searchParams.get(name);
      if (value !== null) upstream.searchParams.set(name, value.slice(0, 200));
    }
    const headers = new Headers({ Accept: 'application/json' });
    route.sign(upstream, headers, env);

    const res = await fetch(upstream, { headers });
    return new Response(res.body, {
      status: res.status,
      headers: {
        ...cors,
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
    });
  },
};
