// src/components/planner/gridConstants.ts — single source of truth for the planner grid geometry.
// HOUR_HEIGHT is applied inline as --hour-h on the grid and used by the drag/resize math.

/** Height of one hour row in px (1px = 1 minute). */
export const HOUR_HEIGHT = 60;
export const PX_PER_MINUTE = HOUR_HEIGHT / 60;
export const MINUTES_PER_DAY = 24 * 60;
/** Snap step for drag, resize, keyboard moves and click-to-create. */
export const SNAP_MINUTES = 15;
/** Snap step for tap-to-create on touch. */
export const TOUCH_SNAP_MINUTES = 30;
/** Latest start a task can be dragged to (23:45). */
export const MAX_START_MINUTES = MINUTES_PER_DAY - SNAP_MINUTES;
/** Longest duration reachable by dragging (hours). */
export const MAX_DURATION_HOURS = 24;
/** Minimum rendered block height (px) so very short tasks stay visible. */
export const MIN_BLOCK_HEIGHT = 13;
/** Mouse/pen: pixels of movement before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** Touch: long-press delay before a task can be dragged, and the movement that cancels it. */
export const LONG_PRESS_MS = 350;
export const LONG_PRESS_TOLERANCE_PX = 8;
/** Auto-scroll when the pointer is this close to the scroller's edge while dragging. */
export const AUTO_SCROLL_EDGE_PX = 40;
/** Keyboard moves commit after this much idle time. */
export const KEYBOARD_COMMIT_DELAY_MS = 500;
/**
 * Cross-week dragging: holding a dragged task within this many px of the grid's left/right edge
 * shows the previous/next week (day on phones) after EDGE_FIRST_DELAY_MS, then again every
 * EDGE_REPEAT_MS while it stays there.
 */
export const EDGE_ZONE_PX = 48;
export const EDGE_FIRST_DELAY_MS = 600;
export const EDGE_REPEAT_MS = 900;
