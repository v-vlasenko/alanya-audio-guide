'use strict';

import { lon2x, lat2y } from './geo.js';
import {
  matchCachedUrl, readTourJsonFromCaches, findTourDownloadCache,
} from './cache.js';

export let INDEX = null;
export const tourCache = new Map();

export function initCatalog(index) { INDEX = index; }

export function orderedCheckpoints(tour) {
  return tour.checkpoints.slice().sort((a, b) => a.order - b.order);
}

export function audioCheckpointCount(tour) {
  return tour?.checkpoints?.filter((c) => c.audio).length ?? 0;
}

export function tourCheckpointTotal(tr, activeTour) {
  if (activeTour?.id === tr.id) return activeTour.checkpoints.length;
  return tr.checkpointCount || 0;
}

export function isTourFullyCompleted(id, total, completedSet) {
  if (!total) return false;
  return completedSet.size >= total;
}

export async function loadTour(id) {
  const tr = INDEX.tours.find((x) => x.id === id);
  if (!tr) throw new Error(`unknown tour ${id}`);
  const cacheKey = `${id}@${tr.version}`;
  if (tourCache.has(cacheKey)) return tourCache.get(cacheKey);

  let tour = await readTourJsonFromCaches(id, tr.version);
  if (tour) {
    tourCache.set(cacheKey, tour);
    return tour;
  }

  const cn = await findTourDownloadCache(id, tr.path, tr.version);
  if (cn) {
    const hit = await matchCachedUrl(await caches.open(cn), tr.path);
    if (hit?.ok) {
      tour = await hit.json();
      if (!tour.version || tour.version === tr.version) {
        tourCache.set(cacheKey, tour);
        return tour;
      }
    }
  }

  try {
    const res = await fetch(tr.path, { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed');
    tour = await res.json();
    tourCache.set(cacheKey, tour);
    return tour;
  } catch {
    throw new Error('offline');
  }
}

export async function tourAssetUrls(tr, loadTourFn) {
  const tour = await loadTourFn(tr.id);
  const base = tour.basePath;
  const urls = [tr.path, tr.cover];
  tour.checkpoints.forEach((c) => { if (c.audio) urls.push(base + c.audio); });
  try {
    const meta = await fetch(`${base}tiles/meta.json`).then((r) => r.json());
    const { bbox, zoomMin, zoomMax } = meta;
    for (let z = zoomMin; z <= zoomMax; z++) {
      const x0 = lon2x(bbox.w, z), x1 = lon2x(bbox.e, z);
      const y0 = lat2y(bbox.n, z), y1 = lat2y(bbox.s, z);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) urls.push(`${base}tiles/${z}/${x}/${y}.png`);
    }
    urls.push(`${base}tiles/meta.json`);
  } catch { /* no tiles yet */ }
  return [...new Set(urls)];
}

export function getTourMeta(id) {
  return INDEX.tours.find((x) => x.id === id);
}

export function getCachedTour(id) {
  const meta = getTourMeta(id);
  if (!meta) return null;
  return tourCache.get(`${id}@${meta.version}`) || null;
}
