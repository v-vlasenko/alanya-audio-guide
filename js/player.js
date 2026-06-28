'use strict';

import { $, el, esc, fmtTime, haptic, toast } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { INDEX, orderedCheckpoints, getCachedTour, audioCheckpointCount, isTourFullyCompleted } from './catalog.js';
import { saveProgress } from './storage.js';
import {
  PLAY_ICON, PAUSE_ICON, SKIP_BACK_ICON, SKIP_FWD_ICON,
  PREV_TRACK_ICON, NEXT_TRACK_ICON,
} from './icons.js';
import { SKIP_SEC, PLAYER_UI_VER } from './constants.js';
import { tryMarkCompleted, toggleMarkCompleted, getCompletionStateForCheckpoint } from './completion.js';
import { checkProximity, setNearbyPlayerOffset, hideNearbyCard } from './nearby.js';
import { assetUrl } from './cache.js';

export function isPlayerOpen() {
  const p = $('#player');
  return !!(p?.classList.contains('open'));
}

export function isPlayerMini() {
  return $('#player')?.classList.contains('mini') ?? false;
}

function ensurePlayerBackdrop() {
  if ($('#player-backdrop')) return;
  const bd = el('<div class="player-backdrop" id="player-backdrop" aria-hidden="true"></div>');
  bd.onclick = () => {
    const p = $('#player');
    if (p?.classList.contains('open') && !p.classList.contains('mini') && !p.classList.contains('info-only')) {
      minimizePlayer();
    }
  };
  document.body.appendChild(bd);
}

function setPlayerBackdrop(on) {
  ensurePlayerBackdrop();
  $('#player-backdrop')?.classList.toggle('visible', !!on);
}

export function syncPlayerChrome() {
  const dismiss = $('#p-dismiss');
  const p = $('#player');
  if (!dismiss || !p) return;
  dismiss.setAttribute('aria-label', t('close'));
  document.body.classList.toggle('player-open', p.classList.contains('open'));
  document.body.classList.toggle('player-mini', p.classList.contains('mini'));
}

export function persistPlayerOnHome() {
  const p = $('#player');
  if (!p?.classList.contains('open')) return;
  if (!p.classList.contains('mini') && !p.classList.contains('info-only')) minimizePlayer();
  else syncPlayerChrome();
}

function minimizePlayer() {
  const p = $('#player');
  if (!p?.classList.contains('open') || p.classList.contains('mini') || p.classList.contains('info-only')) return;
  haptic(8);
  p.classList.add('mini');
  setPlayerBackdrop(false);
  syncPlayerChrome();
  if ($('#nearby-card') && !$('#nearby-card').hidden) setNearbyPlayerOffset('mini');
}

function expandPlayer() {
  const p = $('#player');
  if (!p?.classList.contains('open') || !p.classList.contains('mini')) return;
  haptic(8);
  p.classList.remove('mini');
  syncPlayerChrome();
  if (!p.classList.contains('info-only')) {
    setPlayerBackdrop(true);
    if ($('#nearby-card') && !$('#nearby-card').hidden) setNearbyPlayerOffset('full');
  }
}

function skipAudio(deltaSec) {
  if (!state.audio?.src) return;
  const max = state.audio.duration || 0;
  state.audio.currentTime = Math.max(0, Math.min(max, state.audio.currentTime + deltaSec));
}

function updateMediaSession(cp) {
  if (!('mediaSession' in navigator) || !cp?.audio) return;
  const title = `${cp.order}. ${cp.shortTitle || cp.title}`;
  const artist = getPlayerTour()?.title || INDEX?.appName || '';
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: INDEX?.appName || '',
      artwork: [
        { src: assetUrl('icons/apple-touch-icon.png'), sizes: '180x180', type: 'image/png' },
        { src: assetUrl('icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
      ],
    });
  } catch {}
}

function updateMediaSessionPosition() {
  if (!('mediaSession' in navigator) || !state.audio?.src) return;
  const dur = state.audio.duration;
  if (!dur || !Number.isFinite(dur)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: dur,
      playbackRate: state.audio.playbackRate || 1,
      position: Math.min(state.audio.currentTime, dur),
    });
  } catch {}
}

function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  } catch {}
}

function setupMediaSessionHandlers() {
  if (state.mediaSessionReady || !('mediaSession' in navigator)) return;
  state.mediaSessionReady = true;
  const safe = (action, fn) => {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch {}
  };
  safe('play', () => { haptic(); state.audio?.play(); });
  safe('pause', () => { haptic(); state.audio?.pause(); });
  safe('previoustrack', () => { if (state.curIdx > 0) { haptic(); goTrack(state.curIdx - 1); } });
  safe('nexttrack', () => {
    const pt = getPlayerTour();
    if (pt && state.curIdx < pt.checkpoints.length - 1) { haptic(); goTrack(state.curIdx + 1); }
  });
  safe('seekbackward', (d) => { haptic(8); skipAudio(-(d?.seekOffset || SKIP_SEC)); });
  safe('seekforward', (d) => { haptic(8); skipAudio(d?.seekOffset || SKIP_SEC); });
}

function ensurePlayerShell() {
  if ($('#player')) return;
  document.body.appendChild(el('<div class="player" id="player"></div>'));
}

export function getPlayerTour() {
  if (!state.playingTourId || !isPlayerOpen()) return state.activeTour;
  if (state.activeTour?.id === state.playingTourId) return state.activeTour;
  return getCachedTour(state.playingTourId) || state.activeTour;
}

function playerOrdered() {
  const tour = getPlayerTour();
  return tour ? orderedCheckpoints(tour) : [];
}

export function syncNavButtons() {
  const prev = $('#p-prev');
  const next = $('#p-next');
  const pt = getPlayerTour();
  if (!prev || !next || !pt) return;
  prev.disabled = state.curIdx <= 0;
  next.disabled = state.curIdx < 0 || state.curIdx >= pt.checkpoints.length - 1;
}

function resetPlayerUi() {
  const cur = $('#p-cur');
  const seek = $('#p-seek');
  const dur = $('#p-dur');
  const btn = $('#p-play');
  if (cur) cur.textContent = '0:00';
  if (seek) seek.value = 0;
  if (dur) dur.textContent = '0:00';
  if (btn) {
    btn.innerHTML = PLAY_ICON;
    btn.setAttribute('aria-label', t('playLabel'));
  }
  markPlaying(false);
  syncNavButtons();
}

export function playIndex(i, { autoplay = false, tour = null } = {}) {
  const active = tour || state.activeTour;
  if (!active) return;
  const cp = orderedCheckpoints(active)[i];
  if (!cp) return;
  document.querySelectorAll('.cp-card.resume-at').forEach((r) => r.classList.remove('resume-at'));
  state.curIdx = i;
  state.playingTourId = active.id;
  state.maxListenedSec = 0;
  resetPlayerUi();
  const hasAudio = !!cp.audio;
  if (hasAudio) {
    state.audio.src = active.basePath + cp.audio;
    state.audio.playbackRate = state.playSpeed;
    state.audio.currentTime = 0;
    updateMediaSession(cp);
    if (autoplay) state.audio.play().catch(() => {});
    else state.audio.pause();
  } else {
    state.audio.pause();
    state.audio.removeAttribute('src');
    clearMediaSession();
  }
  $('#player').classList.toggle('info-only', !hasAudio);
  saveProgress(active.id, i);
  $('#p-title').textContent = `${cp.order}. ${cp.shortTitle || cp.title}`;
  $('#p-transcript').textContent = cp.transcript || '';
  $('#p-transcript').scrollTop = 0;
  const player = $('#player');
  player.classList.remove('mini');
  player.classList.add('open');
  syncMarkDoneBtn();
  if (hasAudio) {
    setPlayerBackdrop(true);
    setNearbyPlayerOffset($('#nearby-card') && !$('#nearby-card').hidden ? 'full' : null);
  } else {
    setPlayerBackdrop(false);
    setNearbyPlayerOffset(null);
  }
  syncPlayerChrome();
}

function goTrack(idx) {
  const wasPlaying = !!(state.audio?.src && !state.audio.paused);
  playIndex(idx, { autoplay: wasPlaying, tour: getPlayerTour() });
}

export function playById(id, { autoplay = false } = {}) {
  if (!state.activeTour) return;
  const i = orderedCheckpoints(state.activeTour).findIndex((c) => c.id === id);
  if (i >= 0) playIndex(i, { autoplay });
}

export function markPlaying(on) {
  document.querySelectorAll('.cp-card').forEach((r) => r.classList.remove('playing'));
  if (on && state.curIdx >= 0 && state.activeTour?.id === state.playingTourId) {
    document.querySelector(`.cp-card[data-i="${state.curIdx}"]`)?.classList.add('playing');
  }
}

export function stopPlayer() {
  if (state.audio) { state.audio.pause(); state.audio.removeAttribute('src'); }
  state.curIdx = -1;
  state.playingTourId = null;
  clearMediaSession();
  const p = $('#player');
  p?.classList.remove('open', 'mini', 'info-only');
  setPlayerBackdrop(false);
  setNearbyPlayerOffset(null);
  syncPlayerChrome();
  if (state.lastPos) checkProximity(state.lastPos.lat, state.lastPos.lng);
}

export function syncMarkDoneBtn() {
  const btn = $('#p-mark-done');
  const row = $('#p-mark-row');
  if (!btn || !row) return;
  const pt = getPlayerTour();
  const cp = state.curIdx >= 0 ? playerOrdered()[state.curIdx] : null;
  if (!cp?.audio) { row.hidden = true; return; }
  row.hidden = false;
  const done = getCompletionStateForCheckpoint(pt, cp.id);
  btn.disabled = false;
  btn.textContent = done ? t('markCompletedUndo') : t('markCompleted');
  btn.classList.remove('good');
}

export function buildPlayer() {
  ensurePlayerShell();
  ensurePlayerBackdrop();
  setupMediaSessionHandlers();
  const p = $('#player');
  if (state.playerReady && p?.dataset.uiVer === String(PLAYER_UI_VER)) return;
  state.playerReady = true;
  if (p) p.dataset.uiVer = String(PLAYER_UI_VER);
  p.innerHTML = `
    <div class="pt" id="p-head">
      <span id="p-title"></span>
      <button class="close" id="p-dismiss" type="button" aria-label="${esc(t('close'))}">✕</button>
    </div>
    <div class="seek">
      <span id="p-cur">0:00</span>
      <input type="range" id="p-seek" min="0" max="100" value="0" step="1">
      <div class="seek-end">
        <span id="p-dur">0:00</span>
        <button class="p-ctl" id="p-speed" type="button" title="${esc(t('playbackSpeedTitle'))}">1×</button>
      </div>
    </div>
    <div class="pcontrols">
      <button class="btn secondary p-nav" id="p-prev" type="button" aria-label="${esc(t('previous'))}">${PREV_TRACK_ICON}</button>
      <button class="p-ctl p-skip" id="p-skip-back" type="button" aria-label="−5 с">${SKIP_BACK_ICON}</button>
      <button class="btn p-play-btn" id="p-play" type="button" aria-label="${esc(t('playLabel'))}">${PLAY_ICON}</button>
      <button class="p-ctl p-skip" id="p-skip-fwd" type="button" aria-label="+5 с">${SKIP_FWD_ICON}</button>
      <button class="btn secondary p-nav" id="p-next" type="button" aria-label="${esc(t('next'))}">${NEXT_TRACK_ICON}</button>
    </div>
    <div class="p-mark-row" id="p-mark-row"><button class="btn ghost sm" id="p-mark-done">${esc(t('markCompleted'))}</button></div>
    <div class="transcript" id="p-transcript"></div>
  `;
  state.audio = new Audio();
  state.audio.preload = 'metadata';
  let seeking = false;
  state.audio.addEventListener('loadedmetadata', () => {
    $('#p-dur').textContent = fmtTime(state.audio.duration);
    $('#p-seek').max = Math.floor(state.audio.duration) || 100;
    updateMediaSessionPosition();
  });
  state.audio.addEventListener('timeupdate', () => {
    const cur = $('#p-cur'); if (!cur) return;
    cur.textContent = fmtTime(state.audio.currentTime);
    if (!seeking) {
      $('#p-seek').value = Math.floor(state.audio.currentTime);
      if (state.audio.currentTime > state.maxListenedSec) state.maxListenedSec = state.audio.currentTime;
    }
    updateMediaSessionPosition();
  });
  const setPlayBtn = (playing) => {
    const b = $('#p-play');
    if (!b) return;
    b.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
    b.setAttribute('aria-label', playing ? t('pauseLabel') : t('playLabel'));
  };
  state.audio.addEventListener('play', () => {
    setPlayBtn(true); markPlaying(true);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  });
  state.audio.addEventListener('pause', () => {
    setPlayBtn(false); markPlaying(false);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    if (state.lastPos) checkProximity(state.lastPos.lat, state.lastPos.lng);
  });
  state.audio.addEventListener('ended', () => {
    state.maxListenedSec = Math.max(state.maxListenedSec, state.audio.duration || 0);
    if (tryMarkCompleted(state.curIdx)) {
      const pt = getPlayerTour();
      const total = audioCheckpointCount(pt);
      if (!isTourFullyCompleted(pt.id, total, state.completedSet) && state.curIdx < pt.checkpoints.length - 1) {
        playIndex(state.curIdx + 1, { autoplay: true, tour: pt });
      }
    } else if (state.lastPos) {
      checkProximity(state.lastPos.lat, state.lastPos.lng);
    }
  });
  state.audio.addEventListener('error', () => { toast(t('errorAudioBody')); });

  const seek = $('#p-seek');
  seek.addEventListener('input', () => { seeking = true; $('#p-cur').textContent = fmtTime(seek.value); });
  seek.addEventListener('change', () => { state.audio.currentTime = Number(seek.value); seeking = false; });
  const SPEEDS = [1.0, 1.25, 1.5, 0.75];
  let speedIdx = 0;
  $('#p-speed').onclick = () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    state.playSpeed = SPEEDS[speedIdx];
    state.audio.playbackRate = state.playSpeed;
    $('#p-speed').textContent = state.playSpeed + '×';
    haptic(8);
  };
  $('#p-play').onclick = () => { haptic(); state.audio.paused ? state.audio.play() : state.audio.pause(); };
  $('#p-prev').onclick = () => { haptic(); if (state.curIdx > 0) goTrack(state.curIdx - 1); };
  $('#p-next').onclick = () => {
    haptic();
    const pt = getPlayerTour();
    if (pt && state.curIdx < pt.checkpoints.length - 1) goTrack(state.curIdx + 1);
  };
  $('#p-skip-back').onclick = () => { haptic(8); skipAudio(-SKIP_SEC); };
  $('#p-skip-fwd').onclick = () => { haptic(8); skipAudio(SKIP_SEC); };
  $('#p-dismiss').onclick = () => { haptic(); stopPlayer(); };
  $('#p-head').onclick = (e) => {
    if (e.target.closest('#p-dismiss')) return;
    if ($('#player')?.classList.contains('mini')) expandPlayer();
  };
  $('#p-mark-done').onclick = () => {
    const cp = state.curIdx >= 0 ? playerOrdered()[state.curIdx] : null;
    if (cp) toggleMarkCompleted(cp.id);
  };
  syncNavButtons();
}
