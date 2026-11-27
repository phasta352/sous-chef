import { authenticate } from './auth.js';
import { HttpError, listItems, lookupBarcode, createItem, updateItem, deleteItem } from './items.js';
import {
  listRecipes, saveRecipe, updateRecipe, deleteRecipe, suggest, importFromUrl,
  listShopping, addShopping, deleteShopping,
} from './recipes.js';

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

  if (pathname === '/api/recipes') {
    if (method === 'GET') return json({ recipes: await listRecipes(env) });
    if (method === 'POST') return json({ recipe: await saveRecipe(env, request, email) }, 201);
  }
  if (pathname === '/api/recipes/suggest' && method === 'POST') return json(await suggest(env, request));
  if (pathname === '/api/recipes/import' && method === 'POST') return json(await importFromUrl(env, request));

  const recipeMatch = pathname.match(/^\/api\/recipes\/(\d+)$/);
  if (recipeMatch) {
    const id = Number(recipeMatch[1]);
    if (method === 'PATCH') return json({ recipe: await updateRecipe(env, request, id) });
    if (method === 'DELETE') return json(await deleteRecipe(env, id));
  }

  if (pathname === '/api/shopping') {
    if (method === 'GET') return json({ items: await listShopping(env) });
    if (method === 'POST') return json(await addShopping(env, request, email), 201);
  }
  const shopMatch = pathname.match(/^\/api\/shopping\/(\d+)$/);
  if (shopMatch && method === 'DELETE') return json(await deleteShopping(env, Number(shopMatch[1])));

  if (pathname === '/api/config' && method === 'GET') {
    return json({ aiEnabled: Boolean(env.ANTHROPIC_API_KEY) });
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
