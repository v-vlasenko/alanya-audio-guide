'use strict';

import { $, el, esc } from './dom.js';
import { t } from './i18n.js';

export function initOfflineIndicator() {
  if ($('#offline-bar')) return;
  const bar = el(`<div class="offline-bar" id="offline-bar" role="status" hidden>${esc(t('offlineIndicator'))}</div>`);
  document.body.prepend(bar);
  const sync = () => { bar.hidden = navigator.onLine; };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
}
