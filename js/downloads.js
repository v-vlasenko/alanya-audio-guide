'use strict';

import { state } from './state.js';
import { cacheName } from './cache.js';

export function isDownloading(id) {
  return state.activeDownloads.has(id);
}

export function getDownloadProgress(id) {
  return state.activeDownloads.get(id)?.progress ?? 0;
}

export function beginDownload(id, version) {
  const existing = state.activeDownloads.get(id);
  if (existing) {
    existing.abort.abort();
    caches.delete(existing.cacheName).catch(() => {});
  }
  const abort = new AbortController();
  const entry = { abort, version, cacheName: cacheName(id, version), progress: 0 };
  state.activeDownloads.set(id, entry);
  return entry;
}

export function setDownloadProgress(id, progress) {
  const entry = state.activeDownloads.get(id);
  if (entry) entry.progress = progress;
}

export function endDownload(id) {
  state.activeDownloads.delete(id);
}

export function cancelActiveDownloads() {
  for (const [, dl] of state.activeDownloads) {
    dl.abort.abort();
    caches.delete(dl.cacheName).catch(() => {});
  }
  state.activeDownloads.clear();
}
