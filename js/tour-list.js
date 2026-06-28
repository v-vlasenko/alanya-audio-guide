'use strict';

import { $, el, esc, haptic } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { MARK_ICON } from './icons.js';
import { orderedCheckpoints } from './catalog.js';
import { toggleMarkCompleted } from './completion.js';
import { loadProgress } from './storage.js';

export function syncCpListRow(cpId, row, markBtn) {
  if (!row) {
    const i = orderedCheckpoints(state.activeTour).findIndex((c) => c.id === cpId);
    const card = document.querySelector(`.cp-card[data-i="${i}"]`);
    row = card?.querySelector('.cp');
    markBtn = card?.querySelector('.cp-mark');
  }
  if (!row) return;
  const card = row.closest('.cp-card');
  const cp = orderedCheckpoints(state.activeTour).find((c) => c.id === cpId);
  if (!cp) return;
  const num = $('.num', row);
  const done = state.completedSet.has(cpId);
  if (done) {
    card?.classList.add('completed');
    num.textContent = cp.order;
    num.classList.add('done');
  } else {
    card?.classList.remove('completed');
    num.textContent = cp.order;
    num.classList.remove('done');
  }
  const stateEl = $('.state', row);
  if (stateEl) {
    stateEl.textContent = '';
    stateEl.classList.remove('done');
  }
  if (markBtn) {
    markBtn.classList.toggle('done', done);
    markBtn.innerHTML = done ? MARK_ICON.done : '';
    markBtn.setAttribute('aria-label', done ? t('markCompletedUndo') : t('markCompleted'));
    markBtn.title = done ? t('markCompletedUndo') : t('markCompleted');
  }
}

export function renderList(onPlayIndex) {
  const pane = $('#pane-list');
  pane.innerHTML = '<div class="cp-list"></div>';
  const list = $('.cp-list', pane);
  orderedCheckpoints(state.activeTour).forEach((cp, i) => {
    const card = el(`<div class="cp-card" data-i="${i}"></div>`);
    const row = el(`
      <button class="cp" data-i="${i}" data-id="${cp.id}">
        <span class="num">${cp.order}</span>
        <span class="t">
          <b>${esc(cp.shortTitle || cp.title)}</b>
          ${cp.optional ? `<span class="badge">${esc(t('optionalBadge'))}</span>` : ''}
          <span class="state"></span>
        </span>
      </button>`);
    const markBtn = el(`<button type="button" class="cp-mark" title="${esc(t('markCompleted'))}"></button>`);
    if (!cp.audio) markBtn.hidden = true;
    markBtn.onclick = (e) => { e.stopPropagation(); haptic(); toggleMarkCompleted(cp.id); };
    card.appendChild(row);
    card.appendChild(markBtn);
    syncCpListRow(cp.id, row, markBtn);
    row.onclick = () => { haptic(); onPlayIndex(i); };
    list.appendChild(card);
  });
}

export function resumeCheckpointIndex(tour, completedSet) {
  const idx = loadProgress(tour.id);
  if (idx < 0) return -1;
  const list = orderedCheckpoints(tour);
  if (idx >= list.length) return -1;
  if (completedSet.has(list[idx].id)) return -1;
  return idx;
}

export function highlightResumeCheckpoint(index) {
  document.querySelectorAll('.cp-card.resume-at').forEach((r) => r.classList.remove('resume-at'));
  document.querySelector(`.cp-card[data-i="${index}"]`)?.classList.add('resume-at');
}

export function applySavedProgressHighlight() {
  const idx = resumeCheckpointIndex(state.activeTour, state.completedSet);
  if (idx >= 0) highlightResumeCheckpoint(idx);
}

export function switchTab(which, onMapTab) {
  const isMap = which === 'map';
  $('#tab-list').setAttribute('aria-selected', String(!isMap));
  $('#tab-map').setAttribute('aria-selected', String(isMap));
  $('#pane-list').hidden = isMap;
  $('#pane-map').hidden = !isMap;
  if (isMap) onMapTab();
  else $('.cp-card.resume-at')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
