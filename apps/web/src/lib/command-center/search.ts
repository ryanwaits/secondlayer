import {
	type CommandGroup,
	type CommandItem,
	DOCS_FALLBACK,
	GROUP_CAP,
	GROUP_ORDER,
} from "./items";

/**
 * Ranking: exact prefix > word-boundary prefix > substring (earlier is
 * better) > character subsequence. Frecency breaks ties; it never makes a
 * non-match appear. Pure functions over in-memory arrays — the <30ms
 * budget lives or dies here, so no regexes in the hot path.
 */

export interface ScoredItem {
	item: CommandItem;
	score: number;
	/** [start, end) highlight range in the label for substring-class matches. */
	range: [number, number] | null;
}

export interface ResultGroup {
	group: CommandGroup;
	items: ScoredItem[];
}

function scoreText(q: string, text: string): ScoredItem["score"] {
	const idx = text.indexOf(q);
	if (idx === 0) return 400;
	if (idx > 0) {
		const boundary = text[idx - 1] === " " || text[idx - 1] === "-";
		return (boundary ? 300 : 200) - Math.min(idx, 50);
	}
	// subsequence
	let qi = 0;
	for (let i = 0; i < text.length && qi < q.length; i++) {
		if (text[i] === q[qi]) qi++;
	}
	return qi === q.length ? 50 : 0;
}

export function scoreItem(q: string, item: CommandItem): ScoredItem | null {
	const label = item.label.toLowerCase();
	const labelScore = scoreText(q, label);
	if (labelScore >= 200 || labelScore === 400) {
		const idx = label.indexOf(q);
		return { item, score: labelScore, range: [idx, idx + q.length] };
	}
	let best = labelScore; // 50 (subsequence) or 0
	for (const k of item.keywords ?? []) {
		const s = scoreText(q, k.toLowerCase());
		if (s > best) best = Math.min(s, 180); // keyword hits rank below label hits
	}
	if (item.sub) {
		const s = scoreText(q, item.sub.toLowerCase());
		if (s >= 200 && s > best) best = 160;
	}
	return best > 0 ? { item, score: best, range: null } : null;
}

export function rankCommandItems(
	rawQuery: string,
	all: CommandItem[],
	boosts: Map<string, number>,
): { groups: ResultGroup[]; flat: ScoredItem[] } {
	const q = rawQuery.trim().toLowerCase();
	const byGroup = new Map<CommandGroup, ScoredItem[]>();

	for (const item of all) {
		let scored: ScoredItem | null;
		if (!q) {
			scored = { item, score: 0, range: null };
		} else {
			scored = scoreItem(q, item);
			if (!scored) continue;
		}
		scored.score += boosts.get(item.id) ?? 0;
		const list = byGroup.get(item.group) ?? [];
		list.push(scored);
		byGroup.set(item.group, list);
	}

	const groups: ResultGroup[] = [];
	const flat: ScoredItem[] = [];
	for (const g of GROUP_ORDER) {
		const list = (byGroup.get(g) ?? [])
			.sort((a, b) => b.score - a.score)
			.slice(0, GROUP_CAP);
		if (list.length === 0) continue;
		groups.push({ group: g, items: list });
		flat.push(...list);
	}

	if (q && flat.length === 0) {
		const fallback: ScoredItem = { item: DOCS_FALLBACK, score: 0, range: null };
		return { groups: [{ group: "docs", items: [fallback] }], flat: [fallback] };
	}

	return { groups, flat };
}
