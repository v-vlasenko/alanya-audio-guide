'use strict';

import { clearTourDownloaded, loadTourDownloadVersion } from './storage.js';

export const cacheName = (id, version) => `tour-${id}-${version}`;
export const assetUrl = (path) => new URL(path, location.href).href;

export function versionFromTourCacheName(cn, id) {
  const prefix = `tour-${id}-`;
  if (!cn.startsWith(prefix)) return null;
  return cn.slice(prefix.length);
}

export function compareSemver(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function sortTourCacheKeys(keys, id) {
  return keys
    .filter((k) => k.startsWith(`tour-${id}-`))
    .sort((a, b) => compareSemver(
      versionFromTourCacheName(b, id),
      versionFromTourCacheName(a, id),
    ));
}

export async function matchCachedUrl(cache, path) {
  let hit = await cache.match(path);
  if (hit) return hit;
  hit = await cache.match(assetUrl(path));
  if (hit) return hit;
  return cache.match(new Request(path));
}

export async function putCachedUrl(cache, path, res) {
  await cache.put(path, res.clone());
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

export async function readTourJsonFromCaches(id, expectedVersion = null) {
  if (!('caches' in window)) return null;
  const keys = sortTourCacheKeys(await caches.keys(), id);
  for (const cn of keys) {
    const cachedVersion = versionFromTourCacheName(cn, id);
    if (expectedVersion && cachedVersion !== expectedVersion) continue;
    const c = await caches.open(cn);
    for (const req of await c.keys()) {
      if (!req.url.includes('tour.json')) continue;
      const hit = await c.match(req);
      if (!hit?.ok) continue;
      const tour = await hit.json();
      if (expectedVersion && tour.version && tour.version !== expectedVersion) continue;
      return tour;
    }
  }
  return null;
}

export async function findTourDownloadCache(id, tourPath, expectedVersion = null) {
  if (!('caches' in window)) return null;
  const keys = sortTourCacheKeys(await caches.keys(), id);
  for (const cn of keys) {
    if (expectedVersion) {
      const v = versionFromTourCacheName(cn, id);
      if (v !== expectedVersion) continue;
    }
    const c = await caches.open(cn);
    if (await matchCachedUrl(c, tourPath)) return cn;
  }
  return null;
}

/** @returns {'current'|'stale'|'evicted'|'none'} */
export async function tourDownloadState(id, tourPath, expectedVersion) {
  if (await findTourDownloadCache(id, tourPath, expectedVersion)) {
    const tour = await readTourJsonFromCaches(id, expectedVersion);
    if (tour) return 'current';
  }
  const marked = loadTourDownloadVersion(id);
  if (marked) {
    const anyCache = await findTourDownloadCache(id, tourPath);
    if (anyCache || await readTourJsonFromCaches(id)) return 'stale';
    return 'evicted';
  }
  if (await findTourDownloadCache(id, tourPath) || await readTourJsonFromCaches(id)) return 'stale';
  return 'none';
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
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`fetch ${path}`);
    return res.json();
  } catch (err) {
    const retry = await matchGlobalCached(path);
    if (retry?.ok) return retry.json();
    throw err;
  }
}

export async function deleteStaleTourCaches(id, keepCacheName) {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith(`tour-${id}-`) && k !== keepCacheName).map((k) => caches.delete(k)));
}

export async function deleteAllCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
}

export function isCriticalTourAsset(url, tourPath) {
  if (url === tourPath) return true;
  if (url.endsWith('.mp3')) return true;
  if (url.endsWith('tiles/meta.json')) return true;
  if (url.includes('/tiles/') && url.endsWith('.png')) return true;
  return false;
}

export function isOptionalTourAsset(url, coverPath) {
  return url === coverPath;
}

/** Relative byte weight for download progress (file-count skews bar when many tiles). */
export function downloadWeight(url, tourPath, coverPath) {
  if (url.endsWith('.mp3')) return 1000;
  if (url === coverPath || url.endsWith('.jpg') || url.endsWith('.jpeg')) return 300;
  if (url.includes('/tiles/') && url.endsWith('.png')) return 8;
  if (url === tourPath || url.endsWith('.json')) return 2;
  return 10;
}
