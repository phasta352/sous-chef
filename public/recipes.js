import { api, toast, el, store, inPantry } from './lib.js';

const $ = (id) => document.getElementById(id);

export function initRecipes({ onShoppingChanged }) {
  const els = {
    aiOff: $('ai-off'),
    suggestForm: $('suggest-form'),
    suggestRequest: $('suggest-request'),
    suggestShopping: $('suggest-shopping'),
    suggestBtn: $('suggest-btn'),
    suggestions: $('suggestions'),
    importForm: $('import-form'),
    importUrl: $('import-url'),
    importBtn: $('import-btn'),
    savedList: $('saved-list'),
    rchips: document.querySelectorAll('.rchip'),
    dialog: $('recipe-dialog'),
    title: $('r-title'),
    fav: $('r-fav'),
    meta: $('r-meta'),
    summary: $('r-summary'),
    source: $('r-source'),
    ingredients: $('r-ingredients'),
    addMissing: $('r-add-missing'),
    steps: $('r-steps'),
    del: $('r-delete'),
    close: $('r-close'),
    save: $('r-save'),
  };

  const state = { saved: [], filter: 'all', current: null, loaded: false };

  // An ingredient counts as "have" if the AI said so (fresh suggestions) or it matches the pantry.
  const has = (ing) => ing.inPantry === true || inPantry(ing.name);
  const missingOf = (recipe) => recipe.ingredients.filter((i) => !has(i));

  function card(recipe, onOpen) {
    const missing = missingOf(recipe).length;
    const tags = el('div', { className: 'tags' }, [
      recipe.totalTime ? el('span', { className: 'tag', textContent: recipe.totalTime }) : null,
      missing
        ? el('span', { className: 'tag need', textContent: `${missing} to buy` })
        : el('span', { className: 'tag', textContent: 'All in pantry' }),
      recipe.source === 'url' || recipe.sourceUrl ? el('span', { className: 'tag', textContent: 'From the web' }) : null,
    ]);
    const btn = el('button', { type: 'button', className: 'recipe-card' }, [
      el('strong', { textContent: `${recipe.favorite ? '★ ' : ''}${recipe.title}` }),
      recipe.summary ? el('span', { className: 'summary', textContent: recipe.summary }) : null,
      tags,
    ]);
    btn.addEventListener('click', onOpen);
    return btn;
  }

  // ---------- Saved recipes ----------

  function renderSaved() {
    const list = state.saved.filter((r) => state.filter === 'all' || r.favorite);
    els.savedList.replaceChildren();
    if (!state.saved.length) {
      els.savedList.append(el('p', { className: 'muted center', textContent: 'No saved recipes yet. Save one from the suggestions or import a link.' }));
      return;
    }
    if (!list.length) {
      els.savedList.append(el('p', { className: 'muted center', textContent: 'No favorites yet. Tap the star on a recipe.' }));
      return;
    }
    els.savedList.append(el('div', { className: 'recipe-cards' }, list.map((r) => card(r, () => open(r)))));
  }

  async function loadSaved() {
    try {
      const { recipes } = await api('/api/recipes');
      state.saved = recipes;
      state.loaded = true;
      renderSaved();
    } catch (err) {
      els.savedList.replaceChildren(el('p', { className: 'banner error', textContent: err.message }));
    }
  }

  els.rchips.forEach((chip) => chip.addEventListener('click', () => {
    state.filter = chip.dataset.rfilter;
    els.rchips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    renderSaved();
  }));

  // ---------- Recipe dialog ----------

  function renderDialog() {
    const r = state.current;
    const saved = Boolean(r.id);
    els.title.textContent = r.title;
    els.meta.textContent = [r.totalTime, r.servings ? `Serves ${r.servings}` : ''].filter(Boolean).join(' · ');
    els.summary.textContent = r.summary || '';
    els.summary.hidden = !r.summary;
    els.source.hidden = !r.sourceUrl;
    if (r.sourceUrl) els.source.href = r.sourceUrl;

    els.ingredients.replaceChildren(...r.ingredients.map((ing) => {
      const ok = has(ing);
      return el('li', { className: ok ? '' : 'missing' }, [
        el('span', { className: 'mark', textContent: ok ? '✓' : '+', title: ok ? 'In your pantry' : 'Need to buy' }),
        el('span', {}, [
          el('span', { className: 'ing-name', textContent: ing.name }),
          ing.amount ? el('span', { className: 'amount', textContent: ` · ${ing.amount}` }) : null,
        ]),
      ]);
    }));

    const missing = missingOf(r);
    els.addMissing.hidden = !missing.length;
    els.addMissing.textContent = `Add ${missing.length} missing to shopping list`;
    els.addMissing.disabled = false;

    els.steps.replaceChildren(...r.steps.map((s) => el('li', { textContent: s })));

    els.fav.hidden = !saved;
    els.fav.textContent = r.favorite ? '★' : '☆';
    els.fav.setAttribute('aria-pressed', String(Boolean(r.favorite)));
    els.del.hidden = !saved;
    els.del.textContent = 'Delete';
    els.del.dataset.confirm = '';
    els.save.hidden = saved;
    els.save.disabled = false;
  }

  function open(recipe) {
    state.current = recipe;
    renderDialog();
    els.dialog.showModal();
    els.dialog.scrollTop = 0;
  }

  els.close.addEventListener('click', () => els.dialog.close());

  els.save.addEventListener('click', async () => {
    els.save.disabled = true;
    try {
      const { recipe } = await api('/api/recipes', { method: 'POST', body: state.current });
      // Keep the AI's pantry marks for this session.
      recipe.ingredients = state.current.ingredients.map((i) => ({ ...i }));
      state.saved.unshift(recipe);
      state.current = recipe;
      renderSaved();
      renderDialog();
      toast('Saved. Tap ☆ to make it a favorite.');
    } catch (err) {
      toast(err.message);
      els.save.disabled = false;
    }
  });

  els.fav.addEventListener('click', async () => {
    const r = state.current;
    try {
      const { recipe } = await api(`/api/recipes/${r.id}`, { method: 'PATCH', body: { favorite: !r.favorite } });
      r.favorite = recipe.favorite;
      const i = state.saved.findIndex((x) => x.id === r.id);
      if (i >= 0) state.saved[i].favorite = recipe.favorite;
      renderDialog();
      renderSaved();
    } catch (err) {
      toast(err.message);
    }
  });

  els.del.addEventListener('click', async () => {
    if (els.del.dataset.confirm !== 'yes') {
      els.del.dataset.confirm = 'yes';
      els.del.textContent = 'Tap again to delete';
      return;
    }
    const r = state.current;
    try {
      await api(`/api/recipes/${r.id}`, { method: 'DELETE' });
      state.saved = state.saved.filter((x) => x.id !== r.id);
      renderSaved();
      els.dialog.close();
      toast('Recipe deleted');
    } catch (err) {
      toast(err.message);
    }
  });

  els.addMissing.addEventListener('click', async () => {
    const r = state.current;
    const missing = missingOf(r);
    els.addMissing.disabled = true;
    try {
      const { added, skipped } = await api('/api/shopping', {
        method: 'POST',
        body: { items: missing.map((i) => ({ name: i.name, note: `for ${r.title}` })) },
      });
      onShoppingChanged();
      toast(added.length ? `Added ${added.length} to the shopping list${skipped ? ` (${skipped} already there)` : ''}` : 'Already on the shopping list');
    } catch (err) {
      toast(err.message);
      els.addMissing.disabled = false;
    }
  });

  // ---------- Suggestions ----------

  function loading(text) {
    return el('div', { className: 'loading' }, [el('span', { className: 'spinner' }), el('span', { textContent: text })]);
  }

  els.suggestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!store.items.some((i) => i.inStock)) {
      toast('Mark some pantry items as "have" first.');
      return;
    }
    els.suggestBtn.disabled = true;
    els.suggestions.replaceChildren(loading('Thinking up recipes… this can take 20–30 seconds'));
    try {
      const { recipes } = await api('/api/recipes/suggest', {
        method: 'POST',
        body: { request: els.suggestRequest.value, allowShopping: els.suggestShopping.checked, count: 3 },
      });
      els.suggestions.replaceChildren(
        el('div', { className: 'section-head' }, [el('h2', { textContent: 'Ideas for you' })]),
        el('div', { className: 'recipe-cards' }, recipes.map((r) => card(r, () => open({ ...r, source: 'ai' })))),
      );
    } catch (err) {
      els.suggestions.replaceChildren(el('p', { className: 'banner error', textContent: err.message }));
    } finally {
      els.suggestBtn.disabled = false;
    }
  });

  // ---------- Import ----------

  els.importForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.importBtn.disabled = true;
    els.suggestions.replaceChildren(loading('Reading the recipe…'));
    try {
      const { recipe } = await api('/api/recipes/import', { method: 'POST', body: { url: els.importUrl.value } });
      els.suggestions.replaceChildren();
      els.importUrl.value = '';
      open({ ...recipe, source: 'url', ingredients: recipe.ingredients.map(({ inPantry: _, ...rest }) => rest) });
    } catch (err) {
      els.suggestions.replaceChildren(el('p', { className: 'banner error', textContent: err.message }));
    } finally {
      els.importBtn.disabled = false;
    }
  });

  // Re-mark ingredients when the pantry changes.
  store.onChange(() => {
    if (state.loaded) renderSaved();
    if (els.dialog.open && state.current) renderDialog();
  });

  return {
    async show() {
      if (!state.loaded) await loadSaved();
      try {
        const { aiEnabled } = await api('/api/config');
        els.aiOff.hidden = aiEnabled;
        els.suggestBtn.disabled = !aiEnabled;
        els.importBtn.disabled = !aiEnabled;
      } catch { /* ignore */ }
    },
  };
}
