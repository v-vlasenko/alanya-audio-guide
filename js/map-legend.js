'use strict';

import { esc } from './dom.js';

let legendData = null;

export async function loadMapLegend() {
  if (legendData) return legendData;
  const r = await fetch('data/osm-map-legend-uk.json');
  legendData = await r.json();
  return legendData;
}

function lineSwatch(id) {
  return `<span class="map-leg-line map-leg-line--${esc(id)}" aria-hidden="true"></span>`;
}

function areaSwatch(id) {
  return `<span class="map-leg-area map-leg-area--${esc(id)}" aria-hidden="true"></span>`;
}

function symbolSwatch(id) {
  return `<img class="map-leg-icon" src="icons/osm/${esc(id)}.svg" width="20" height="20" alt="" aria-hidden="true">`;
}

function section(title, items, swatchFn) {
  if (!items?.length) return '';
  const rows = items.map((item) => `
    <li class="map-leg-item">
      ${swatchFn(item.id)}
      <span>${esc(item.label)}</span>
    </li>`).join('');
  return `<h4 class="map-leg-h">${esc(title)}</h4><ul class="map-leg-list">${rows}</ul>`;
}

export function renderMapLegendHtml(data) {
  const paths = section(data.pathsTitle, data.paths, lineSwatch);
  const areas = section(data.areasTitle, data.areas, areaSwatch);
  const symbols = section(data.symbolsTitle, data.symbols, symbolSwatch);
  const intro = data.intro ? `<p class="map-leg-intro">${esc(data.intro)}</p>` : '';
  return `
    <details class="hints-subfold map-leg-fold">
      <summary>${esc(data.summary)}</summary>
      <div class="map-leg-body">
        ${intro}
        ${paths}
        ${areas}
        ${symbols}
      </div>
    </details>`;
}
