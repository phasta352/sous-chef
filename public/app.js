const statusEl = document.getElementById('status');
const userEl = document.getElementById('user');

async function getJson(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

async function init() {
  try {
    const [me, health] = await Promise.all([getJson('/api/me'), getJson('/api/health')]);
    userEl.textContent = me.email;
    statusEl.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = 'Connected';
    const p = document.createElement('p');
    p.textContent = `Signed in as ${me.email}. ${health.items} item(s) in the database.`;
    statusEl.append(h, p);
  } catch (err) {
    statusEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = `Could not reach the server: ${err.message}`;
    statusEl.append(p);
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
