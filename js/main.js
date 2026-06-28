'use strict';

import { app } from './dom.js';
import { initI18n, t } from './i18n.js';
import { initCatalog, INDEX } from './catalog.js';
import { fetchJsonCached } from './cache.js';
import { registerSW } from './sw-register.js';
import { route } from './router.js';
import { $ } from './dom.js';
import { initCompletion } from './completion.js';
import { refreshCheckpointUi } from './checkpoint-ui.js';
import {
  playIndex, isPlayerOpen, getPlayerTour,
} from './player.js';
import { initOfflineIndicator } from './offline.js';

function detectWebview() {
  const ua = navigator.userAgent || '';
  const inApp = /(FBAN|FBAV|Instagram|Telegram|Line|WhatsApp|MicroMessenger)/i.test(ua);
  const isStandalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (inApp && !isStandalone) {
    const w = $('#webview-warn');
    w.textContent = t('openInSafariWarning');
    w.hidden = false;
  }
}

async function boot() {
  initCompletion({
    refreshCheckpointUi,
    playIndex,
    isPlayerOpen,
    getPlayerTour,
  });

  try {
    await registerSW();
    const [strings, index] = await Promise.all([
      fetchJsonCached('data/ui-strings-uk.json'),
      fetchJsonCached('tours/index.json'),
    ]);
    initI18n(strings);
    initCatalog(index);
  } catch {
    const offline = !navigator.onLine;
    const msg = offline
      ? 'Відкрийте гід один раз на Wi-Fi, щоб він зберегся на телефон. Потім працюватиме без інтернету.'
      : 'Не вдалося завантажити дані. Перевірте з\'єднання та оновіть сторінку.';
    app.innerHTML = `<p>${msg}</p>`;
    return;
  }
  initOfflineIndicator();
  document.title = INDEX.appName || document.title;
  detectWebview();
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', route);
  route();
}

boot();
