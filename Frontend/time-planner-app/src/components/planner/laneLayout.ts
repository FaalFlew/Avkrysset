// src/components/planner/laneLayout.ts — where a task block sits in its day column.
//
// blockExtent(): vertical placement in px (wall-clock minutes via datetime.gridBox, so DST days
// line up with the hour rows), with the minimum visible height and clamping at the end of the day.
//
// layoutLanes(): overlapping blocks share the column side by side (standard interval-graph lane
// assignment, like most calendars):
//   1. Sort by top, then longer first (so a long block takes the left lane).
//   2. Sweep into clusters: blocks that overlap directly or through a chain (A–B, B–C) form one
//      cluster; a cluster ends when the next block starts at/after the cluster's lowest bottom.
//   3. Inside a cluster, each block takes the first lane whose last block ends at/before its top
//      (half-open: touching blocks don't overlap); otherwise a new lane opens.
//   4. Every block of a cluster divides the width by the cluster's lane count, and expands to the
//      right over neighbouring lanes that are free for its whole extent (`span`).
// Overlap is judged on the *drawn* extents (min height included), so a 5-minute task drawn 13px
// tall does not hide a task starting 5 minutes later.

import { gridBox, type InstantInput } from "@/lib/datetime";
import { MIN_BLOCK_HEIGHT, MINUTES_PER_DAY, PX_PER_MINUTE } from "./gridConstants";

export interface BlockExtent {
  /** px from the top of the day column. */
  top: number;
  /** Drawn height in px (≥ MIN_BLOCK_HEIGHT; the 2px gap below is not part of it). */
  height: number;
  /** The task continues past the end of the day (bottom corners squared). */
  clamped: boolean;
}

/** Vertical placement of a task block in its day column. */
export function blockExtent(start: InstantInput, durationHours: number): BlockExtent {
  const box = gridBox(start, durationHours);
  let span = box.height;
  let clamped = box.endsNextDay;
  if (box.top + span > MINUTES_PER_DAY) {
    span = MINUTES_PER_DAY - box.top;
    clamped = true;
  }
  return { top: box.top * PX_PER_MINUTE, height: Math.max(MIN_BLOCK_HEIGHT, span * PX_PER_MINUTE - 2), clamped };
}

export interface LaneInput {
  id: string;
  /** Drawn extent, px (or any consistent unit): [top, bottom). */
  top: number;
  bottom: number;
}

export interface LanePlacement {
  /** 0-based lane from the left. */
  lane: number;
  /** Lanes in this block's cluster (1 = full width). */
  lanes: number;
  /** Lanes this block covers (≥ 1; expands right over free lanes). */
  span: number;
}

const overlapsY = (a: LaneInput, b: LaneInput) => a.top < b.bottom && b.top < a.bottom;

/** Lane placement for every item (see the module comment). */
export function layoutLanes(items: readonly LaneInput[]): Map<string, LanePlacement> {
  const result = new Map<string, LanePlacement>();
  const sorted = [...items]
    .map((item) => ({ ...item, bottom: Math.max(item.bottom, item.top) }))
    .sort((a, b) => a.top - b.top || b.bottom - b.top - (a.bottom - a.top) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let cluster: { item: LaneInput; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterBottom = Number.NEGATIVE_INFINITY;

  const flush = () => {
    const lanes = laneEnds.length;
    for (const entry of cluster) {
      let span = 1;
      for (let lane = entry.lane + 1; lane < lanes; lane += 1) {
        const blocked = cluster.some((other) => other.lane === lane && overlapsY(other.item, entry.item));
        if (blocked) break;
        span += 1;
      }
      result.set(entry.item.id, { lane: entry.lane, lanes, span });
    }
    cluster = [];
    laneEnds = [];
    clusterBottom = Number.NEGATIVE_INFINITY;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.top >= clusterBottom) flush();
    let lane = laneEnds.findIndex((end) => end <= item.top);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.bottom);
    } else {
      laneEnds[lane] = item.bottom;
    }
    cluster.push({ item, lane });
    clusterBottom = Math.max(clusterBottom, item.bottom);
  }
  if (cluster.length > 0) flush();
  return result;
}

/** Inline position for a laned block (inside the column's 2px left / 6px right inset). */
export function laneStyle(placement: LanePlacement | undefined): Record<string, string> {
  if (!placement || placement.lanes <= 1) return {};
  const { lane, lanes, span } = placement;
  return {
    left: `calc(2px + (100% - 8px) * ${lane} / ${lanes})`,
    width: `calc((100% - 8px) * ${span} / ${lanes} - 2px)`,
    right: "auto",
  };
}
