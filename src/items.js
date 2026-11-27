// Pantry item API: list, add, update, delete, and barcode lookup.

export const CATEGORIES = ['pantry', 'fridge', 'freezer', 'spices', 'other'];

// Swappable in tests.
export const deps = {
  fetch: (...args) => fetch(...args),
};

const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const OFF_FIELDS = 'product_name,product_name_en,product_name_fr,product_name_de,generic_name,brands,categories_tags';
// Open Food Facts asks API users to identify their app with a User-Agent.
const OFF_USER_AGENT = 'SousChef/0.2 (personal household pantry app)';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function normalizeBarcode(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/\s+/g, '');
  if (digits === '') return null;
  if (!/^[0-9A-Za-z\-]{4,64}$/.test(digits)) throw new HttpError(400, 'That barcode looks invalid');
  return digits;
}

function cleanName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new HttpError(400, 'Name is required');
  if (name.length > 120) throw new HttpError(400, 'Name is too long (120 characters max)');
  return name;
}

function cleanCategory(raw) {
  const category = String(raw ?? 'pantry').toLowerCase();
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Unknown category');
  return category;
}

/** Guess one of our categories from Open Food Facts category tags. */
export function guessCategory(tags = []) {
  const t = tags.join(' ');
  if (/frozen|ice-creams/.test(t)) return 'freezer';
  if (/spices|herbs|condiments|seasonings|salts|peppers/.test(t)) return 'spices';
  if (/dairies|dairy|cheeses|yogurts|milks|butters|meats|fishes|seafood|eggs|fresh|refrigerated|hams|sausages|creams/.test(t)) return 'fridge';
  return 'pantry';
}

/** Turn an Open Food Facts API response into a suggestion, or null if not found. */
export function parseOpenFoodFacts(data) {
  if (!data || data.status !== 1 || !data.product) return null;
  const p = data.product;
  const baseName = [p.product_name, p.product_name_en, p.product_name_fr, p.product_name_de, p.generic_name]
    .map((s) => (s || '').trim())
    .find(Boolean);
  if (!baseName) return null;
  const brand = (p.brands || '').split(',')[0].trim();
  const name = brand && !baseName.toLowerCase().includes(brand.toLowerCase()) ? `${baseName} (${brand})` : baseName;
  return { name: name.slice(0, 120), category: guessCategory(p.categories_tags || []) };
}

async function lookupOpenFoodFacts(barcode) {
  try {
    const res = await deps.fetch(`${OFF_URL}${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`, {
      headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 404) return null;
    if (!res.ok) return { error: true };
    return parseOpenFoodFacts(await res.json());
  } catch {
    return { error: true };
  }
}

function rowToItem(row) {
  return {
    id: row.id,
    barcode: row.barcode,
    name: row.name,
    category: row.category,
    inStock: row.in_stock === 1,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

async function getItem(db, id) {
  const row = await db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Item not found');
  return rowToItem(row);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Expected a JSON body');
  }
}

export async function listItems(env) {
  const { results } = await env.DB.prepare('SELECT * FROM items ORDER BY category, name COLLATE NOCASE').all();
  return results.map(rowToItem);
}

/**
 * Look up a scanned barcode. Checks our own pantry first (so remembered
 * items are instant), then Open Food Facts.
 */
export async function lookupBarcode(env, rawBarcode) {
  const barcode = normalizeBarcode(rawBarcode);
  if (!barcode) throw new HttpError(400, 'Barcode is required');

  const row = await env.DB.prepare('SELECT * FROM items WHERE barcode = ?').bind(barcode).first();
  if (row) return { barcode, source: 'pantry', item: rowToItem(row) };

  const off = await lookupOpenFoodFacts(barcode);
  if (off && !off.error) return { barcode, source: 'openfoodfacts', suggestion: off };
  return { barcode, source: 'none', lookupFailed: Boolean(off?.error) };
}

export async function createItem(env, request, email) {
  const body = await readJson(request);
  const barcode = normalizeBarcode(body.barcode);
  const name = cleanName(body.name);
  const category = cleanCategory(body.category);
  const inStock = body.inStock === false ? 0 : 1;

  if (barcode) {
    // Same barcode scanned again: update the existing item instead of duplicating it.
    const row = await env.DB.prepare(
      `INSERT INTO items (barcode, name, category, in_stock, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (barcode) DO UPDATE SET
         name = excluded.name, category = excluded.category, in_stock = excluded.in_stock,
         updated_by = excluded.updated_by, updated_at = datetime('now')
       RETURNING *`,
    ).bind(barcode, name, category, inStock, email).first();
    return rowToItem(row);
  }

  const row = await env.DB.prepare(
    'INSERT INTO items (name, category, in_stock, updated_by) VALUES (?1, ?2, ?3, ?4) RETURNING *',
  ).bind(name, category, inStock, email).first();
  return rowToItem(row);
}

export async function updateItem(env, request, id, email) {
  const body = await readJson(request);
  const sets = [];
  const values = [];
  if ('name' in body) { sets.push('name = ?'); values.push(cleanName(body.name)); }
  if ('category' in body) { sets.push('category = ?'); values.push(cleanCategory(body.category)); }
  if ('inStock' in body) { sets.push('in_stock = ?'); values.push(body.inStock ? 1 : 0); }
  if (sets.length === 0) throw new HttpError(400, 'Nothing to update');
  sets.push("updated_at = datetime('now')", 'updated_by = ?');
  values.push(email, id);

  const row = await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
    .bind(...values)
    .first();
  if (!row) throw new HttpError(404, 'Item not found');
  return rowToItem(row);
}

export async function deleteItem(env, id) {
  await getItem(env.DB, id);
  await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
  return { deleted: id };
}
