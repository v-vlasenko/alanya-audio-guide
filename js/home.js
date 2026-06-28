'use strict';

import { $, el, esc, app } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';
import {
  INDEX, loadTour, tourAssetUrls, tourCheckpointTotal, isTourFullyCompleted,
} from './catalog.js';
import {
  cacheName, putCachedUrl, readTourJsonFromCaches, findTourDownloadCache,
  deleteTourDownload, deleteStaleTourCaches,
} from './cache.js';
import { markTourDownloaded, loadCompleted } from './storage.js';
import { isPlayerOpen } from './player.js';
import { showInstallSheet } from './install.js';
import { hardRefresh } from './sw-register.js';

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

  async function isDownloaded() {
    if (await readTourJsonFromCaches(tr.id)) return true;
    return !!(await findTourDownloadCache(tr.id, tr.path));
  }
  function setDone() {
    btn.textContent = t('tourDownloaded'); btn.classList.add('good'); btn.classList.remove('secondary');
    btn.disabled = true;
    stateEl.innerHTML = `<button class="btn ghost sm del">${esc(t('deleteTourDownload'))}</button>`;
    $('.del', stateEl).onclick = async () => { await deleteTourDownload(tr.id); refresh(); };
  }
  function setIdle() {
    btn.textContent = t('downloadTour'); btn.disabled = false;
    btn.classList.add('secondary'); btn.classList.remove('good');
    stateEl.innerHTML = '';
  }
  async function refresh() { (await isDownloaded()) ? setDone() : setIdle(); }

  btn.onclick = async () => {
    if (!('caches' in window)) return;
    btn.disabled = true; btn.textContent = t('downloadingTour');
    stateEl.innerHTML = `<div class="dl-bar"><i></i></div>`;
    const bar = $('.dl-bar > i', stateEl);
    try {
      const urls = await tourAssetUrls(tr, loadTour);
      const cache = await caches.open(cn);
      let done = 0;
      for (const u of urls) {
        try {
          const res = await fetch(u, { cache: 'reload' });
          if (res.ok) await putCachedUrl(cache, u, res);
        } catch { /* cover may 404 */ }
        done++; bar.style.width = `${Math.round((done / urls.length) * 100)}%`;
      }
      await deleteStaleTourCaches(tr.id, cn);
      markTourDownloaded(tr.id, tr.version);
      setDone();
    } catch {
      btn.disabled = false; btn.textContent = t('downloadTour');
      stateEl.innerHTML = `<span class="muted">⚠︎ ${esc(t('errorAudioBody'))}</span>`;
    }
  };
  refresh();
}

export function renderHome() {
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
