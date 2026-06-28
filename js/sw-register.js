'use strict';

import { deleteAllCaches } from './cache.js';
import { clearAllTourDownloads } from './storage.js';

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  let pendingReload = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!pendingReload) return;
    pendingReload = false;
    location.reload();
  });

  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;

    const heal = () => navigator.serviceWorker.controller?.postMessage({ type: 'heal' });
    if (navigator.serviceWorker.controller) heal();

    const checkUpdate = () => {
      if (!navigator.onLine) return;
      reg.update().catch(() => {});
    };
    checkUpdate();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkUpdate();
    });

    const activateWaiting = (worker) => {
      if (!worker || !navigator.serviceWorker.controller || !navigator.onLine) return;
      pendingReload = true;
      worker.postMessage({ type: 'skipWaiting' });
    };

    if (reg.waiting) activateWaiting(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') activateWaiting(worker);
      });
    });
  } catch { /* offline / blocked */ }
}

export async function hardRefresh() {
  try {
    await deleteAllCaches();
    clearAllTourDownloads();
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {}
  location.reload(true);
}
