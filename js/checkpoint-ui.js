'use strict';

import { syncCpListRow } from './tour-list.js';
import { syncCpMapPin } from './map.js';
import { syncMarkDoneBtn } from './player.js';

export function refreshCheckpointUi(cpId) {
  syncCpListRow(cpId);
  syncCpMapPin(cpId);
  syncMarkDoneBtn();
}
