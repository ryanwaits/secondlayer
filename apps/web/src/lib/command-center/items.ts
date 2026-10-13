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

/** The docs field's per-section rows: one per `##`/`###` heading, sub = its page. */
export function docsHeadingItems(
	index: { href: string; anchor: string; title: string }[],
	titleFor: (href: string) => string,
): CommandItem[] {
	return index.map((h) => ({
		id: `docs:${h.href}#${h.anchor}`,
		group: "docs" as const,
		label: h.title,
		sub: titleFor(h.href),
		href: `${h.href}#${h.anchor}`,
	}));
}

/** One row per generated API endpoint, jumping into the reference. */
export function docsEndpointItems(
	nav: {
		tag: string;
		endpoints: { anchor: string; method: string; title: string }[];
	}[],
): CommandItem[] {
	return nav.flatMap((group) =>
		group.endpoints.map((e) => ({
			id: `docs:/docs/api-reference#${e.anchor}`,
			group: "docs" as const,
			label: e.title,
			sub: "endpoint",
			href: `/docs/api-reference#${e.anchor}`,
			keywords: [e.method, group.tag],
		})),
	);
}

/** The docs field's whole search pool: pages, sections, and API endpoints. */
export function docsSearchPool(
	headings: { href: string; anchor: string; title: string }[],
	apiNav: Parameters<typeof docsEndpointItems>[0],
): CommandItem[] {
	const titles = new Map(DOCS_ITEMS.map((i) => [i.href, i.label]));
	return [
		...DOCS_ITEMS,
		...docsHeadingItems(headings, (href) => titles.get(href) ?? href),
		...docsEndpointItems(apiNav),
	];
}
