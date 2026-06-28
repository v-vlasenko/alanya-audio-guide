'use strict';

export const $ = (sel, el = document) => el.querySelector(sel);
export const app = $('#app');

export const el = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild;
};

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const fmtTime = (s) => {
  s = Math.floor(s || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const haptic = (ms = 10) => navigator.vibrate?.(ms);

export function toast(msg) {
  const tEl = el(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(tEl);
  setTimeout(() => tEl.remove(), 2600);
}

export function resetPageScroll() {
  window.scrollTo(0, 0);
}
