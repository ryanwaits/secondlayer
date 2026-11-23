export function activeHeading(
	tops: number[],
	line: number,
	atEnd: boolean,
): number {
	if (tops.length === 0) return -1;
	if (atEnd) return tops.length - 1;
	let active = 0;
	for (let i = 0; i < tops.length; i++) if (tops[i] <= line) active = i;
	return active;
}

export function isAtScrollEnd(
	scrollY: number,
	innerHeight: number,
	scrollHeight: number,
): boolean {
	return scrollY + innerHeight >= scrollHeight - 2;
}
