export type AxisMarker<T> = T & { pos: number };

export type MarkerGroup<T> = {
	pos: number;
	members: AxisMarker<T>[];
};

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
