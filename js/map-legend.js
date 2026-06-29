'use strict';

import { esc } from './dom.js';

let legendData = null;

export async function loadMapLegend() {
  if (legendData) return legendData;
  try {
    const r = await fetch('data/osm-map-legend-uk.json');
    if (!r.ok) return null;
    legendData = await r.json();
    return legendData;
  } catch {
    return null;
  }
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

function section(title, items, swatchFn, afterTitle = '') {
  if (!items?.length) return '';
  const rows = items.map((item) => `
    <li class="map-leg-item">
      ${swatchFn(item.id)}
      <span>${esc(item.label)}</span>
    </li>`).join('');
  return `<h4 class="map-leg-h">${esc(title)}</h4>${afterTitle}<ul class="map-leg-list">${rows}</ul>`;
}

function wikiSourceNote(data) {
  if (!data.sourceUrl) return '';
  return `<p class="map-leg-source">${esc(data.sourceNote || '')}<a href="${esc(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(data.sourceLinkLabel || data.sourceUrl)}</a>.</p>`;
}

export function renderMapLegendHtml(data) {
  if (!data) return '';
  const paths = section(data.pathsTitle, data.paths, lineSwatch);
  const areas = section(data.areasTitle, data.areas, areaSwatch);
  const symbols = section(data.symbolsTitle, data.symbols, symbolSwatch, wikiSourceNote(data));
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
