/**
 * Where a section or a lede ends. A guide's sections are flat siblings in
 * `#docs-article`, so a heading's extent is a run of siblings, the way the
 * scope runtime walks them. These functions take the siblings as plain
 * descriptors and return index ranges, so the cutting is testable without a
 * DOM; `load.ts` builds the descriptors and clones the nodes.
 */

export type Child = {
	/** Lowercase tag name. */
	tag: string;
	className: string;
	/**
	 * The heading's id. A `##` renders as `div.section-heading-wrap > hr +
	 * h2#id`, so the wrap carries the id of the h2 inside it.
	 */
	id: string;
};

/** Children from `start` up to, not including, `end`. */
export type Range = { start: number; end: number };

const isWrap = (child: Child) =>
	child.className.includes("section-heading-wrap");

/** Which headings end a section that opens at `tag`; a wrap (`##`) ends every one. */
const ENDS: Record<string, readonly string[]> = {
	h3: ["h3"],
	h4: ["h4", "h3"],
};

/**
 * The siblings under the heading `id`, the heading itself left out because the
 * frame's bar names it. An h2 runs to the next wrap, an h3 to the next h3 or
 * wrap, an h4 to the next h4, h3 or wrap. Null when no child has that id.
 */
export function sectionRange(children: Child[], id: string): Range | null {
	if (!id) return null;
	const at = children.findIndex((child) => child.id === id);
	if (at < 0) return null;
	const head = children[at];
	const ends = isWrap(head) ? [] : (ENDS[head.tag] ?? null);
	// Only headings open a section; any other element with this id is not one.
	if (!ends && !isWrap(head)) return null;
	let end = at + 1;
	while (end < children.length) {
		const child = children[end];
		if (isWrap(child) || ends?.includes(child.tag)) break;
		end++;
	}
	return { start: at + 1, end };
}

/**
 * The `p` siblings right after the page title: the lede. It runs until the
 * first thing that is not a paragraph (a `<Yields>`, the first `##`). Empty
 * when the title is followed by something else; null when there is no title.
 */
export function ledeRange(children: Child[]): Range | null {
	const title = children.findIndex(
		(child) => child.tag === "h1" && child.className.includes("page-title"),
	);
	if (title < 0) return null;
	let end = title + 1;
	while (end < children.length && children[end].tag === "p") end++;
	return { start: title + 1, end };
}
