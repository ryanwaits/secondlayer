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
