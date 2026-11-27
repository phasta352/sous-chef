// Shared helpers for the app's views.

export async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401) throw new Error('Your sign-in expired. Reload the page to sign in again.');
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

let toastTimer;
export function toast(message, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) if (child != null) node.append(child);
  return node;
}

// Shared app state, so views can see the pantry.
export const store = {
  items: [],
  listeners: new Set(),
  setItems(items) {
    this.items = items;
    this.listeners.forEach((fn) => fn());
  },
  changed() {
    this.listeners.forEach((fn) => fn());
  },
  onChange(fn) {
    this.listeners.add(fn);
  },
};

// ---------- Matching recipe ingredients to the pantry ----------

const BASICS = ['salt', 'pepper', 'black pepper', 'water', 'oil', 'olive oil', 'vegetable oil', 'cooking oil', 'sunflower oil'];
const STOP = new Set(['fresh', 'dried', 'ground', 'chopped', 'large', 'small', 'medium', 'of', 'and', 'or', 'to', 'taste', 'a', 'the', 'tin', 'tinned', 'can', 'canned', 'whole', 'free', 'range', 'organic']);

function words(s) {
  return String(s).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-zà-ÿ\s-]/g, ' ')
    .split(/[\s-]+/).map((w) => w.replace(/(es|s)$/, '')).filter((w) => w.length > 2 && !STOP.has(w));
}

/** True if an in-stock pantry item looks like this ingredient. */
export function inPantry(ingredientName, items = store.items) {
  const name = String(ingredientName).toLowerCase().trim();
  if (BASICS.includes(name)) return true;
  const ing = words(name);
  if (!ing.length) return false;
  return items.some((item) => {
    if (!item.inStock) return false;
    const w = words(item.name);
    return ing.some((x) => w.includes(x));
  });
}
