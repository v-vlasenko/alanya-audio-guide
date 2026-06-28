'use strict';

import { clearTourDownloaded } from './storage.js';

export const cacheName = (id, version) => `tour-${id}-${version}`;
export const assetUrl = (path) => new URL(path, location.href).href;

export async function matchCachedUrl(cache, path) {
  let hit = await cache.match(path);
  if (hit) return hit;
  hit = await cache.match(assetUrl(path));
  if (hit) return hit;
  return cache.match(new Request(path));
}

export async function putCachedUrl(cache, path, res) {
  await cache.put(path, res.clone());
  try { await cache.put(assetUrl(path), res.clone()); } catch { /* quota */ }
}

export async function matchGlobalCached(path) {
  if (!('caches' in window)) return null;
  for (const key of [path, assetUrl(path)]) {
    const hit = await caches.match(key);
    if (hit) return hit;
  }
  const hit = await caches.match(new Request(path));
  if (hit) return hit;
  const keys = await caches.keys();
  for (const cn of keys) {
    const found = await matchCachedUrl(await caches.open(cn), path);
    if (found) return found;
  }
  return null;
}

export async function readTourJsonFromCaches(id) {
  if (!('caches' in window)) return null;
  const keys = (await caches.keys()).filter((k) => k.startsWith(`tour-${id}-`));
  for (const cn of keys) {
    const c = await caches.open(cn);
    for (const req of await c.keys()) {
      if (!req.url.includes('tour.json')) continue;
      const hit = await c.match(req);
      if (hit?.ok) return hit.json();
    }
  }
  return null;
}

export async function findTourDownloadCache(id, tourPath) {
  if (!('caches' in window)) return null;
  const keys = await caches.keys();
  const matches = keys.filter((k) => k.startsWith(`tour-${id}-`)).sort().reverse();
  for (const cn of matches) {
    const c = await caches.open(cn);
    if (await matchCachedUrl(c, tourPath)) return cn;
  }
  return null;
}

export async function deleteTourDownload(id) {
  clearTourDownloaded(id);
  if (!('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith(`tour-${id}-`)).map((k) => caches.delete(k)));
}

export async function fetchJsonCached(path) {
  const hit = await matchGlobalCached(path);
  if (hit?.ok) return hit.json();
  if (!navigator.onLine) throw new Error('offline');
  const res = await fetch(path);
  if (!res.ok) throw new Error(`fetch ${path}`);
  return res.json();
}

export async function deleteStaleTourCaches(id, keepCacheName) {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith(`tour-${id}-`) && k !== keepCacheName).map((k) => caches.delete(k)));
}

export async function deleteAllCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
}
