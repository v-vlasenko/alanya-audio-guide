'use strict';

import { teardownMap } from './map.js';
import { hideNearbyCard, resetPromptedSet } from './nearby.js';
import {
  isPlayerOpen, isPlayerMini, stopPlayer, persistPlayerOnHome,
} from './player.js';
import { state } from './state.js';
import { renderTour, renderHome, resetPageScroll } from './tour.js';

export function route() {
  const m = location.hash.match(/^#\/tour\/([\w-]+)/);
  const nextTourId = m?.[1] ?? null;

  teardownMap();
  hideNearbyCard();
  resetPromptedSet();

  if (nextTourId) {
    resetPageScroll();
    if (isPlayerOpen() && state.playingTourId && state.playingTourId !== nextTourId && !isPlayerMini()) {
      stopPlayer();
    }
    renderTour(nextTourId);
  } else {
    renderHome();
    if (isPlayerOpen()) persistPlayerOnHome();
  }
}
