import type { CommandItem } from "@/lib/command-center/items";
import { type ScoredItem, rankCommandItems } from "@/lib/command-center/search";
import { PUBLIC_API_URL } from "@/lib/public-api";

/**
 * The semantic half of the docs search: a weak text search asks the API which
 * section a phrasing is about, and the answer joins the ordinary result rows.
 * Nothing here renders; a match is looked up in the same pool as every other
 * hit, so it shows up as an ordinary row.
 */

export type FindMatch = {
	href: string;
	anchor?: string;
	title: string;
	confidence: number;
};

/** At or above this the match leads the list and is what Enter opens. */
export const FIND_LEAD = 0.85;
/** Between this and FIND_LEAD the match joins the list after the strong text hits. */
export const FIND_JOIN = 0.5;
const MIN_WORDS = 3;
const MIN_CHARS = 12;
const MAX_CHARS = 200;

/** No text hit, or the best one only matched by keyword or loose letters. */
export function isWeakSearch(text: string, pool: CommandItem[]): boolean {
	const top = rankCommandItems(text, pool, new Map()).flat.find(
		(s) => s.item.id !== "docs:fallback",
	);
	return !top || top.range === null;
}

/** Long enough to be a question, short enough for the API, and weak locally. */
export function shouldFind(text: string, weak: boolean): boolean {
	const t = text.trim();
	if (!weak || t.length > MAX_CHARS) return false;
	return t.split(/\s+/).length >= MIN_WORDS || t.length >= MIN_CHARS;
}

/** The pool row a match points at: its section, else its page. */
export function matchItem(
	match: FindMatch,
	byId: Map<string, CommandItem>,
): CommandItem | null {
	const id = match.anchor
		? `docs:${match.href}#${match.anchor}`
		: `docs:${match.href}`;
	return byId.get(id) ?? null;
}

/**
 * Local hits plus the match. Confident: the match leads. Fair: it follows the
 * last strong text hit (a hit that matched the label). Otherwise nothing
 * changes. `selectedId` is the row the reader arrowed onto, if any; it keeps
 * its identity and the returned index follows it. With no such row the first
 * row is selected, so Enter opens the lead.
 */
export function mergeFind({
	hits,
	match,
	item,
	selectedId,
	max,
}: {
	hits: ScoredItem[];
	match: FindMatch | null;
	item: CommandItem | null;
	selectedId: string | null;
	max: number;
}): { items: CommandItem[]; selected: number } {
	const local = hits.map((h) => h.item);
	let items = local.slice(0, max);
	if (match && item && match.confidence >= FIND_JOIN) {
		const rest = hits.filter((h) => h.item.id !== item.id);
		if (match.confidence >= FIND_LEAD) {
			items = [item, ...rest.map((h) => h.item)].slice(0, max);
		} else {
			let after = 0;
			rest.forEach((h, i) => {
				if (h.range !== null) after = i + 1;
			});
			const merged = rest.map((h) => h.item);
			merged.splice(after, 0, item);
			items = merged.slice(0, max);
		}
	}
	const kept = selectedId ? items.findIndex((i) => i.id === selectedId) : -1;
	return { items, selected: Math.max(kept, 0) };
}

const cache = new Map<string, FindMatch | null>();

const cacheKey = (text: string) =>
	text.trim().toLowerCase().replace(/\s+/g, " ");

/** Settled answers of this tab: `undefined` = never asked, `null` = asked, nothing. */
export function cachedFind(text: string): FindMatch | null | undefined {
	return cache.get(cacheKey(text));
}

function isMatch(value: unknown): value is FindMatch {
	const v = value as FindMatch | null;
	return (
		!!v &&
		typeof v.href === "string" &&
		typeof v.title === "string" &&
		typeof v.confidence === "number" &&
		(v.anchor === undefined || typeof v.anchor === "string")
	);
}

/**
 * Asks the API. Resolves the match (or null) and remembers it; rejects on any
 * error, 429, or abort so callers can stay silent and keep the text results.
 */
export async function requestFind(
	text: string,
	signal: AbortSignal,
): Promise<FindMatch | null> {
	const q = text.trim();
	const res = await fetch(`${PUBLIC_API_URL}/api/public/docs-find`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ q }),
		credentials: "omit",
		signal,
	});
	if (!res.ok) throw new Error(`docs-find ${res.status}`);
	const body = (await res.json()) as { match?: unknown };
	const match = isMatch(body.match) ? body.match : null;
	cache.set(cacheKey(q), match);
	return match;
}
