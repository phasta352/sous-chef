import { authenticate } from './auth.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function handleApi(request, env, url) {
  const email = await authenticate(request, env);
  if (!email) return json({ error: 'Not signed in' }, 401);

  if (url.pathname === '/api/me' && request.method === 'GET') {
    return json({ email });
  }

  if (url.pathname === '/api/health' && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT COUNT(*) AS items FROM items').first();
    return json({ ok: true, items: row?.items ?? 0 });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        console.error(err);
        return json({ error: 'Something went wrong' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
