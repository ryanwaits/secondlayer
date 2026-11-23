import { apiPageHref, pageForTag } from "@/app/(www)/docs/api-reference/pages";
import { docsNavPages } from "@/app/(www)/docs/nav";
import { actions } from "@/lib/actions/registry";

export type CommandGroup =
	| "navigation"
	| "your subgraphs"
	| "webhooks"
	| "docs";

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
	sub?: string;
	badge?: { text: string; tone: "live" | "warn" | "muted" };
	href?: string;
	newTab?: boolean;
	keywords?: string[];
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

export function docsMethodItems(
	nav: {
		page: string;
		keywords?: string[];
		methods: { anchor: string; path: string }[];
	}[],
): CommandItem[] {
	return nav.flatMap((page) =>
		page.methods.map((m) => {
			const href = `${page.page}#${m.anchor}`;
			return {
				id: `docs:${href}`,
				group: "docs" as const,
				label: m.path,
				sub: "method",
				href,
				keywords: page.keywords ?? [],
			};
		}),
	);
}

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
