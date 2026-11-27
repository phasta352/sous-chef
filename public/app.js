import { createScanner } from './scanner.js';
import { api, toast, el, store } from './lib.js';
import { initRecipes } from './recipes.js';
import { initShopping } from './shopping.js';

const CATEGORY_LABELS = {
  pantry: 'Pantry',
  fridge: 'Fridge',
  freezer: 'Freezer',
  spices: 'Spices & herbs',
  other: 'Other',
};

const $ = (id) => document.getElementById(id);
const els = {
  user: $('user'),
  list: $('list'),
  error: $('error'),
  search: $('search'),
  chips: document.querySelectorAll('.chip'),
  scanBtn: $('scan-btn'),
  addBtn: $('add-btn'),
  scanner: $('scanner'),
  video: $('video'),
  scanStatus: $('scan-status'),
  scanCancel: $('scan-cancel'),
  typeForm: $('type-form'),
  typeBarcode: $('type-barcode'),
  itemDialog: $('item-dialog'),
  itemForm: $('item-form'),
  itemTitle: $('item-title'),
  itemNote: $('item-note'),
  itemName: $('item-name'),
  itemCategory: $('item-category'),
  itemInStock: $('item-instock'),
  itemBarcode: $('item-barcode'),
  itemDelete: $('item-delete'),
  itemCancel: $('item-cancel'),
  itemSave: $('item-save'),
  knownDialog: $('known-dialog'),
  knownName: $('known-name'),
  knownStatus: $('known-status'),
  knownHave: $('known-have'),
  knownNeed: $('known-need'),
  knownEdit: $('known-edit'),
  knownClose: $('known-close'),
  toast: $('toast'),
};

const state = {
  get items() { return store.items; },
  set items(v) { store.setItems(v); },
  filter: 'all',
  query: '',
  editing: null, // { id?, barcode? }
  known: null,
};

function upsertLocal(item) {
  const i = state.items.findIndex((x) => x.id === item.id);
  if (i >= 0) state.items[i] = item;
  else state.items.push(item);
  store.changed();
}

// ---------- UI helpers ----------

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = !message;
}

// ---------- List ----------

function render() {
  const q = state.query.trim().toLowerCase();
  const visible = state.items.filter((item) => {
    if (state.filter === 'have' && !item.inStock) return false;
    if (state.filter === 'need' && item.inStock) return false;
    return !q || item.name.toLowerCase().includes(q);
  });

  els.list.replaceChildren();

  if (state.items.length === 0) {
    els.list.append(el('div', { className: 'empty' }, [
      el('h2', { textContent: 'Your pantry is empty' }),
      el('p', { className: 'muted', textContent: 'Tap “Scan barcode” and point your camera at something from the cupboard.' }),
    ]));
    return;
  }
  if (visible.length === 0) {
    els.list.append(el('p', { className: 'muted center', textContent: 'Nothing matches.' }));
    return;
  }

  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    const inGroup = visible
      .filter((i) => i.category === key)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (!inGroup.length) continue;

    const ul = el('ul');
    for (const item of inGroup) {
      const nameBtn = el('button', { type: 'button', className: 'item-name', textContent: item.name, title: 'Edit' });
      nameBtn.addEventListener('click', () => openEdit(item));

      const stockBtn = el('button', {
        type: 'button',
        className: `stock ${item.inStock ? 'have' : 'need'}`,
        textContent: item.inStock ? 'Have' : "Don't have",
      });
      stockBtn.setAttribute('aria-pressed', String(item.inStock));
      stockBtn.setAttribute('aria-label', `${item.name}: ${item.inStock ? 'have' : "don't have"}. Tap to change.`);
      stockBtn.addEventListener('click', () => setStock(item, !item.inStock));

      ul.append(el('li', { className: `item ${item.inStock ? 'have' : 'need'}` }, [nameBtn, stockBtn]));
    }
    els.list.append(el('section', { className: 'group' }, [el('h2', { textContent: label }), ul]));
  }
}

async function setStock(item, inStock) {
  const previous = item.inStock;
  item.inStock = inStock; // optimistic
  render();
  try {
    const { item: updated } = await api(`/api/items/${item.id}`, { method: 'PATCH', body: { inStock } });
    upsertLocal(updated);
    render();
    return updated;
  } catch (err) {
    item.inStock = previous;
    render();
    toast(err.message);
    return null;
  }
}

async function loadItems() {
  try {
    const { items } = await api('/api/items');
    state.items = items;
    showError('');
    render();
  } catch (err) {
    showError(err.message);
    els.list.replaceChildren();
  }
}

// ---------- Add / edit dialog ----------

function openItemDialog({ title, note = '', name = '', category = 'pantry', inStock = true, barcode = null, id = null }) {
  state.editing = { id, barcode };
  els.itemTitle.textContent = title;
  els.itemNote.textContent = note;
  els.itemNote.hidden = !note;
  els.itemName.value = name;
  els.itemCategory.value = category;
  els.itemInStock.checked = inStock;
  els.itemBarcode.textContent = barcode ? `Barcode ${barcode} will be remembered for next time.` : '';
  els.itemBarcode.hidden = !barcode;
  els.itemDelete.hidden = !id;
  els.itemSave.disabled = false;
  els.itemDialog.showModal();
  if (!name) setTimeout(() => els.itemName.focus(), 50);
}

function openEdit(item) {
  openItemDialog({
    title: 'Edit item',
    id: item.id,
    name: item.name,
    category: item.category,
    inStock: item.inStock,
    barcode: null,
  });
  if (item.barcode) {
    els.itemBarcode.textContent = `Barcode ${item.barcode}`;
    els.itemBarcode.hidden = false;
  }
}

els.itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    name: els.itemName.value,
    category: els.itemCategory.value,
    inStock: els.itemInStock.checked,
  };
  els.itemSave.disabled = true;
  try {
    const { id, barcode } = state.editing;
    const { item } = id
      ? await api(`/api/items/${id}`, { method: 'PATCH', body })
      : await api('/api/items', { method: 'POST', body: { ...body, barcode } });
    upsertLocal(item);
    render();
    els.itemDialog.close();
    toast(id ? 'Saved' : `Added ${item.name}`);
  } catch (err) {
    toast(err.message);
    els.itemSave.disabled = false;
  }
});

els.itemCancel.addEventListener('click', () => els.itemDialog.close());

els.itemDelete.addEventListener('click', async () => {
  const { id } = state.editing;
  if (!id) return;
  if (els.itemDelete.dataset.confirm !== 'yes') {
    els.itemDelete.dataset.confirm = 'yes';
    els.itemDelete.textContent = 'Tap again to delete';
    return;
  }
  try {
    await api(`/api/items/${id}`, { method: 'DELETE' });
    state.items = state.items.filter((i) => i.id !== id);
    render();
    els.itemDialog.close();
    toast('Deleted');
  } catch (err) {
    toast(err.message);
  }
});

els.itemDialog.addEventListener('close', () => {
  els.itemDelete.dataset.confirm = '';
  els.itemDelete.textContent = 'Delete';
});

els.addBtn.addEventListener('click', () => openItemDialog({ title: 'Add item' }));

// ---------- Known item dialog (scanned something already in the pantry) ----------

function openKnown(item) {
  state.known = item;
  els.knownName.textContent = item.name;
  els.knownStatus.textContent = `${CATEGORY_LABELS[item.category] || 'Pantry'} · currently ${item.inStock ? 'have' : "don't have"}`;
  els.knownDialog.showModal();
}

async function knownSet(inStock) {
  const item = state.items.find((i) => i.id === state.known.id) || state.known;
  els.knownDialog.close();
  const updated = await setStock(item, inStock);
  if (updated) toast(`${updated.name}: ${inStock ? 'have' : "don't have"}`);
}

els.knownHave.addEventListener('click', () => knownSet(true));
els.knownNeed.addEventListener('click', () => knownSet(false));
els.knownClose.addEventListener('click', () => els.knownDialog.close());
els.knownEdit.addEventListener('click', () => {
  els.knownDialog.close();
  openEdit(state.items.find((i) => i.id === state.known.id) || state.known);
});

// ---------- Scanning ----------

const scanner = createScanner(els.video);

function closeScanner() {
  scanner.stop();
  els.scanner.hidden = true;
  els.typeBarcode.value = '';
}

async function handleBarcode(barcode) {
  closeScanner();
  toast('Looking it up…');
  try {
    const result = await api(`/api/lookup/${encodeURIComponent(barcode)}`);
    els.toast.hidden = true;
    if (result.source === 'pantry') {
      upsertLocal(result.item);
      render();
      openKnown(result.item);
    } else if (result.source === 'openfoodfacts') {
      openItemDialog({
        title: 'Add item',
        note: 'Found it. Check the name and save.',
        name: result.suggestion.name,
        category: result.suggestion.category,
        barcode: result.barcode,
      });
    } else {
      openItemDialog({
        title: 'Add item',
        note: result.lookupFailed
          ? "Couldn't reach the product database. Type the name and it'll be remembered."
          : "This barcode isn't in the product database. Type the name and it'll be remembered.",
        barcode: result.barcode,
      });
    }
  } catch (err) {
    toast(err.message);
  }
}

els.scanBtn.addEventListener('click', async () => {
  els.scanner.hidden = false;
  els.scanStatus.textContent = 'Starting camera…';
  try {
    await scanner.start(handleBarcode);
    els.scanStatus.textContent = 'Point the camera at a barcode';
  } catch (err) {
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    els.scanStatus.textContent = denied
      ? 'Camera access was blocked. Allow it in your browser settings, or type the barcode below.'
      : `Camera unavailable: ${err.message || err}. Type the barcode below.`;
  }
});

els.scanCancel.addEventListener('click', closeScanner);

els.typeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = els.typeBarcode.value.replace(/\s+/g, '');
  if (code) handleBarcode(code);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !els.scanner.hidden) closeScanner();
});

// ---------- Search & filter ----------

els.search.addEventListener('input', () => {
  state.query = els.search.value;
  render();
});

els.chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    state.filter = chip.dataset.filter;
    els.chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    render();
  });
});

// ---------- Start ----------

// ---------- Tabs ----------

const shopping = initShopping({ setStock });
const recipes = initRecipes({ onShoppingChanged: () => shopping.load() });
const views = { pantry: null, recipes, shopping };

function showView(name) {
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === name)));
  for (const key of Object.keys(views)) document.getElementById(`view-${key}`).hidden = key !== name;
  document.getElementById('pantry-actions').hidden = name !== 'pantry';
  document.body.classList.toggle('on-pantry', name === 'pantry');
  window.scrollTo(0, 0);
  views[name]?.show();
  try { localStorage.setItem('view', name); } catch { /* ignore */ }
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

async function init() {
  try {
    const me = await api('/api/me');
    els.user.textContent = me.email;
  } catch (err) {
    showError(err.message);
    return;
  }
  await loadItems();
  shopping.load();
  let start = 'pantry';
  try { start = localStorage.getItem('view') || 'pantry'; } catch { /* ignore */ }
  showView(views[start] !== undefined ? start : 'pantry');
}

// Refresh when coming back to the app, so changes from the other phone show up.
window.addEventListener('focus', () => { if (!els.scanner.hidden) return; loadItems(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
