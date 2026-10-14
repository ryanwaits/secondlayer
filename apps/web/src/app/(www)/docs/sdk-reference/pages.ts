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

export type SdkPage = { href: string; title: string };

/** Every page of the reference in sidebar order: the overview, surfaces, then helpers and errors. */
export function sdkPages(): SdkPage[] {
	return [
		{ href: SDK_BASE, title: "Overview" },
		...SDK_SURFACES.map((s) => ({
			href: `${SDK_BASE}/${s.slug}`,
			title: s.title,
		})),
		{ href: `${SDK_BASE}/helpers`, title: "Helpers" },
		{ href: `${SDK_BASE}/errors`, title: "Errors" },
	];
}

export function findSurface(slug: string): SdkSurfacePageInfo | undefined {
	return SDK_SURFACES.find((s) => s.slug === slug);
}
