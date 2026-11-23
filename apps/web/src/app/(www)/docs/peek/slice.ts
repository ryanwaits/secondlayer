export type Child = {
	tag: string;
	className: string;
	id: string;
};

export type Range = { start: number; end: number };

const isWrap = (child: Child) =>
	child.className.includes("section-heading-wrap");

const ENDS: Record<string, readonly string[]> = {
	h3: ["h3"],
	h4: ["h4", "h3"],
};

export function sectionRange(children: Child[], id: string): Range | null {
	if (!id) return null;
	const at = children.findIndex((child) => child.id === id);
	if (at < 0) return null;
	const head = children[at];
	const ends = isWrap(head) ? [] : (ENDS[head.tag] ?? null);
	if (!ends && !isWrap(head)) return null;
	let end = at + 1;
	while (end < children.length) {
		const child = children[end];
		if (isWrap(child) || ends?.includes(child.tag)) break;
		end++;
	}
	return { start: at + 1, end };
}

export function ledeRange(children: Child[]): Range | null {
	const title = children.findIndex(
		(child) => child.tag === "h1" && child.className.includes("page-title"),
	);
	if (title < 0) return null;
	let end = title + 1;
	while (end < children.length && children[end].tag === "p") end++;
	return { start: title + 1, end };
}
