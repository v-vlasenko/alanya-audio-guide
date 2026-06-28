/* Service worker: precache the app shell, serve everything cache-first so
   downloaded tours work in airplane mode, and self-heal the shell on launch.
   Tour assets (audio/tiles/tour.json) live in per-tour caches written by the
   page (tour-<id>-<version>); this SW just serves whatever is cached. */
'use strict';

const SHELL = 'shell-v13';
const SHELL_ASSETS = [
  './', 'index.html', 'app.css', 'app.js', 'manifest.json',
  'lib/leaflet.js', 'lib/leaflet.css',
  'data/ui-strings-uk.json', 'tours/index.json',
  'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-512-maskable.png', 'icons/apple-touch-icon.png',
];

const precacheShell = async () => {
  const c = await caches.open(SHELL);
  // add individually so one failure can't abort the whole precache
  await Promise.all(SHELL_ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
};

self.addEventListener('install', (e) => { e.waitUntil(precacheShell().then(() => self.skipWaiting())); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // drop only stale SHELL versions; keep tour-* caches (downloaded tours)
    await Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'heal') e.waitUntil(precacheShell());   // re-cache shell each launch
});

const isShellAsset = (url) =>
  SHELL_ASSETS.some((a) => url.pathname.endsWith(a.replace(/^\.\//, '/')) || url.pathname.endsWith('/' + a));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // tiles/audio are same-origin; leave the rest to network

  // navigations → app shell (works offline, SPA hash routing)
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
    return;
  }

  // everything else: cache-first across all caches, then network (and heal shell)
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && isShellAsset(url)) {
        const c = await caches.open(SHELL);
        c.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // offline + not cached: for tiles, return a transparent pixel so the map degrades gracefully
      if (url.pathname.includes('/tiles/') && url.pathname.endsWith('.png')) {
        return new Response(
          Uint8Array.from(atob('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='), (c) => c.charCodeAt(0)),
          { headers: { 'Content-Type': 'image/gif' } }
        );
      }
      throw err;
    }
  })());
});
