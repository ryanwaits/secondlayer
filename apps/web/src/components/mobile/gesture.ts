export const SLOP = 8;
export const ROW_ACTION_WIDTH = 76;
export const SHEET_CLOSE_DY = 90;
export const SHEET_EXPAND_DY = -50;
export const HOLD_MS = 1200;

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

export function rubberband(value: number, min: number, max: number): number {
	if (value > max) return max + (value - max) / 4;
	if (value < min) return min + (value - min) / 4;
	return value;
}

export function settleRow(offset: number, actionsWidth: number): number {
	return offset < -actionsWidth / 2 ? -actionsWidth : 0;
}

export type Detent = "half" | "full";

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

export const PULL_REFRESH_DY = 64;
