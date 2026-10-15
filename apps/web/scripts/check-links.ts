/**
 * Walks a running site breadth-first over same-origin links and fails on any
 * non-2xx page or missing #anchor.
 *
 * Usage: bun scripts/check-links.ts http://localhost:3100
 */

export {};

const base = (process.argv[2] ?? "http://localhost:3100").replace(/\/$/, "");
const MAX_PAGES = 3000;

const SEEDS = [
	"/",
	"/p/index",
	"/p/streams",
	"/p/subgraphs",
	"/p/webhooks",
	"/p/archive",
	"/verify",
	"/pricing",
	"/docs",
	"/blog",
	"/login",
	"/auth/verify",
	"/robinhood",
	"/account",
];

const SKIP_PREFIXES = ["/api/", "/ingest/", "/_next/", "/og/", "/feed.xml"];

/** `path#anchor` pairs whose anchor is created client-side. Keep short. */
const ALLOW_ANCHORS: string[] = [];

const seen = new Set<string>();
const queue: string[] = [];
const htmlIds = new Map<string, Set<string>>();
const anchorRefs: { from: string; to: string; anchor: string }[] = [];
const broken: string[] = [];

function enqueue(path: string) {
	if (seen.has(path) || SKIP_PREFIXES.some((p) => path.startsWith(p))) return;
	seen.add(path);
	queue.push(path);
}

function norm(href: string): { path: string; anchor: string } | null {
	if (!href.startsWith("/") || href.startsWith("//")) return null;
	const [rest, anchor = ""] = href.split("#");
	const path = (rest || "/").replace(/&amp;/g, "&");
	return { path: path.length > 1 ? path.replace(/\/$/, "") : path, anchor };
}

for (const s of SEEDS) enqueue(s);

while (queue.length > 0 && seen.size <= MAX_PAGES) {
	const path = queue.shift() as string;
	const res = await fetch(base + path, { redirect: "follow" });
	const finalUrl = new URL(res.url);
	const finalPath = finalUrl.pathname;
	// Signed-out account pages redirect to /login: that is fine.
	if (!res.ok) {
		broken.push(`${res.status} ${path}`);
		continue;
	}
	const type = res.headers.get("content-type") ?? "";
	if (!type.includes("text/html")) continue;
	const html = await res.text();
	// An API page's endpoints open in a drawer rather than sit in the page, so
	// their anchors are the rows that open them.
	htmlIds.set(
		path,
		new Set(
			[
				...html.matchAll(/\b(?:id|name)="([^"]+)"/g),
				...html.matchAll(/\bhref="#([^"]+)"[^>]*\bdata-endpoint-row\b/g),
			].map((m) => m[1] as string),
		),
	);
	if (finalUrl.origin !== new URL(base).origin) continue;
	for (const m of html.matchAll(/\bhref="([^"]+)"/g)) {
		const link = norm(m[1] as string);
		if (!link) continue;
		if (link.anchor)
			anchorRefs.push({
				from: path,
				to: link.path || path,
				anchor: link.anchor,
			});
		enqueue(link.path);
	}
	void finalPath;
}

const missing: string[] = [];
for (const ref of anchorRefs) {
	const key = `${ref.to}#${ref.anchor}`;
	if (ALLOW_ANCHORS.includes(key)) continue;
	const ids = htmlIds.get(ref.to);
	if (ids && !ids.has(ref.anchor)) missing.push(`${ref.from} -> ${key}`);
}

for (const a of ALLOW_ANCHORS) console.log(`allowed anchor: ${a}`);
for (const b of broken) console.log(`BROKEN ${b}`);
for (const m of [...new Set(missing)]) console.log(`MISSING ANCHOR ${m}`);
console.log(
	`${seen.size} pages, ${broken.length} broken links, ${new Set(missing).size} missing anchors`,
);
process.exit(broken.length || missing.length ? 1 : 0);
