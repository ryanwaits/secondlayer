import { ValidationError } from "@secondlayer/shared/errors";

/** Reject requests with query params outside the allowed set.
 *  Throws ValidationError → 400 JSON via global error handler. */
export function validateQueryParams(
	query: URLSearchParams,
	allowed: readonly string[],
): void {
	const allowedSet = new Set(allowed);
	for (const key of query.keys()) {
		if (allowedSet.has(key)) continue;
		const suggestion = findSimilar(key, allowed);
		const hint = suggestion
			? `did you mean "${suggestion}"?`
			: `allowed: ${allowed.join(", ")}`;
		throw new ValidationError(`unknown query param: ${key} (${hint})`);
	}
}

function findSimilar(key: string, allowed: readonly string[]): string | null {
	let best: { key: string; dist: number } | null = null;
	for (const candidate of allowed) {
		const dist = levenshtein(key.toLowerCase(), candidate.toLowerCase());
		if (dist <= 2 && (!best || dist < best.dist)) {
			best = { key: candidate, dist };
		}
	}
	return best?.key ?? null;
}

function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	const prev = new Array<number>(n + 1);
	const curr = new Array<number>(n + 1);
	for (let j = 0; j <= n; j++) prev[j] = j;
	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(
				(curr[j - 1] ?? 0) + 1,
				(prev[j] ?? 0) + 1,
				(prev[j - 1] ?? 0) + cost,
			);
		}
		for (let j = 0; j <= n; j++) prev[j] = curr[j] ?? 0;
	}
	return prev[n] ?? 0;
}
