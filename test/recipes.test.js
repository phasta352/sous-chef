import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import worker from '../src/worker.js';
import { deps as aiDeps, findJsonLdRecipe, pageText, validateRecipeUrl } from '../src/ai.js';

let proxy;
let env;
let calls;
let nextOutput;
let pages;

const sampleRecipe = {
  title: 'Tomato rice',
  summary: 'Simple one-pot rice.',
  servings: '2',
  totalTime: '30 min',
  ingredients: [
    { name: 'basmati rice', amount: '150 g', inPantry: true },
    { name: 'tinned tomatoes', amount: '1 can', inPantry: true },
    { name: 'fresh basil', amount: 'a handful', inPantry: false },
  ],
  steps: ['Rinse the rice.', 'Simmer everything for 20 minutes.'],
};

before(async () => {
  proxy = await getPlatformProxy({ persist: false });
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    for (const stmt of sql.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
      await proxy.env.DB.prepare(stmt).run();
    }
  }
  env = { DB: proxy.env.DB, DEV_USER_EMAIL: 'ben@example.com', ANTHROPIC_API_KEY: 'test-key' };
  aiDeps.makeClient = () => ({
    beta: {
      messages: {
        parse: async (params) => {
          calls.push(params);
          return { stop_reason: 'end_turn', parsed_output: nextOutput };
        },
      },
    },
  });
  aiDeps.fetch = async (url) => {
    const page = pages.get(url);
    if (!page) return new Response('nope', { status: 404 });
    return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
});

after(async () => proxy?.dispose());

beforeEach(() => {
  calls = [];
  nextOutput = null;
  pages = new Map();
});

async function call(method, path, body, extraEnv = {}) {
  const res = await worker.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }),
    { ...env, ...extraEnv },
  );
  return { status: res.status, body: await res.json() };
}

test('suggest: sends only in-stock items and respects the shopping toggle', async () => {
  await call('POST', '/api/items', { name: 'Basmati rice', category: 'pantry' });
  await call('POST', '/api/items', { name: 'Tinned tomatoes', category: 'pantry' });
  await call('POST', '/api/items', { name: 'Old yogurt', category: 'fridge', inStock: false });

  nextOutput = { recipes: [sampleRecipe, sampleRecipe, sampleRecipe, sampleRecipe] };
  let r = await call('POST', '/api/recipes/suggest', { allowShopping: false, request: 'something quick', count: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.body.recipes.length, 3);

  const params = calls[0];
  assert.equal(params.model, 'claude-opus-5-5');
  assert.equal(params.fallbacks, 'default');
  assert.ok(params.output_config.format);
  const prompt = params.messages[0].content;
  assert.match(prompt, /Basmati rice/);
  assert.match(prompt, /Tinned tomatoes/);
  assert.doesNotMatch(prompt, /Old yogurt/);
  assert.match(prompt, /ONLY ingredients from the pantry/);
  assert.match(prompt, /something quick/);

  r = await call('POST', '/api/recipes/suggest', { allowShopping: true });
  assert.match(calls[1].messages[0].content, /may include a few ingredients that are not in the pantry/);
});

test('suggest: clear errors without an API key or on refusal', async () => {
  let r = await call('POST', '/api/recipes/suggest', {}, { ANTHROPIC_API_KEY: '' });
  assert.equal(r.status, 503);
  assert.match(r.body.error, /ANTHROPIC_API_KEY/);

  const original = aiDeps.makeClient;
  aiDeps.makeClient = () => ({ beta: { messages: { parse: async () => ({ stop_reason: 'refusal', parsed_output: null }) } } });
  r = await call('POST', '/api/recipes/suggest', {});
  assert.equal(r.status, 422);
  aiDeps.makeClient = original;

  const cfg = await call('GET', '/api/config');
  assert.deepEqual(cfg.body, { aiEnabled: true });
});

test('save, favorite, list, delete recipes', async () => {
  let r = await call('POST', '/api/recipes', { ...sampleRecipe, favorite: false });
  assert.equal(r.status, 201);
  const saved = r.body.recipe;
  assert.equal(saved.source, 'ai');
  assert.deepEqual(saved.ingredients[2], { name: 'fresh basil', amount: 'a handful' });

  r = await call('POST', '/api/recipes', { ...sampleRecipe, title: 'Imported soup', sourceUrl: 'https://example.com/soup' });
  assert.equal(r.body.recipe.source, 'url');

  r = await call('PATCH', `/api/recipes/${saved.id}`, { favorite: true });
  assert.equal(r.body.recipe.favorite, true);

  r = await call('GET', '/api/recipes');
  assert.equal(r.body.recipes[0].title, 'Tomato rice'); // favorites first

  assert.equal((await call('POST', '/api/recipes', { title: 'Empty', ingredients: [], steps: [] })).status, 400);
  assert.equal((await call('DELETE', `/api/recipes/${saved.id}`)).status, 200);
  assert.equal((await call('DELETE', `/api/recipes/${saved.id}`)).status, 404);
});

test('shopping list: add many, skip duplicates, delete', async () => {
  let r = await call('POST', '/api/shopping', { items: [{ name: 'Fresh basil', note: 'for Tomato rice' }, { name: 'Lemons' }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.added.length, 2);

  r = await call('POST', '/api/shopping', { items: [{ name: 'fresh BASIL' }, { name: 'Feta' }] });
  assert.equal(r.body.added.length, 1);
  assert.equal(r.body.skipped, 1);

  r = await call('GET', '/api/shopping');
  assert.deepEqual(r.body.items.map((i) => i.name), ['Fresh basil', 'Lemons', 'Feta']);

  assert.equal((await call('DELETE', `/api/shopping/${r.body.items[0].id}`)).status, 200);
  assert.equal((await call('GET', '/api/shopping')).body.items.length, 2);
});

test('findJsonLdRecipe reads schema.org data, including @graph and sections', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":["Recipe"],"name":"Pancakes &amp; syrup",
     "description":"<p>Fluffy.</p>","recipeYield":["4","4 servings"],"totalTime":"PT1H15M",
     "recipeIngredient":["200 g flour","2 eggs"],
     "recipeInstructions":[{"@type":"HowToSection","itemListElement":[{"@type":"HowToStep","text":"Mix."}]},{"@type":"HowToStep","text":"Fry."}]}]}
  </script></head><body></body></html>`;
  assert.deepEqual(findJsonLdRecipe(html), {
    title: 'Pancakes & syrup',
    summary: 'Fluffy.',
    servings: '4',
    totalTime: '1 h 15 min',
    ingredientLines: ['200 g flour', '2 eggs'],
    steps: ['Mix.', 'Fry.'],
  });
  assert.equal(findJsonLdRecipe('<html>no data</html>'), null);
});

test('pageText strips scripts and markup; URL validation', () => {
  const t = pageText('<script>var x=1</script><h1>Soup</h1><p>Boil &amp; stir</p>');
  assert.match(t, /Soup/);
  assert.match(t, /Boil & stir/);
  assert.doesNotMatch(t, /var x/);
  assert.throws(() => validateRecipeUrl('ftp://x.test/a'));
  assert.throws(() => validateRecipeUrl('http://localhost/a'));
  assert.throws(() => validateRecipeUrl('not a url'));
  assert.equal(validateRecipeUrl('https://example.com/r').hostname, 'example.com');
});

test('import: uses structured data when present, page text otherwise', async () => {
  pages.set('https://food.test/pancakes', `<script type="application/ld+json">{"@type":"Recipe","name":"Pancakes",
    "recipeIngredient":["200 g flour"],"recipeInstructions":"Mix.\\nFry."}</script>`);
  pages.set('https://food.test/stew', `<html><body><h1>Grandma's stew</h1><p>${'Lovely stew story. '.repeat(20)}</p>
    <ul><li>1 kg beef</li><li>3 carrots</li></ul><ol><li>Brown the beef.</li><li>Simmer 2 hours.</li></ol></body></html>`);

  nextOutput = { found: true, recipe: sampleRecipe };
  let r = await call('POST', '/api/recipes/import', { url: 'https://food.test/pancakes' });
  assert.equal(r.status, 200);
  assert.equal(r.body.recipe.sourceUrl, 'https://food.test/pancakes');
  assert.match(calls[0].messages[0].content, /Structured recipe data/);
  assert.match(calls[0].messages[0].content, /200 g flour/);

  r = await call('POST', '/api/recipes/import', { url: 'https://food.test/stew' });
  assert.equal(r.status, 200);
  assert.match(calls[1].messages[0].content, /Page text from/);
  assert.match(calls[1].messages[0].content, /1 kg beef/);

  nextOutput = { found: false, recipe: { ...sampleRecipe, ingredients: [], steps: [] } };
  r = await call('POST', '/api/recipes/import', { url: 'https://food.test/stew' });
  assert.equal(r.status, 422);

  r = await call('POST', '/api/recipes/import', { url: 'https://food.test/missing' });
  assert.equal(r.status, 502);
});
