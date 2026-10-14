/**
 * The SDK reference as one overview and one page per surface, in sidebar
 * order. Counts and member lists come from the generated reference; what is
 * kept here is only what no source file says: the page order, a one-line
 * blurb for the overview map, and which guide and API page each surface
 * answers to.
 */

export type SdkSurfacePageInfo = {
	slug: string;
	/** Sidebar and pager title. */
	title: string;
	/** What the overview map says under the surface's name. */
	blurb: string;
	/** The product guide, and the HTTP page serving the same data. */
	guide?: { title: string; href: string };
	api?: { title: string; href: string };
};

/** Pages generated from a surface file (`<slug>.json`), in sidebar order. */
export const SDK_SURFACES: SdkSurfacePageInfo[] = [
	{
		slug: "client",
		title: "Client",
		blurb: "Batched reads and the agent snapshot",
		guide: { title: "SDK guide", href: "/docs/sdk" },
		api: { title: "Instance API", href: "/docs/api/instance" },
	},
	{
		slug: "streams",
		title: "sl.streams",
		blurb: "Ordered events, cursors, dumps",
		guide: { title: "Streams guide", href: "/docs/streams" },
		api: { title: "Streams API", href: "/docs/api/streams" },
	},
	{
		slug: "index",
		title: "sl.index",
		blurb: "Decoded rows, sBTC, PoX-5, Runes",
		guide: { title: "Index guide", href: "/docs/index" },
		api: { title: "Index API", href: "/docs/api/index" },
	},
	{
		slug: "subgraphs",
		title: "sl.subgraphs",
		blurb: "Deploy, read rows, operations",
		guide: { title: "Subgraphs guide", href: "/docs/subgraphs" },
		api: { title: "Subgraphs API", href: "/docs/api/subgraphs" },
	},
	{
		slug: "webhooks",
		title: "sl.webhooks",
		blurb: "Create, deliveries, replay",
		guide: { title: "Webhooks guide", href: "/docs/webhooks" },
		api: { title: "Webhooks API", href: "/docs/api/webhooks" },
	},
	{
		slug: "archive",
		title: "sl.archive",
		blurb: "Verify, quote, fetch",
		guide: { title: "Archive guide", href: "/docs/archive" },
	},
	{
		slug: "contracts",
		title: "sl.contracts",
		blurb: "Find by trait, ABI",
		guide: { title: "Index guide", href: "/docs/index" },
	},
	{
		slug: "instance",
		title: "sl.instance",
		blurb: "Status, diagnose",
		guide: { title: "Self-host guide", href: "/docs/self-host" },
		api: { title: "Instance API", href: "/docs/api/instance" },
	},
];

export const SDK_BASE = "/docs/sdk-reference";

/** Function-first packages: one page each, sectioned by group instead of one page per surface. */
export type PackageKey = "subgraphs" | "verify" | "filters";

export type PackagePageInfo = {
	key: PackageKey;
	/** Where the page lives. */
	href: string;
	/** Sidebar and pager title. */
	title: string;
	/** What the import line says. */
	specifier: string;
	/** One line under each group's title, by group slug. */
	groups: Record<string, string>;
	guide?: { title: string; href: string };
};

/** The function-first reference pages, in sidebar order. */
export const PACKAGE_PAGES: PackagePageInfo[] = [
	{
		key: "subgraphs",
		href: "/docs/subgraphs-reference",
		title: "Subgraphs package",
		specifier: "@secondlayer/subgraphs",
		guide: { title: "Subgraphs guide", href: "/docs/subgraphs" },
		groups: {
			define:
				"Declare sources, tables and handlers, and check them before a deploy.",
			context:
				"The `ctx` every handler receives: write rows, read them back, call contracts.",
			"chain-read":
				"Read contract state from a handler, pinned to the block being processed.",
			schema:
				"The SQL and typed clients a subgraph's tables turn into, and the diff a deploy runs.",
			"block-sources": "Which block source a subgraph's filters allow.",
			verification:
				"The pin and the findings that say how far a subgraph's rows can be checked.",
			replay:
				"Re-run a subgraph from the archive and compare it with what is served.",
			testing: "Run a handler against fixture events without deploying.",
		},
	},
	{
		key: "verify",
		href: "/docs/verify-reference",
		title: "Verify package",
		specifier: "@secondlayer/verify",
		guide: { title: "Verify", href: "/docs/verification" },
		groups: {
			"verify-block":
				"Check one block against a checkpoint, with no trust in the node that served it.",
			sources: "Where proofs come from: the Secondlayer API or a Stacks node.",
			proofs: "The parsers and checks a block verification is built from.",
			bitcoin:
				"The Bitcoin header chain a Stacks block anchors to, and its checkpoint.",
		},
	},
	{
		key: "filters",
		href: "/docs/filters-reference",
		title: "Filters package",
		specifier: "@secondlayer/stacks/filters",
		guide: { title: "SDK guide", href: "/docs/sdk" },
		groups: {
			builders:
				"`on.*` builds one filter that every surface can project to its own shape.",
			identifiers:
				"Validate and narrow principals, contract ids and asset identifiers.",
			"event-types": "Every filter member and the spec each one takes.",
		},
	},
];

export function findPackagePage(key: PackageKey): PackagePageInfo {
	const page = PACKAGE_PAGES.find((p) => p.key === key);
	if (!page) throw new Error(`No reference package "${key}"`);
	return page;
}

export type SdkPage = { href: string; title: string };

/**
 * Every page of the reference in sidebar order: the SDK's overview, surfaces,
 * helpers and errors, then one page per function-first package.
 */
export function sdkPages(): SdkPage[] {
	return [
		{ href: SDK_BASE, title: "Overview" },
		...SDK_SURFACES.map((s) => ({
			href: `${SDK_BASE}/${s.slug}`,
			title: s.title,
		})),
		{ href: `${SDK_BASE}/helpers`, title: "Helpers" },
		{ href: `${SDK_BASE}/errors`, title: "Errors" },
		...PACKAGE_PAGES.map(({ href, title }) => ({ href, title })),
	];
}

export function findSurface(slug: string): SdkSurfacePageInfo | undefined {
	return SDK_SURFACES.find((s) => s.slug === slug);
}
