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

const unsplashAuth = (upstream, headers, env) => headers.set('Authorization', `Client-ID ${env.UNSPLASH_KEY}`);

// Each route builds the upstream URL from the incoming query, copying only parameters the app uses,
// so the proxy can't be pointed at other endpoints. cacheSeconds sets how long browsers may reuse a response.
const ROUTES = {
  pexels: {
    build: q => forward('https://api.pexels.com/v1/search', q, ['query', 'per_page', 'page']),
    sign: (upstream, headers, env) => headers.set('Authorization', env.PEXELS_KEY),
    cacheSeconds: 300,
  },
  unsplash: {
    build: q => forward('https://api.unsplash.com/search/photos', q, ['query', 'per_page', 'page', 'content_filter']),
    sign: unsplashAuth,
    cacheSeconds: 300,
  },
  // Unsplash requires a photo's download_location to be called whenever a user downloads it
  'unsplash-download': {
    build: q => unsplashDownloadUrl(q.get('url')),
    sign: unsplashAuth,
    cacheSeconds: 0,
  },
  pixabay: {
    build: q => forward('https://pixabay.com/api/', q, ['q', 'id', 'per_page', 'page', 'safesearch']),
    sign: (upstream, headers, env) => upstream.searchParams.set('key', env.PIXABAY_KEY),
    cacheSeconds: 86400, // Pixabay asks that API requests be cached for 24 hours
  },
};

function forward(base, query, names) {
  const upstream = new URL(base);
  for (const name of names) {
    const value = query.get(name);
    if (value !== null) upstream.searchParams.set(name, value.slice(0, 200));
  }
  return upstream;
}

function unsplashDownloadUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.host !== 'api.unsplash.com' || !/^\/photos\/[\w-]+\/download$/.test(u.pathname)) return null;
    u.searchParams.delete('client_id');
    return u;
  } catch {
    return null;
  }
}

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

    const upstream = route.build(url.searchParams);
    if (!upstream) return new Response('Bad request', { status: 400, headers: cors });
    const headers = new Headers({ Accept: 'application/json' });
    route.sign(upstream, headers, env);

    const res = await fetch(upstream, { headers });
    return new Response(res.body, {
      status: res.status,
      headers: {
        ...cors,
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
        'Cache-Control': route.cacheSeconds ? `public, max-age=${route.cacheSeconds}` : 'no-store',
      },
    });
  },
};
