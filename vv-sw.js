/* Velovisie Frame Scan — service worker
 * Scope is limited to vv-scan.html (registered with {scope:'vv-scan.html'}), so it
 * never touches the other portal pages. Strategy: network-first for the app shell
 * (so updates land as soon as the phone is online), cache fallback for offline open.
 * All Odoo / worker API traffic is passed straight through — never cached. */

const CACHE = 'vv-scan-v1';           // bump this string whenever you redeploy vv-scan.html
const SHELL = [
  'vv-scan.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                      // never intercept writes (Odoo RPC POSTs, KV POSTs)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // pass through cross-origin (worker/CDN) to the network
  const isShell = SHELL.some((f) => url.pathname.endsWith('/' + f) || url.pathname.endsWith(f));
  if (!isShell) return;                                   // leave everything else to the browser

  // network-first, fall back to cache
  e.respondWith(
    fetch(req)
      .then((resp) => { const copy = resp.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return resp; })
      .catch(() => caches.match(req).then((r) => r || caches.match('vv-scan.html')))
  );
});
