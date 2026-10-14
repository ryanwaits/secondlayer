/**
 * Automatic reference links: no annotation, the build links what the
 * reference knows. SDK method paths and exported types point at their
 * reference entry; endpoint paths in shell commands point at their API page
 * anchor. A link is only emitted when its page exists, so reference pages can
 * land later without touching this code.
 */

export type LinkTable = {
	/** `sl.streams.events.consume` and type names, to their reference anchor. */
	symbols: ReadonlyMap<string, string>;
	/** Endpoint path templates, most specific first. */
	endpoints: readonly { pattern: RegExp; href: string }[];
};

export type LinkInput = {
	/** `symbols` of each generated reference index. */
	symbols: Record<string, string>;
	endpoints: { path: string; href: string }[];
	/** Pathnames of the pages that exist. */
	routes: ReadonlySet<string>;
};

export type AutoLink = { start: number; end: number; href: string };

const pathnameOf = (href: string) => href.split("#")[0] ?? "";

/** Segments that are literal text; the more there are, the more specific the template. */
const literalSegments = (path: string) =>
	path.split("/").filter((s) => s && !s.startsWith("{")).length;

function templatePattern(path: string): RegExp {
	const body = path
		.split("/")
		.map((s) =>
			s.startsWith("{") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		)
		.join("/");
	return new RegExp(`^${body}$`);
}

/** Keep what resolves to a real page; the rest stays plain text. */
export function buildLinkTable(input: LinkInput): LinkTable {
	const symbols = new Map(
		Object.entries(input.symbols).filter(([, href]) =>
			input.routes.has(pathnameOf(href)),
		),
	);
	const seen = new Set<string>();
	const endpoints = input.endpoints
		.filter((e) => {
			if (seen.has(e.path) || !input.routes.has(pathnameOf(e.href)))
				return false;
			seen.add(e.path);
			return true;
		})
		.sort(
			(a, b) =>
				literalSegments(b.path) - literalSegments(a.path) ||
				b.path.length - a.path.length,
		)
		.map((e) => ({ pattern: templatePattern(e.path), href: e.href }));
	return { symbols, endpoints };
}

const IDENT_CHAIN = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g;
const ENDPOINT_PATH = /\/(?:v1|api)(?:\/[^\s"'`?#\\)]*)?/g;
const SOURCE_LANGS = new Set(["typescript", "tsx", "javascript"]);

/** The longest dotted prefix of `chain` the table knows, or its first identifier. */
function symbolIn(chain: string, table: LinkTable): string | null {
	const parts = chain.split(".");
	for (let n = parts.length; n > 1; n--) {
		const path = parts.slice(0, n).join(".");
		if (table.symbols.has(path)) return path;
	}
	return table.symbols.has(parts[0] ?? "") ? (parts[0] as string) : null;
}

/**
 * Links for one line of a block. `linked` is the block's names already
 * linked, so each name links once per block; `taken` says whether a span is
 * already another range's (mark, callout, error, manual link).
 */
export function autoLinks(
	line: string,
	lang: string,
	table: LinkTable,
	linked: Set<string>,
	taken: (start: number, end: number) => boolean,
): AutoLink[] {
	const out: AutoLink[] = [];
	const add = (name: string, start: number, end: number, href: string) => {
		if (linked.has(name) || taken(start, end)) return;
		linked.add(name);
		out.push({ start, end, href });
	};
	if (SOURCE_LANGS.has(lang) && table.symbols.size) {
		for (const m of line.matchAll(IDENT_CHAIN)) {
			if (line[m.index - 1] === ".") continue;
			const name = symbolIn(m[0], table);
			const href = name ? table.symbols.get(name) : undefined;
			if (name && href) add(name, m.index, m.index + name.length, href);
		}
	} else if (lang === "bash") {
		for (const m of line.matchAll(ENDPOINT_PATH)) {
			const path = m[0].replace(/[.,;]+$/, "");
			const hit = table.endpoints.find((e) => e.pattern.test(path));
			if (hit) add(hit.href, m.index, m.index + path.length, hit.href);
		}
	}
	return out;
}
