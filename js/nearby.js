'use strict';

import { $, el, esc, haptic } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { orderedCheckpoints } from './catalog.js';
import { haversineM } from './geo.js';
import { playById } from './player.js';

function cpRadius(cp) {
  return cp.radiusM ?? state.activeTour?.defaultRadiusM ?? 30;
}

function checkpointsInRange(lat, lng) {
  if (!state.activeTour) return [];
  return orderedCheckpoints(state.activeTour)
    .map((cp) => ({ cp, dist: haversineM(lat, lng, cp.lat, cp.lng) }))
    .filter(({ cp, dist }) => dist <= cpRadius(cp))
    .sort((a, b) => a.dist - b.dist);
}

export function hideNearbyCard() {
  const card = $('#nearby-card');
  if (card) { card.hidden = true; card.innerHTML = ''; }
}

function dismissNearby(ids) {
  ids.forEach((id) => state.promptedSet.add(id));
  hideNearbyCard();
  haptic(8);
}

function pickNearby(cpId) {
  state.promptedSet.add(cpId);
  hideNearbyCard();
  haptic();
  playById(cpId, { autoplay: true });
}

export function setNearbyPlayerOffset(mode) {
  const card = $('#nearby-card');
  if (!card) return;
  card.classList.remove('above-player', 'above-player-mini');
  if (mode === 'full') card.classList.add('above-player');
  else if (mode === 'mini') card.classList.add('above-player-mini');
}

export function showNearbyCard(inRange) {
  const pending = inRange.filter(({ cp }) => !state.promptedSet.has(cp.id));
  if (!pending.length) { hideNearbyCard(); return; }

  const card = $('#nearby-card');
  if (!card) return;

  if (pending.length === 1) {
    const { cp } = pending[0];
    card.innerHTML = `
      <button type="button" class="nearby-x" aria-label="${esc(t('close'))}">✕</button>
      <p class="nearby-msg">${esc(t('nearbyPrefix'))} <b>${esc(cp.shortTitle || cp.title)}</b></p>
      <button type="button" class="btn nearby-go">${esc(t('listen'))}</button>`;
    $('.nearby-x', card).onclick = () => dismissNearby([cp.id]);
    $('.nearby-go', card).onclick = () => pickNearby(cp.id);
  } else {
    const rows = pending.slice(0, 4).map(({ cp }) =>
      `<button type="button" class="btn secondary nearby-pick" data-id="${esc(cp.id)}">${cp.order}. ${esc(cp.shortTitle || cp.title)} — ${esc(t('listen'))}</button>`
    ).join('');
    card.innerHTML = `
      <button type="button" class="nearby-x" aria-label="${esc(t('close'))}">✕</button>
      <p class="nearby-msg"><b>${esc(t('nearbyMultiple'))}</b></p>
      <p class="nearby-hint muted">${esc(t('nearbyChoose'))}</p>
      <div class="nearby-picks">${rows}</div>`;
    $('.nearby-x', card).onclick = () => dismissNearby(pending.slice(0, 4).map(({ cp }) => cp.id));
    card.querySelectorAll('.nearby-pick').forEach((btn) => {
      btn.onclick = () => pickNearby(btn.dataset.id);
    });
  }
  card.hidden = false;
  const p = $('#player');
  if (p?.classList.contains('open')) {
    setNearbyPlayerOffset(p.classList.contains('mini') ? 'mini' : 'full');
  }
}

export function checkProximity(lat, lng) {
  if (!state.activeTour) return;
  if (state.audio && !state.audio.paused) return;
  state.lastPos = { lat, lng };
  showNearbyCard(checkpointsInRange(lat, lng));
}

export function resetPromptedSet() {
  state.promptedSet = new Set();
}
