'use strict';

import { $, el, esc, haptic } from './dom.js';
import { t } from './i18n.js';

export function showInstallSheet() {
  const sheet = el(`
    <div class="sheet-backdrop" id="sheet-bd">
      <div class="sheet">
        <h2>${esc(t('installTitle'))}</h2>
        <ol>
          <li>${esc(t('installStep1'))}</li>
          <li>${esc(t('installStep2'))}</li>
          <li>${esc(t('installStep3'))}</li>
          <li>${esc(t('installStep4'))}</li>
        </ol>
        <button class="btn" id="sheet-close">${esc(t('close'))}</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  $('#sheet-close', sheet).onclick = close;
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
}
