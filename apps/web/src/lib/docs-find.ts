import { PUBLIC_API_URL } from "@/lib/public-api";

/**
 * The semantic half of the docs search: when the text search is not sure, the
 * API embeds the query and returns the nearest sections by cosine. The browser
 * fuses that with its BM25 scores and re-ranks the same rows in place.
 * Nothing here renders.
 */

export type Scored = { id: string; score: number };
export type Nearest = { id: string; cos: number };
export type Fused = { id: string; score: number };

/** Weight of the embedding signal; BM25 gets the rest. */
const COS_WEIGHT = 0.5;
/** Fused top-1 minus top-2, in z units, at or above which the lead is trusted. */
export const FUSED_GAP = 0.8;
const MIN_WORDS = 3;
const MIN_CHARS = 12;
const MAX_CHARS = 200;

/** Long enough to be a question, short enough for the API, and BM25 unsure. */
export function shouldFind(text: string, sure: boolean): boolean {
	const t = text.trim();
	if (sure || t.length > MAX_CHARS) return false;
	return t.split(/\s+/).length >= MIN_WORDS || t.length >= MIN_CHARS;
}

/** z-scores of one signal over the union; a missing score counts as the signal's minimum. */
function zScores(
	ids: string[],
	scores: Map<string, number>,
): Map<string, number> {
	const present = [...scores.values()];
	const floor = present.length ? Math.min(...present) : 0;
	const values = ids.map((id) => scores.get(id) ?? floor);
	const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
	const variance =
		values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length || 1);
	const sd = Math.sqrt(variance) || 1;
	return new Map(ids.map((id, i) => [id, (values[i] - mean) / sd]));
}

/**
 * 50/50 blend of z-scored BM25 and cosine over the union of both lists, best
 * first. Ties keep BM25 order, then cosine order.
 */
export function fuse(bm25: Scored[], nearest: Nearest[]): Fused[] {
	const ids = [
		...new Set([...bm25.map((r) => r.id), ...nearest.map((r) => r.id)]),
	];
	const zb = zScores(ids, new Map(bm25.map((r) => [r.id, r.score])));
	const zc = zScores(ids, new Map(nearest.map((r) => [r.id, r.cos])));
	return ids
		.map((id) => ({
			id,
			score:
				(1 - COS_WEIGHT) * (zb.get(id) as number) +
				COS_WEIGHT * (zc.get(id) as number),
		}))
		.sort((a, b) => b.score - a.score);
}

/** The fused lead is trusted when it clears the runner-up by the gap. */
export function fusedSure(fused: { score: number }[]): boolean {
	return (
		fused.length > 0 &&
		(fused.length === 1 || fused[0].score - fused[1].score >= FUSED_GAP)
	);
}

/**
 * Re-ranks the visible rows by fused score. `pinned` is the row the reader is
 * on (arrowed or hovered) with the index it sits at: it keeps both, and the
 * rest fill the other slots in fused order.
 */
export function reorder<T extends { id: string }>({
	fused,
	items,
	shown,
	pinned,
	max,
}: {
	fused: Fused[];
	items: Map<string, T>;
	shown: T[];
	pinned: { id: string; index: number } | null;
	max: number;
}): T[] {
	const ranked = fused
		.map((f) => items.get(f.id))
		.filter((i): i is T => !!i)
		.slice(0, max);
	if (!pinned) return ranked;
	const keep = shown.find((i) => i.id === pinned.id);
	if (!keep) return ranked;
	const rest = ranked.filter((i) => i.id !== keep.id).slice(0, max - 1);
	rest.splice(Math.min(pinned.index, rest.length), 0, keep);
	return rest;
}

const cache = new Map<string, Nearest[]>();

const cacheKey = (text: string) =>
	text.trim().toLowerCase().replace(/\s+/g, " ");

/** Settled answers of this tab; `undefined` = never asked. */
export function cachedNearest(text: string): Nearest[] | undefined {
	return cache.get(cacheKey(text));
}

function isNearest(value: unknown): value is Nearest {
	const v = value as Nearest | null;
	return !!v && typeof v.id === "string" && typeof v.cos === "number";
}

/**
 * Asks the API for the nearest sections. Resolves the list and remembers it;
 * rejects on any error, 429, or abort so callers can stay silent and keep the
 * text results.
 */
export async function requestNearest(
	text: string,
	signal: AbortSignal,
): Promise<Nearest[]> {
	const q = text.trim();
	const res = await fetch(`${PUBLIC_API_URL}/api/public/docs-find`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ q }),
		credentials: "omit",
		signal,
	});
	if (!res.ok) throw new Error(`docs-find ${res.status}`);
	const body = (await res.json()) as { results?: unknown };
	const results = Array.isArray(body.results)
		? body.results.filter(isNearest)
		: [];
	cache.set(cacheKey(q), results);
	return results;
}
