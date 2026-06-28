'use strict';

import { $, el, esc, app } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';
import {
  INDEX, loadTour, tourAssetUrls, tourCheckpointTotal, isTourFullyCompleted,
} from './catalog.js';
import {
  cacheName, putCachedUrl, deleteTourDownload, deleteStaleTourCaches,
  tourDownloadState, isCriticalTourAsset, isOptionalTourAsset, downloadWeight,
} from './cache.js';
import { markTourDownloaded, loadCompleted, clearTourDownloaded } from './storage.js';
import { isPlayerOpen } from './player.js';
import { showInstallSheet } from './install.js';
import { hardRefresh, tryActivateDeferredSw } from './sw-register.js';
import {
  beginDownload, endDownload, getDownloadProgress, isDownloading, setDownloadProgress,
} from './downloads.js';

function isTourFullyCompletedForCard(id, total) {
  return isTourFullyCompleted(id, total, loadCompleted(id));
}

function tourCard(tr) {
  const total = tourCheckpointTotal(tr, state.activeTour);
  const full = isTourFullyCompletedForCard(tr.id, total);
  const card = el(`
    <article class="tour-card${full ? ' is-complete' : ''}">
      <div class="cover-wrap">
        <div class="cover"></div>
      </div>
      <div class="tour-body">
        <h2>${esc(tr.title)}</h2>
        <p class="muted">${esc(tr.subtitle || '')}</p>
        ${full ? `<p class="tour-done-badge">${esc(t('tourFullyCompleted'))}</p>` : ''}
        ${tr.bestTime ? `<p class="best-time">⏰ ${esc(tr.bestTime)}</p>` : ''}
        <div class="meta-row">
          <span>${esc(t('tourCheckpointsLabel'))}: <b>${tr.checkpointCount}</b></span>
        </div>
        <div class="card-actions">
          <button class="btn secondary dl">${esc(t('downloadTour'))}</button>
        </div>
        <div class="dl-state muted"></div>
      </div>
    </article>`);

  const img = new Image();
  img.src = `${tr.cover}`;
  img.alt = tr.title;
  img.onload = () => { $('.cover', card).replaceWith(img); img.classList.add('cover-img'); };

  card.onclick = (e) => { if (!e.target.closest('.card-actions, .dl-state')) location.hash = `#/tour/${tr.id}`; };
  wireDownload(tr, card);
  return card;
}

async function wireDownload(tr, card) {
  const btn = $('.dl', card);
  const stateEl = $('.dl-state', card);
  const cn = cacheName(tr.id, tr.version);

  function setDownloading(progress) {
    btn.disabled = true;
    btn.textContent = t('downloadingTour');
    btn.classList.remove('good', 'warn');
    btn.classList.add('secondary');
    stateEl.innerHTML = `<div class="dl-bar"><i style="width:${progress}%"></i></div>`;
  }

  function setDone() {
    btn.textContent = t('tourDownloaded');
    btn.classList.add('good');
    btn.classList.remove('secondary', 'warn');
    btn.disabled = true;
    stateEl.innerHTML = `<button class="btn ghost sm del">${esc(t('deleteTourDownload'))}</button>`;
    $('.del', stateEl).onclick = async () => { await deleteTourDownload(tr.id); refresh(); };
  }

  function setIdle() {
    btn.textContent = t('downloadTour');
    btn.disabled = false;
    btn.classList.add('secondary');
    btn.classList.remove('good', 'warn');
    stateEl.innerHTML = '';
  }

  function setStale() {
    btn.textContent = t('downloadTour');
    btn.disabled = false;
    btn.classList.add('warn');
    btn.classList.remove('secondary', 'good');
    stateEl.innerHTML = `<p class="dl-hint warn-text">${esc(t('tourUpdateAvailable'))}</p>`;
  }

  function setEvicted() {
    btn.textContent = t('downloadTour');
    btn.disabled = false;
    btn.classList.add('warn');
    btn.classList.remove('secondary', 'good');
    stateEl.innerHTML = `<p class="dl-hint warn-text">${esc(t('tourReDownloadHint'))}</p>`;
  }

  async function refresh() {
    const dl = await tourDownloadState(tr.id, tr.path, tr.version, isDownloading);
    if (dl === 'downloading') {
      setDownloading(getDownloadProgress(tr.id));
      return;
    }
    if (dl === 'current') setDone();
    else if (dl === 'stale') setStale();
    else if (dl === 'evicted') setEvicted();
    else setIdle();
  }

  btn.onclick = async () => {
    if (!('caches' in window)) return;
    const dl = beginDownload(tr.id, tr.version);
    setDownloading(0);
    try {
      const urls = await tourAssetUrls(tr, loadTour);
      if (dl.abort.signal.aborted) return;
      const cache = await caches.open(cn);
      const weights = urls.map((u) => downloadWeight(u, tr.path, tr.cover));
      const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
      let doneWeight = 0;
      let criticalFailed = 0;
      const setProgress = (pct) => {
        const p = Math.min(99, Math.max(0, Math.round(pct)));
        setDownloadProgress(tr.id, p);
        if (card.isConnected) setDownloading(p);
      };
      for (let i = 0; i < urls.length; i++) {
        if (dl.abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const u = urls[i];
        try {
          const res = await fetch(u, { cache: 'reload', signal: dl.abort.signal });
          if (res.ok) {
            await putCachedUrl(cache, u, res);
          } else if (!isOptionalTourAsset(u, tr.cover)) {
            if (isCriticalTourAsset(u, tr.path)) criticalFailed++;
          }
        } catch (err) {
          if (dl.abort.signal.aborted || err.name === 'AbortError') throw err;
          if (!isOptionalTourAsset(u, tr.cover) && isCriticalTourAsset(u, tr.path)) criticalFailed++;
        }
        doneWeight += weights[i];
        setProgress((doneWeight / totalWeight) * 92);
      }
      if (criticalFailed > 0) {
        await caches.delete(cn);
        clearTourDownloaded(tr.id);
        if (!card.isConnected) return;
        btn.disabled = false;
        btn.textContent = t('downloadTour');
        btn.classList.add('warn');
        btn.classList.remove('secondary', 'good');
        const msg = t('tourDownloadIncomplete').replace('{n}', String(criticalFailed));
        stateEl.innerHTML = `<span class="warn-text">⚠︎ ${esc(msg)}</span>`;
        return;
      }
      setProgress(96);
      await deleteStaleTourCaches(tr.id, cn);
      setProgress(100);
      markTourDownloaded(tr.id, tr.version);
      if (card.isConnected) setDone();
    } catch (err) {
      await caches.delete(cn).catch(() => {});
      clearTourDownloaded(tr.id);
      if (dl.abort.signal.aborted || err.name === 'AbortError') return;
      if (!card.isConnected) return;
      btn.disabled = false;
      btn.textContent = t('downloadTour');
      stateEl.innerHTML = `<span class="warn-text">⚠︎ ${esc(t('errorAudioBody'))}</span>`;
    } finally {
      endDownload(tr.id);
    }
  };
  refresh();
}

export function renderHome() {
  tryActivateDeferredSw();
  if (!isPlayerOpen()) state.activeTour = null;
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  app.innerHTML = `
    <header class="home-head">
      <h1>${esc(t('toursTitle'))}</h1>
      <p class="muted">${esc(t('toursSubtitle'))}</p>
    </header>
    <section class="tours" id="tours"></section>
    ${standalone ? '' : `<div class="install-hint"><button class="btn ghost" id="install-help">${esc(t('installTitle'))}</button></div>`}
    <div class="refresh-hint"><button id="hard-refresh">${esc(t('hardRefreshLabel'))}</button></div>
  `;
  const wrap = $('#tours');
  INDEX.tours.forEach((tr) => wrap.appendChild(tourCard(tr)));
  if (!standalone) $('#install-help').onclick = showInstallSheet;
  $('#hard-refresh').onclick = hardRefresh;
}
