/**
 * Pure gesture math shared by the phone primitives (sheet, swipe row, hold
 * button) and the screens built on them. No React, no DOM: every threshold
 * lives here so a screen never re-derives one.
 */

/** Movement under this many px is a tap, not a drag. */
export const SLOP = 8;
/** Width of one swipe-row action. */
export const ROW_ACTION_WIDTH = 76;
/** A sheet dragged down further than this closes (or drops a detent). */
export const SHEET_CLOSE_DY = 90;
/** A sheet dragged up further than this (negative px) expands a detent. */
export const SHEET_EXPAND_DY = -50;
/** How long a destructive action must be held. */
export const HOLD_MS = 1200;

/** Which axis a drag commits to once it passes SLOP; null while undecided. Ties go to "y" so scrolling wins. */
export function dragAxis(
	dx: number,
	dy: number,
	slop = SLOP,
): "x" | "y" | null {
	const ax = Math.abs(dx);
	const ay = Math.abs(dy);
	if (Math.max(ax, ay) < slop) return null;
	return ax > ay ? "x" : "y";
}

/** Past [min, max] the overshoot moves at a quarter speed. */
export function rubberband(value: number, min: number, max: number): number {
	if (value > max) return max + (value - max) / 4;
	if (value < min) return min + (value - min) / 4;
	return value;
}

/** Row offset after release: open (-width) when released past half, else closed (0). */
export function settleRow(offset: number, actionsWidth: number): number {
	return offset < -actionsWidth / 2 ? -actionsWidth : 0;
}

export type Detent = "half" | "full";

/** Where a sheet goes after a vertical drag of `dy` px (down is positive). */
export function settleSheet(
	dy: number,
	detent: Detent,
	detents: readonly Detent[],
): Detent | "closed" {
	if (dy > SHEET_CLOSE_DY) {
		return detent === "full" && detents.includes("half") ? "half" : "closed";
	}
	if (dy < SHEET_EXPAND_DY && detent === "half" && detents.includes("full")) {
		return "full";
	}
	return detent;
}
