'use strict';

export const MARK_ICON = {
  done: '<svg class="mark-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
};

export const PLAY_ICON = '<svg class="p-play-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
export const PAUSE_ICON = '<svg class="p-play-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>';
const REPLAY_ICON = '<svg class="p-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>';
const FORWARD_ICON = '<svg class="p-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5v-4l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/></svg>';
export const SKIP_BACK_ICON = `<span class="skip-inner">${REPLAY_ICON}<span class="skip-num">5</span></span>`;
export const SKIP_FWD_ICON = `<span class="skip-inner skip-fwd"><span class="skip-num">5</span>${FORWARD_ICON}</span>`;
export const PREV_TRACK_ICON = '<svg class="p-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 6h2v12H6V6zm4.5 6l8.5 6V6l-8.5 6z"/></svg>';
export const NEXT_TRACK_ICON = '<svg class="p-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 6h2v12h-2V6zM6 18l8.5-6L6 6v12z"/></svg>';
export const TRASH_ICON = '<svg class="ico-trash" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
