'use strict';

export const state = {
  activeTour: null,
  completedSet: new Set(),
  playingTourId: null,
  promptedSet: new Set(),
  lastPos: null,
  map: null,
  meLayer: null,
  watchId: null,
  didFit: false,
  wpMarkers: [],
  cpMarkers: new Map(),
  showWp: true,
  audio: null,
  curIdx: -1,
  playSpeed: 1.0,
  maxListenedSec: 0,
  mediaSessionReady: false,
  playerReady: false,
  activeDownloads: new Map(),
};
