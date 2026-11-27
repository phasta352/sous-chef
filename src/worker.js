import { authenticate } from './auth.js';
import { HttpError, listItems, lookupBarcode, createItem, updateItem, deleteItem } from './items.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function handleApi(request, env, url) {
  const email = await authenticate(request, env);
  if (!email) return json({ error: 'Not signed in' }, 401);

  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/me' && method === 'GET') {
    return json({ email });
  }

  if (pathname === '/api/health' && method === 'GET') {
    const row = await env.DB.prepare('SELECT COUNT(*) AS items FROM items').first();
    return json({ ok: true, items: row?.items ?? 0 });
  }

  if (pathname === '/api/items') {
    if (method === 'GET') return json({ items: await listItems(env) });
    if (method === 'POST') return json({ item: await createItem(env, request, email) }, 201);
  }

  const itemMatch = pathname.match(/^\/api\/items\/(\d+)$/);
  if (itemMatch) {
    const id = Number(itemMatch[1]);
    if (method === 'PATCH') return json({ item: await updateItem(env, request, id, email) });
    if (method === 'DELETE') return json(await deleteItem(env, id));
  }

  const lookupMatch = pathname.match(/^\/api\/lookup\/([^/]+)$/);
  if (lookupMatch && method === 'GET') {
    return json(await lookupBarcode(env, decodeURIComponent(lookupMatch[1])));
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
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        console.error(err);
        return json({ error: 'Something went wrong' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
