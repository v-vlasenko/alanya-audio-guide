'use strict';

import { $, el, esc, haptic } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { INDEX, orderedCheckpoints, audioCheckpointCount, tourCheckpointTotal, isTourFullyCompleted } from './catalog.js';
import { loadCompleted, saveCompleted, clearProgress } from './storage.js';
import { COMPLETE_RATIO } from './constants.js';

const hooks = {
  refreshCheckpointUi: () => {},
  playIndex: () => {},
  isPlayerOpen: () => false,
  getPlayerTour: () => null,
};

export function initCompletion(h) {
  Object.assign(hooks, h);
}

function listenedEnough() {
  const dur = state.audio?.duration;
  if (!dur || !Number.isFinite(dur)) return false;
  const need = Math.max(dur * COMPLETE_RATIO, dur - 2);
  return state.maxListenedSec >= need;
}

export function tryMarkCompleted(idx) {
  const pt = hooks.getPlayerTour();
  if (!pt || idx < 0) return false;
  const cp = orderedCheckpoints(pt)[idx];
  if (!cp || !cp.audio) return false;
  if (!listenedEnough()) return false;
  markCompleted(cp.id);
  return true;
}

export function markCompleted(cpId) {
  const tourId = hooks.isPlayerOpen() && state.playingTourId ? state.playingTourId : state.activeTour?.id;
  if (!tourId) return false;
  if (tourId === state.activeTour?.id) {
    if (state.completedSet.has(cpId)) return false;
    state.completedSet.add(cpId);
    saveCompleted(tourId, state.completedSet);
    hooks.refreshCheckpointUi(cpId);
    const total = audioCheckpointCount(state.activeTour)
      || tourCheckpointTotal(INDEX.tours.find((x) => x.id === state.activeTour.id) || {}, state.activeTour);
    if (isTourFullyCompleted(state.activeTour.id, total, state.completedSet)) showCompletion();
  } else {
    const set = loadCompleted(tourId);
    if (set.has(cpId)) return false;
    set.add(cpId);
    saveCompleted(tourId, set);
  }
  return true;
}

function unmarkCompleted(cpId) {
  if (!state.activeTour || !state.completedSet.has(cpId)) return false;
  state.completedSet.delete(cpId);
  saveCompleted(state.activeTour.id, state.completedSet);
  hooks.refreshCheckpointUi(cpId);
  return true;
}

export function toggleMarkCompleted(cpId) {
  if (state.completedSet.has(cpId)) {
    if (unmarkCompleted(cpId)) haptic(8);
  } else if (markCompleted(cpId)) {
    haptic(8);
  }
}

export function showCompletion() {
  if ($('#completion-overlay')) return;
  clearProgress(state.activeTour.id);
  haptic(40);
  const title = esc(state.activeTour?.title || '');
  const overlay = el(`
    <div class="completion-overlay" id="completion-overlay">
      <div class="completion-card">
        <div class="completion-emoji">🎉</div>
        <h2>${esc(t('tourCompletedTitle'))}</h2>
        <p class="muted">${title}</p>
        <div class="completion-actions">
          <button class="btn secondary" id="comp-home">${esc(t('tourCompletedHome'))}</button>
          <button class="btn ghost sm" id="comp-replay">${esc(t('tourCompletedReplay'))}</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  $('#comp-home', overlay).onclick = () => { haptic(); overlay.remove(); location.hash = '#/'; };
  $('#comp-replay', overlay).onclick = () => { haptic(); overlay.remove(); hooks.playIndex(0); };
}

export function getCompletionStateForCheckpoint(pt, cpId) {
  if (!pt) return false;
  const set = pt.id === state.activeTour?.id ? state.completedSet : loadCompleted(pt.id);
  return set.has(cpId);
}
