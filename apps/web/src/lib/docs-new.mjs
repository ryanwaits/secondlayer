/**
 * "New" marks on docs pages. A mark is an MDX comment on the line directly
 * above a heading: `{/* new: 2026-10-15 *\/}`. Above a `##` it puts a "New"
 * chip on that section's row in the sidebar outline; above the page's `#`
 * title it puts one on the page's own row. A chip shows for NEW_DAYS after
 * the mark's date, then drops off on its own.
 *
 * Nobody writes marks by hand: the pre-commit hook (`scripts/docs-new.ts`)
 * stamps each `##` a commit adds and each page it creates, and strips marks
 * that have expired. Plain JS so the remark plugin, the hook script and the
 * sidebar share one copy.
 */

/** How long a mark keeps its chip. */
export const NEW_DAYS = 30;

const DAY_MS = 86_400_000;

/** The mark's own line, with its date captured. */
export const NEW_MARK = /^\{\/\*\s*new:\s*(\d{4}-\d{2}-\d{2})\s*\*\/\}\s*$/;

/** The same mark as remark sees it: the expression's body, braces gone. */
export const NEW_MARK_BODY = /^\s*\/\*\s*new:\s*(\d{4}-\d{2}-\d{2})\s*\*\/\s*$/;

/** @param {string} date */
export const newMark = (date) => `{/* new: ${date} */}`;

/**
 * Whether a mark dated `date` still shows its chip at `now` (ms).
 * @param {string | undefined} date
 * @param {number} now
 */
export function isFresh(date, now) {
	if (!date) return false;
	const at = Date.parse(date);
	return Number.isFinite(at) && now >= at && now - at < NEW_DAYS * DAY_MS;
}

/**
 * The headings of some MDX outside code fences, by level and raw text.
 * @param {string} source
 */
function headings(source) {
	/** @type {{ index: number, level: number, text: string }[]} */
	const out = [];
	let fence = null;
	source.split("\n").forEach((line, index) => {
		const mark = /^\s*(```+|~~~+)/.exec(line)?.[1];
		if (mark) {
			if (!fence) fence = mark[0];
			else if (mark[0] === fence) fence = null;
			return;
		}
		if (fence) return;
		const h = /^(#{1,2})\s+(.+?)\s*#*\s*$/.exec(line);
		if (h) out.push({ index, level: h[1].length, text: h[2] });
	});
	return out;
}

/**
 * Stamps a page as a commit leaves it. `before` is the committed source (null
 * for a page this commit creates). A new page gets one mark on its title, not
 * one per section; on an existing page each `##` whose text `before` lacks
 * gets one. Expired marks go. Returns the source unchanged when nothing
 * applies, so running it twice is a no-op.
 * @param {string | null} before
 * @param {string} after
 * @param {string} today YYYY-MM-DD
 */
export function stampNewMarks(before, after, today) {
	const now = Date.parse(today);
	const known = new Set(
		before === null
			? []
			: headings(before)
					.filter((h) => h.level === 2)
					.map((h) => h.text),
	);
	const lines = after.split("\n");
	const stampAt = new Set(
		headings(after)
			.filter((h) =>
				before === null ? h.level === 1 : h.level === 2 && !known.has(h.text),
			)
			.map((h) => h.index),
	);
	/** @type {string[]} */
	const out = [];
	lines.forEach((line, i) => {
		const mark = NEW_MARK.exec(line);
		if (mark && !isFresh(mark[1], now)) return;
		if (stampAt.has(i) && !NEW_MARK.test(lines[i - 1] ?? "")) {
			out.push(newMark(today));
		}
		out.push(line);
	});
	return out.join("\n");
}

/**
 * The date of the mark on a page's `#` title, or null.
 * @param {string} source
 */
export function pageNewDate(source) {
	const lines = source.split("\n");
	const title = headings(source).find((h) => h.level === 1);
	if (!title) return null;
	return NEW_MARK.exec(lines[title.index - 1] ?? "")?.[1] ?? null;
}
