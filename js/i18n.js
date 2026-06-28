'use strict';

export let STR = {};
export const t = (k) => STR[k] ?? k;
export function initI18n(strings) { STR = strings; }
