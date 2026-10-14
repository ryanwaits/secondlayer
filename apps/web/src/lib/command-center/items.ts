import { apiPageHref, pageForTag } from "@/app/(www)/docs/api-reference/pages";
import { docsNavPages } from "@/app/(www)/docs/nav";
import { actions } from "@/lib/actions/registry";

/**
 * Unified result model for the command center. Every item OPENS a page —
 * there are no verbs, no writes, no drill-downs (see
 * docs/specs/command-center.spec.md §2).
 */

export type CommandGroup =
	| "navigation"
	| "your subgraphs"
	| "webhooks"
	| "docs";

/** Fixed render order; empty groups collapse. */
export const GROUP_ORDER: CommandGroup[] = [
	"navigation",
	"your subgraphs",
	"webhooks",
	"docs",
];

export const GROUP_CAP = 5;

export interface CommandItem {
	id: string;
	group: CommandGroup;
	label: string;
	/** Mono context line: status · rows, table target, docs section. */
	sub?: string;
	badge?: { text: string; tone: "live" | "warn" | "muted" };
	href?: string;
	newTab?: boolean;
	keywords?: string[];
	/** Registry actions with side effects (logout) instead of an href. */
	actionId?: string;
}

export const NAV_ITEMS: CommandItem[] = actions.map((a) => ({
	id: `nav:${a.id}`,
	group: "navigation",
	label: a.label,
	href: a.href,
	keywords: [...a.keywords, a.category.toLowerCase()],
	actionId: a.id,
}));

/** Vocabulary users reach for that page titles don't carry. */
const DOCS_KEYWORDS: Record<string, string[]> = {
	"/docs/webhooks": ["webhook", "webhooks", "push"],
	"/docs/index": ["events", "transfers", "decoded"],
	"/docs/streams": ["firehose", "dumps", "raw"],
	"/docs/subgraphs": ["indexer", "deploy", "tables"],
};

export const DOCS_ITEMS: CommandItem[] = docsNavPages().map((page) => ({
	id: `docs:${page.href}`,
	group: "docs" as const,
	label: page.title,
	sub: page.group.toLowerCase(),
	href: page.href,
	newTab: true,
	keywords: [
		"docs",
		page.group.toLowerCase(),
		...(DOCS_KEYWORDS[page.href] ?? []),
	],
}));

/** Fallback row when nothing matches — discovery never dead-ends. */
export const DOCS_FALLBACK: CommandItem = {
	id: "docs:fallback",
	group: "docs",
	label: "Open docs",
	sub: "nothing matched",
	href: "/docs",
	newTab: true,
};

/**
 * Plain-language queries written per section at build time (`bun run
 * docs:phrasings`), keyed by `href#anchor` or `href`. They match as keywords,
 * so a paraphrase finds its section with no model call at search time.
 */
export type Phrasings = Record<string, { phrasings: string[] }>;

/** The docs field's per-section rows: one per `##`/`###` heading, sub = its page. */
export function docsHeadingItems(
	index: { href: string; anchor: string; title: string }[],
	titleFor: (href: string) => string,
	phrasings: Phrasings = {},
): CommandItem[] {
	return index.map((h) => ({
		id: `docs:${h.href}#${h.anchor}`,
		group: "docs" as const,
		label: h.title,
		sub: titleFor(h.href),
		href: `${h.href}#${h.anchor}`,
		keywords: phrasings[`${h.href}#${h.anchor}`]?.phrasings,
	}));
}

/** One row per generated API endpoint, jumping to it on the API page that
 *  holds it (the page opens its drawer). */
export function docsEndpointItems(
	nav: {
		tag: string;
		endpoints: { anchor: string; method: string; title: string }[];
	}[],
): CommandItem[] {
	return nav.flatMap((group) => {
		const page = pageForTag(group.tag);
		if (!page) return [];
		const base = apiPageHref(page.slug);
		return group.endpoints.map((e) => ({
			id: `docs:${base}#${e.anchor}`,
			group: "docs" as const,
			label: e.title,
			sub: "endpoint",
			href: `${base}#${e.anchor}`,
			keywords: [e.method, group.tag],
		}));
	});
}

/** One row per SDK method, jumping to its entry on its surface's page. */
export function docsMethodItems(
	nav: { slug: string; methods: { anchor: string; path: string }[] }[],
): CommandItem[] {
	return nav.flatMap((surface) =>
		surface.methods.map((m) => {
			const href = `/docs/sdk-reference/${surface.slug}#${m.anchor}`;
			return {
				id: `docs:${href}`,
				group: "docs" as const,
				label: m.path,
				sub: "method",
				href,
				keywords: ["sdk", surface.slug],
			};
		}),
	);
}

/** The docs field's whole search pool: pages, sections, API endpoints and SDK methods. */
export function docsSearchPool(
	headings: { href: string; anchor: string; title: string }[],
	apiNav: Parameters<typeof docsEndpointItems>[0],
	phrasings: Phrasings,
	sdkNav: Parameters<typeof docsMethodItems>[0] = [],
): CommandItem[] {
	const titles = new Map(DOCS_ITEMS.map((i) => [i.href, i.label]));
	return [
		...DOCS_ITEMS.map((page) => ({
			...page,
			keywords: [
				...(page.keywords ?? []),
				...(page.href ? (phrasings[page.href]?.phrasings ?? []) : []),
			],
		})),
		...docsHeadingItems(
			headings,
			(href) => titles.get(href) ?? href,
			phrasings,
		),
		...docsEndpointItems(apiNav),
		...docsMethodItems(sdkNav),
	];
}
