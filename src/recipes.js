// Saved recipes and the shopping list.
import { HttpError } from './items.js';
import { suggestRecipes, importRecipe } from './ai.js';

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Expected a JSON body');
  }
}

function str(value, max, field) {
  const s = String(value ?? '').trim();
  if (s.length > max) throw new HttpError(400, `${field} is too long`);
  return s;
}

function cleanRecipe(body) {
  const title = str(body.title, 200, 'Title');
  if (!title) throw new HttpError(400, 'Title is required');
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
  const steps = Array.isArray(body.steps) ? body.steps : [];
  if (!ingredients.length || !steps.length) throw new HttpError(400, 'A recipe needs ingredients and steps');
  if (ingredients.length > 100 || steps.length > 100) throw new HttpError(400, 'That recipe is too long');
  let sourceUrl = null;
  if (body.sourceUrl) {
    try {
      const u = new URL(String(body.sourceUrl));
      if (u.protocol === 'https:' || u.protocol === 'http:') sourceUrl = u.toString();
    } catch { /* ignore bad URL */ }
  }
  return {
    title,
    summary: str(body.summary, 1000, 'Summary'),
    servings: str(body.servings, 60, 'Servings'),
    totalTime: str(body.totalTime, 60, 'Time'),
    ingredients: ingredients.map((i) => ({
      name: str(i?.name, 200, 'Ingredient'),
      amount: str(i?.amount, 100, 'Amount'),
    })).filter((i) => i.name),
    steps: steps.map((s) => str(s, 2000, 'Step')).filter(Boolean),
    source: sourceUrl ? 'url' : 'ai',
    sourceUrl,
    favorite: body.favorite ? 1 : 0,
  };
}

function rowToRecipe(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    servings: row.servings,
    totalTime: row.total_time,
    ingredients: JSON.parse(row.ingredients),
    steps: JSON.parse(row.steps),
    source: row.source,
    sourceUrl: row.source_url,
    favorite: row.favorite === 1,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

// ---------- Recipes ----------

export async function listRecipes(env) {
  const { results } = await env.DB.prepare('SELECT * FROM recipes ORDER BY favorite DESC, created_at DESC, id DESC').all();
  return results.map(rowToRecipe);
}

export async function saveRecipe(env, request, email) {
  const r = cleanRecipe(await readJson(request));
  const row = await env.DB.prepare(
    `INSERT INTO recipes (title, summary, servings, total_time, ingredients, steps, source, source_url, favorite, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING *`,
  ).bind(
    r.title, r.summary, r.servings, r.totalTime,
    JSON.stringify(r.ingredients), JSON.stringify(r.steps),
    r.source, r.sourceUrl, r.favorite, email,
  ).first();
  return rowToRecipe(row);
}

export async function updateRecipe(env, request, id) {
  const body = await readJson(request);
  if (!('favorite' in body)) throw new HttpError(400, 'Nothing to update');
  const row = await env.DB.prepare('UPDATE recipes SET favorite = ? WHERE id = ? RETURNING *')
    .bind(body.favorite ? 1 : 0, id)
    .first();
  if (!row) throw new HttpError(404, 'Recipe not found');
  return rowToRecipe(row);
}

export async function deleteRecipe(env, id) {
  const { meta } = await env.DB.prepare('DELETE FROM recipes WHERE id = ?').bind(id).run();
  if (!meta.changes) throw new HttpError(404, 'Recipe not found');
  return { deleted: id };
}

export async function suggest(env, request) {
  const body = await readJson(request);
  const { results } = await env.DB.prepare('SELECT name, quantity FROM items WHERE quantity > 0 ORDER BY name').all();
  const recipes = await suggestRecipes(env, {
    haveItems: results.map((r) => (r.quantity > 1 ? `${r.name} (${r.quantity})` : r.name)),
    allowShopping: Boolean(body.allowShopping),
    request: body.request,
    count: body.count,
  });
  return { recipes };
}

export async function importFromUrl(env, request) {
  const body = await readJson(request);
  return { recipe: await importRecipe(env, body.url) };
}

// ---------- Shopping list ----------

export async function listShopping(env) {
  const { results } = await env.DB.prepare('SELECT * FROM shopping_items ORDER BY created_at, id').all();
  return results.map((r) => ({ id: r.id, name: r.name, note: r.note, createdBy: r.created_by }));
}

/** Add one or more items; names already on the list are skipped. */
export async function addShopping(env, request, email) {
  const body = await readJson(request);
  const entries = (Array.isArray(body.items) ? body.items : [body])
    .map((i) => ({ name: str(i?.name, 200, 'Name'), note: str(i?.note, 200, 'Note') || null }))
    .filter((i) => i.name);
  if (!entries.length) throw new HttpError(400, 'Name is required');
  if (entries.length > 50) throw new HttpError(400, 'Too many items at once');

  const { results } = await env.DB.prepare('SELECT lower(name) AS n FROM shopping_items').all();
  const existing = new Set(results.map((r) => r.n));
  const added = [];
  for (const e of entries) {
    const key = e.name.toLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);
    const row = await env.DB.prepare(
      'INSERT INTO shopping_items (name, note, created_by) VALUES (?1, ?2, ?3) RETURNING *',
    ).bind(e.name, e.note, email).first();
    added.push({ id: row.id, name: row.name, note: row.note, createdBy: row.created_by });
  }
  return { added, skipped: entries.length - added.length };
}

export async function deleteShopping(env, id) {
  const { meta } = await env.DB.prepare('DELETE FROM shopping_items WHERE id = ?').bind(id).run();
  if (!meta.changes) throw new HttpError(404, 'Item not found');
  return { deleted: id };
}
