/**
 * What a 404 visitor was probably looking for. Pure and dependency-free: the
 * not-found page runs it in the browser against the routes the server knows,
 * so a renamed or mistyped path lands on its page with no redirect map to keep.
 */

export type Route = { href: string; title: string };

/** Edit distance with adjacent swaps counting once (`skils` → `skills` is 1). */
export function editDistance(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	let prev2: number[] = [];
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				d = Math.min(d, (prev2[j - 2] ?? 0) + 1);
			}
			row.push(d);
		}
		prev2 = prev;
		prev = row;
	}
	return prev[b.length];
}

const clean = (path: string) =>
	decodeURIComponent(path)
		.toLowerCase()
		.replace(/[?#].*$/, "")
		.replace(/\.(md|html?)$/, "")
		.replace(/\/+$/, "");

const lastSegment = (path: string) => path.split("/").pop() ?? "";

const slug = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/** How far a missed path is from a route, 0 (same) to 1 (nothing shared). */
function distance(path: string, route: Route): number {
	const href = clean(route.href);
	// A deeper path under a real page (`/docs/webhooks/old-section`) wants that
	// page, the deepest one first. Section roots (`/docs`, `/account`) don't
	// count, or they'd beat every typo under them.
	if (href.split("/").length > 2 && path.startsWith(`${href}/`)) {
		return 0.2 - href.length / 1000;
	}
	const seg = lastSegment(path);
	const ratio = (a: string, b: string) =>
		editDistance(a, b) / Math.max(a.length, b.length, 1);
	return Math.min(
		ratio(path, href),
		ratio(seg, lastSegment(href)),
		ratio(seg, slug(route.title)),
	);
}

/** Close enough to send someone there: about one typo in three characters. */
const MAX_DISTANCE = 0.34;

/**
 * Routes ranked by how likely the missed path meant them, best first. Only
 * plausible matches come back, so an empty list means "no idea" and the page
 * should fall back to its home.
 */
export function closestRoutes(
	path: string,
	routes: readonly Route[],
	limit = 3,
): Route[] {
	const p = clean(path);
	return routes
		.map((route, i) => ({ route, i, d: distance(p, route) }))
		.filter((r) => r.d <= MAX_DISTANCE)
		.sort((a, b) => a.d - b.d || a.i - b.i)
		.slice(0, limit)
		.map((r) => r.route);
}

/** The words in a missed path, for a docs search: `/docs/webhook-retries` → `webhook retries`. */
export function pathQuery(path: string, prefix = ""): string {
	return clean(path)
		.slice(prefix.length)
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length > 1 && !/^\d+$/.test(w))
		.join(" ");
}

const sharedPrefix = (a: string, b: string) => {
	let i = 0;
	while (i < a.length && a[i] === b[i]) i++;
	return i;
};

/**
 * Swap each search token the index doesn't know for its nearest known one,
 * so a typo still finds its sections. Short words get one edit, longer two;
 * on a tie the word sharing the longer start wins (`skil` → `skill`, not `skip`).
 */
export function correctTokens(
	tokens: readonly string[],
	vocabulary: ReadonlySet<string>,
): string[] {
	return tokens.map((t) => {
		if (vocabulary.has(t)) return t;
		const budget = t.length > 5 ? 2 : 1;
		let best = t;
		let bestD = budget + 1;
		let bestP = -1;
		for (const v of vocabulary) {
			if (Math.abs(v.length - t.length) > budget) continue;
			const d = editDistance(t, v);
			const p = sharedPrefix(t, v);
			if (d < bestD || (d === bestD && p > bestP)) {
				best = v;
				bestD = d;
				bestP = p;
			}
		}
		return bestD <= budget ? best : t;
	});
}
