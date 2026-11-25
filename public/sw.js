// Minimal service worker so phones offer "Install app" / "Add to Home Screen".
// It deliberately does not cache anything: the pantry list should always be live.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
