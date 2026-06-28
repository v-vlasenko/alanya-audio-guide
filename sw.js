/* Service worker: precache the app shell, serve shell assets network-first (auto-updates
   on deploy), tour assets cache-first (offline downloads). Self-heal refreshes shell cache
   when the app is online. */
'use strict';

const SHELL = 'shell-v38';
const SHELL_ASSETS = [
  './', 'index.html', 'app.css', 'app.js', 'manifest.json',
  'lib/leaflet.js', 'lib/leaflet.css',
  'data/ui-strings-uk.json', 'tours/index.json',
  'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-512-maskable.png', 'icons/apple-touch-icon.png',
];

const precacheShell = async () => {
  const c = await caches.open(SHELL);
  await Promise.all(SHELL_ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
};

self.addEventListener('install', (e) => { e.waitUntil(precacheShell().then(() => self.skipWaiting())); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'heal') e.waitUntil(precacheShell());
  if (e.data?.type === 'skipWaiting') self.skipWaiting();
});

const shellPath = (url) => {
  const p = url.pathname;
  return SHELL_ASSETS.some((a) => {
    const tail = a.replace(/^\.\//, '');
    return p.endsWith('/' + tail) || p.endsWith(tail) || (tail === '' && p.endsWith('/'));
  });
};

const shellCacheKey = (url) => {
  const p = url.pathname;
  if (p.endsWith('/') || p.endsWith('/index.html')) return 'index.html';
  const hit = SHELL_ASSETS.find((a) => {
    const tail = a.replace(/^\.\//, '');
    return tail && (p.endsWith('/' + tail) || p.endsWith(tail));
  });
  return hit?.replace(/^\.\//, '') || null;
};

async function networkFirstShell(req, key) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key || req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(key || req);
    if (hit) return hit;
    throw new Error('offline');
  }
}

async function cacheFirst(req, url) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && shellPath(url)) {
      const key = shellCacheKey(url);
      const c = await caches.open(SHELL);
      c.put(key || req, res.clone());
    }
    return res;
  } catch (err) {
    if (url.pathname.includes('/tiles/') && url.pathname.endsWith('.png')) {
      return new Response(
        Uint8Array.from(atob('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='), (c) => c.charCodeAt(0)),
        { headers: { 'Content-Type': 'image/gif' } }
      );
    }
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(networkFirstShell(req, 'index.html'));
    return;
  }

  if (shellPath(url)) {
    e.respondWith(networkFirstShell(req, shellCacheKey(url)));
    return;
  }

  e.respondWith(cacheFirst(req, url));
});
