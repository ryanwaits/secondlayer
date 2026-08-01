/**
 * Label-collision helpers shared by the figure library. All positions are
 * percentages (0–100) of the drawable axis unless noted.
 */

export type AxisMarker<T> = T & { pos: number };

export type MarkerGroup<T> = {
	/** Render position for the merged flag — mean of member positions. */
	pos: number;
	members: AxisMarker<T>[];
};

/**
 * B1/B3 collision rule: markers within `threshold` percent of each other
 * merge their flags into one combined label. Input need not be sorted;
 * grouping is transitive (a–b close + b–c close → one group of three).
 */
export function mergeMarkers<T>(
	markers: AxisMarker<T>[],
	threshold = 8,
): MarkerGroup<T>[] {
	const sorted = [...markers].sort((a, b) => a.pos - b.pos);
	const groups: MarkerGroup<T>[] = [];
	for (const m of sorted) {
		const last = groups[groups.length - 1];
		const lastMember = last?.members[last.members.length - 1];
		if (lastMember && m.pos - lastMember.pos < threshold) {
			last.members.push(m);
			last.pos =
				last.members.reduce((s, x) => s + x.pos, 0) / last.members.length;
		} else {
			groups.push({ pos: m.pos, members: [m] });
		}
	}
	return groups;
}

/**
 * C1 end-label rule: nudge labels apart vertically until every pair is at
 * least `minGap` px apart, keeping all within [top, bottom]. Returns new
 * y positions in input order.
 */
export function resolveEndLabels(
	ys: number[],
	minGap = 14,
	top = 0,
	bottom = Number.POSITIVE_INFINITY,
): number[] {
	const order = ys
		.map((y, i) => ({ y, i }))
		.sort((a, b) => a.y - b.y || a.i - b.i);
	for (let k = 1; k < order.length; k++) {
		const prev = order[k - 1];
		const cur = order[k];
		if (cur.y - prev.y < minGap) cur.y = prev.y + minGap;
	}
	const overflow = order.length ? order[order.length - 1].y - bottom : 0;
	if (overflow > 0) {
		for (let k = order.length - 1; k >= 0; k--) {
			const cur = order[k];
			const next = order[k + 1];
			cur.y = Math.max(
				top + k * minGap,
				Math.min(cur.y - overflow, next ? next.y - minGap : cur.y - overflow),
			);
		}
	}
	const out: number[] = new Array(ys.length);
	for (const { y, i } of order) out[i] = y;
	return out;
}

/** Clamp a tooltip's left edge so the box stays inside the container. */
export function clampTooltipX(
	x: number,
	tooltipWidth: number,
	containerWidth: number,
	pad = 4,
): number {
	return Math.max(pad, Math.min(x, containerWidth - tooltipWidth - pad));
}
