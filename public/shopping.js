import { api, toast, el, store } from './lib.js';

const $ = (id) => document.getElementById(id);

export function initShopping({ setStock }) {
  const els = { form: $('shop-form'), name: $('shop-name'), list: $('shop-list'), count: $('shop-count') };
  const state = { items: [], loaded: false };

  function updateCount() {
    const n = state.items.length + store.items.filter((i) => !i.inStock).length;
    els.count.textContent = String(n);
    els.count.hidden = n === 0;
  }

  function row({ name, meta, onDone, doneLabel }) {
    const check = el('button', { type: 'button', className: 'check', title: doneLabel });
    check.setAttribute('aria-label', `${doneLabel}: ${name}`);
    check.addEventListener('click', onDone);
    return el('li', { className: 'item' }, [
      check,
      el('div', { className: 'item-main' }, [
        el('span', { className: 'item-name', textContent: name }),
        meta ? el('span', { className: 'meta', textContent: meta }) : null,
      ]),
    ]);
  }

  function render() {
    updateCount();
    if (!state.loaded) return;
    const pantryNeeds = store.items
      .filter((i) => !i.inStock)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    els.list.replaceChildren();

    if (!state.items.length && !pantryNeeds.length) {
      els.list.append(el('div', { className: 'empty' }, [
        el('h2', { textContent: 'Nothing to buy' }),
        el('p', { className: 'muted', textContent: "Items you mark as \"don't have\" and missing recipe ingredients show up here." }),
      ]));
      return;
    }

    if (state.items.length) {
      els.list.append(el('section', { className: 'group' }, [
        el('h2', { textContent: 'To buy' }),
        el('ul', {}, state.items.map((item) => row({
          name: item.name,
          meta: item.note,
          doneLabel: 'Bought',
          onDone: () => removeItem(item),
        }))),
      ]));
    }

    if (pantryNeeds.length) {
      els.list.append(el('section', { className: 'group' }, [
        el('h2', { textContent: "Pantry items you don't have" }),
        el('ul', {}, pantryNeeds.map((item) => row({
          name: item.name,
          meta: 'Tick when bought to mark it as "have"',
          doneLabel: 'Bought',
          onDone: async () => {
            const updated = await setStock(item, true);
            if (updated) toast(`${updated.name}: have`);
          },
        }))),
      ]));
    }
  }

  async function load() {
    try {
      const { items } = await api('/api/shopping');
      state.items = items;
      state.loaded = true;
      render();
    } catch (err) {
      els.list.replaceChildren(el('p', { className: 'banner error', textContent: err.message }));
    }
  }

  async function removeItem(item) {
    state.items = state.items.filter((i) => i.id !== item.id);
    render();
    try {
      await api(`/api/shopping/${item.id}`, { method: 'DELETE' });
    } catch (err) {
      toast(err.message);
      await load();
    }
  }

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = els.name.value.trim();
    if (!name) return;
    try {
      const { added } = await api('/api/shopping', { method: 'POST', body: { name } });
      els.name.value = '';
      if (added.length) state.items.push(...added);
      else toast('Already on the list');
      render();
    } catch (err) {
      toast(err.message);
    }
  });

  store.onChange(render);

  return { load, show: load };
}
