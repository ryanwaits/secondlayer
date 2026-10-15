/** Which outline heading is the place being read. `tops` are the headings'
 *  viewport tops in document order; a heading counts once its top reaches
 *  `line`. At the scroll end the last heading wins, so short closing sections
 *  still light. Returns -1 when there are no headings. */
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

/** True once the window is scrolled to within 2px of the page's end. */
export function isAtScrollEnd(
	scrollY: number,
	innerHeight: number,
	scrollHeight: number,
): boolean {
	return scrollY + innerHeight >= scrollHeight - 2;
}
