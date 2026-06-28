'use strict';

export const tourDlKey = (id) => `tour-dl-${id}`;

export function markTourDownloaded(id, version) { localStorage.setItem(tourDlKey(id), version); }
export function clearTourDownloaded(id) { localStorage.removeItem(tourDlKey(id)); }

export function loadCompleted(id) {
  try { return new Set(JSON.parse(localStorage.getItem('completed-' + id) || '[]')); }
  catch { return new Set(); }
}

export function saveCompleted(id, set) {
  localStorage.setItem('completed-' + id, JSON.stringify([...set]));
}

export function loadProgress(id) { return parseInt(localStorage.getItem('progress-' + id) ?? '-1', 10); }
export function saveProgress(id, idx) { localStorage.setItem('progress-' + id, idx); }
export function clearProgress(id) { localStorage.removeItem('progress-' + id); }

export function isGpsOff() { return localStorage.getItem('gpsOff') === '1'; }
export function setGpsOff(off) { localStorage.setItem('gpsOff', off ? '1' : '0'); }

export function clearAllTourDownloads() {
  Object.keys(localStorage).filter((k) => k.startsWith('tour-dl-')).forEach((k) => localStorage.removeItem(k));
}
