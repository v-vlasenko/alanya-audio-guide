'use strict';

import { $, esc, app, resetPageScroll } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { INDEX, loadTour } from './catalog.js';
import { loadCompleted } from './storage.js';
import { renderHome } from './home.js';
import { renderList, switchTab, applySavedProgressHighlight } from './tour-list.js';
import { renderMap } from './map.js';
import { resetPromptedSet } from './nearby.js';
import {
  buildPlayer, playIndex, isPlayerOpen, markPlaying,
  syncNavButtons, syncMarkDoneBtn,
} from './player.js';

export { renderHome } from './home.js';
export { resetPageScroll } from './dom.js';

export async function renderTour(id) {
  const meta = INDEX.tours.find((x) => x.id === id);
  if (!meta) { location.hash = '#/'; return; }
  let tour;
  try { tour = await loadTour(id); }
  catch {
    app.innerHTML = `<p>${esc(t('notDownloadedHint'))}</p><button class="btn" id="tour-back">${esc(t('backToTours'))}</button>`;
    $('#tour-back').onclick = () => { location.hash = '#/'; };
    return;
  }
  state.activeTour = tour;
  state.completedSet = loadCompleted(id);
  resetPromptedSet();

  app.innerHTML = `
    <div class="topbar">
      <button class="btn ghost sm" id="back">${esc(t('backToTours'))}</button>
      <h2>${esc(tour.title)}</h2>
    </div>
    <details class="hints-fold">
      <summary>${esc(t('hintsSummary'))}</summary>
      <div class="hints-body">
        ${tour.tip ? `<p>💡 ${esc(tour.tip)}</p>` : ''}
        <p>${esc(t('gpsKeepOpenTip'))}</p>
      </div>
    </details>
    <div class="tabs" role="tablist">
      <button id="tab-list" role="tab" aria-selected="false">${esc(t('tabList'))}</button>
      <button id="tab-map" role="tab" aria-selected="true">${esc(t('tabMap'))}</button>
    </div>
    <section id="pane-list" hidden></section>
    <section id="pane-map"></section>
    <div class="nearby-card" id="nearby-card" hidden></div>
  `;
  $('#back').onclick = () => { location.hash = '#/'; };
  $('#tab-list').onclick = () => switchTab('list', () => {});
  $('#tab-map').onclick = () => switchTab('map', renderMap);
  buildPlayer();
  renderList((i) => playIndex(i));
  renderMap();
  const audioActive = state.curIdx >= 0 && state.audio && !state.audio.paused && state.playingTourId === id;
  if (audioActive) {
    markPlaying(true);
  } else {
    applySavedProgressHighlight();
  }
  if (isPlayerOpen()) {
    syncNavButtons();
    syncMarkDoneBtn();
  }
  resetPageScroll();
  requestAnimationFrame(resetPageScroll);
}
