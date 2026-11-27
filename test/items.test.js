import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import worker from '../src/worker.js';
import { deps, guessCategory, parseOpenFoodFacts } from '../src/items.js';

let proxy;
let env;
const offResponses = new Map();

before(async () => {
  proxy = await getPlatformProxy({ persist: false });
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    for (const stmt of sql.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
      await proxy.env.DB.prepare(stmt).run();
    }
  }
  env = { DB: proxy.env.DB, DEV_USER_EMAIL: 'ben@example.com' };
  deps.fetch = async (url) => {
    const code = url.match(/product\/([^.]+)\.json/)[1];
    const r = offResponses.get(code);
    if (r === 'error') throw new Error('network down');
    return new Response(JSON.stringify(r ?? { status: 0 }), { status: r ? 200 : 404 });
  };
});

after(async () => proxy?.dispose());

async function call(method, path, body) {
  const res = await worker.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
  return { status: res.status, body: await res.json() };
}

test('guessCategory maps Open Food Facts tags', () => {
  assert.equal(guessCategory(['en:dairies', 'en:cheeses']), 'fridge');
  assert.equal(guessCategory(['en:frozen-foods']), 'freezer');
  assert.equal(guessCategory(['en:condiments', 'en:spices']), 'spices');
  assert.equal(guessCategory(['en:pastas']), 'pantry');
  assert.equal(guessCategory([]), 'pantry');
});

test('parseOpenFoodFacts builds a name with brand, or returns null', () => {
  assert.deepEqual(
    parseOpenFoodFacts({ status: 1, product: { product_name: 'Spaghetti', brands: 'Barilla, Other', categories_tags: ['en:pastas'] } }),
    { name: 'Spaghetti (Barilla)', category: 'pantry' },
  );
  assert.deepEqual(
    parseOpenFoodFacts({ status: 1, product: { product_name: 'Nutella', brands: 'Nutella' } }),
    { name: 'Nutella', category: 'pantry' },
  );
  assert.equal(parseOpenFoodFacts({ status: 0 }), null);
  assert.equal(parseOpenFoodFacts({ status: 1, product: { brands: 'X' } }), null);
});

test('lookup: Open Food Facts hit, miss, and network failure', async () => {
  offResponses.set('8076800195057', { status: 1, product: { product_name: 'Penne', brands: 'Barilla', categories_tags: ['en:pastas'] } });
  offResponses.set('1111111111111', 'error');

  let r = await call('GET', '/api/lookup/8076800195057');
  assert.equal(r.body.source, 'openfoodfacts');
  assert.deepEqual(r.body.suggestion, { name: 'Penne (Barilla)', category: 'pantry' });

  r = await call('GET', '/api/lookup/4006381333931');
  assert.deepEqual(r.body, { barcode: '4006381333931', source: 'none', lookupFailed: false });

  r = await call('GET', '/api/lookup/1111111111111');
  assert.equal(r.body.lookupFailed, true);

  r = await call('GET', '/api/lookup/not%20a%20barcode!');
  assert.equal(r.status, 400);
});

test('create, remember barcode, toggle, edit, delete', async () => {
  // Manual entry after a failed lookup: barcode is remembered.
  let r = await call('POST', '/api/items', { barcode: '4006381333931', name: '  Smoked   paprika ', category: 'spices' });
  assert.equal(r.status, 201);
  const paprika = r.body.item;
  assert.equal(paprika.name, 'Smoked paprika');
  assert.equal(paprika.inStock, true);
  assert.equal(paprika.updatedBy, 'ben@example.com');

  // Scanning the same barcode again finds it in the pantry, no network needed.
  r = await call('GET', '/api/lookup/4006381333931');
  assert.equal(r.body.source, 'pantry');
  assert.equal(r.body.item.id, paprika.id);

  // Item without a barcode.
  r = await call('POST', '/api/items', { name: 'Eggs', category: 'fridge' });
  const eggs = r.body.item;
  assert.equal(eggs.barcode, null);

  // Posting an existing barcode updates instead of duplicating.
  r = await call('POST', '/api/items', { barcode: '4006381333931', name: 'Smoked paprika', category: 'spices', inStock: false });
  assert.equal(r.body.item.id, paprika.id);
  assert.equal(r.body.item.inStock, false);

  r = await call('PATCH', `/api/items/${eggs.id}`, { inStock: false });
  assert.equal(r.body.item.inStock, false);
  r = await call('PATCH', `/api/items/${eggs.id}`, { name: 'Free-range eggs', category: 'fridge' });
  assert.equal(r.body.item.name, 'Free-range eggs');

  r = await call('GET', '/api/items');
  assert.deepEqual(r.body.items.map((i) => i.name), ['Free-range eggs', 'Smoked paprika']);

  r = await call('DELETE', `/api/items/${eggs.id}`);
  assert.equal(r.status, 200);
  r = await call('DELETE', `/api/items/${eggs.id}`);
  assert.equal(r.status, 404);
});

test('quantities: default 1, explicit, +/- via PATCH, 0 means don\'t have', async () => {
  let r = await call('POST', '/api/items', { name: 'Tinned tomatoes', quantity: 4 });
  const tins = r.body.item;
  assert.equal(tins.quantity, 4);
  assert.equal(tins.inStock, true);

  r = await call('POST', '/api/items', { name: 'Flour' });
  assert.equal(r.body.item.quantity, 1);

  r = await call('POST', '/api/items', { name: 'Milk', inStock: false });
  assert.equal(r.body.item.quantity, 0);
  assert.equal(r.body.item.inStock, false);
  const milk = r.body.item;

  r = await call('PATCH', `/api/items/${tins.id}`, { quantity: 0 });
  assert.equal(r.body.item.inStock, false);
  r = await call('PATCH', `/api/items/${tins.id}`, { inStock: true });
  assert.equal(r.body.item.quantity, 1);
  r = await call('PATCH', `/api/items/${tins.id}`, { quantity: 3 });
  r = await call('PATCH', `/api/items/${tins.id}`, { inStock: true });
  assert.equal(r.body.item.quantity, 3, 'marking have keeps an existing count');
  r = await call('PATCH', `/api/items/${tins.id}`, { inStock: false });
  assert.equal(r.body.item.quantity, 0);

  r = await call('PATCH', `/api/items/${milk.id}`, { quantity: 2, name: 'Whole milk' });
  assert.equal(r.body.item.quantity, 2);
  assert.equal(r.body.item.name, 'Whole milk');

  assert.equal((await call('PATCH', `/api/items/${milk.id}`, { quantity: -1 })).status, 400);
  assert.equal((await call('PATCH', `/api/items/${milk.id}`, { quantity: 1.5 })).status, 400);
  assert.equal((await call('POST', '/api/items', { name: 'X', quantity: 5000 })).status, 400);
});

test('validation errors', async () => {
  assert.equal((await call('POST', '/api/items', { name: '' })).status, 400);
  assert.equal((await call('POST', '/api/items', { name: 'X', category: 'garage' })).status, 400);
  assert.equal((await call('PATCH', '/api/items/99999', { inStock: true })).status, 404);
  assert.equal((await call('PATCH', '/api/items/1', {})).status, 400);
});
