/**
 * Single source of truth for the marketing navigation.
 *
 * The bar, the mobile sheet and the active-route test all read this array, so
 * a route only has to be described once. Groups render as hover panels on
 * desktop and as collapsed accordions in the mobile sheet.
 *
 * This module must stay free of server-only imports — marketing-nav.tsx is a
 * client component, so anything reachable from here lands in the browser
 * bundle. The Explore panel's live fetch lives in ./nav-live.ts for that
 * reason; only the NavSubgraph shape crosses back over.
 */

export interface NavItem {
	label: string;
	href: string;
	/** One line of panel copy — the flat bar had nowhere to put this. */
	desc: string;
}

export interface NavGroup {
	label: string;
	/** Present when the group label is itself a destination (Docs). */
	href?: string;
	/**
	 * Mono caption at the top of the panel. Says what the trigger label can't
	 * ("Products" → "Build on"), and doubles as the panel's top buffer: it puts
	 * a non-interactive row where the cursor lands coming off the trigger, so
	 * the panel can tuck up under the bar without a link sitting under it.
	 */
	caption: string;
	items: NavItem[];
	/** Muted strip along the bottom of the panel. */
	foot?: string;
	/** Append the live public-subgraph rows under a rule (Explore only). */
	live?: boolean;
}

export interface NavLink {
	label: string;
	href: string;
}

export type NavEntry = NavGroup | NavLink;

export function isGroup(entry: NavEntry): entry is NavGroup {
	return "items" in entry;
}

export const NAV: NavEntry[] = [
	{
		label: "Products",
		caption: "Build on",
		items: [
			{
				label: "Index",
				href: "/indexes",
				desc: "Every Stacks block, tx and event",
			},
			{
				label: "Subgraphs",
				href: "/subgraphs",
				desc: "Your own tables from contract events",
			},
			{ label: "Streams", href: "/streams", desc: "Pull the raw event log" },
			{
				label: "Subscriptions",
				href: "/subscriptions",
				desc: "Signed webhooks for matched events",
			},
		],
	},
	{
		label: "Explore",
		caption: "See it running",
		live: true,
		foot: "no key needed",
		items: [
			{
				label: "sBTC peg explorer",
				href: "/sbtc",
				desc: "Deposits, withdrawals, live peg balance",
			},
			{
				label: "All public subgraphs",
				href: "/subgraphs/explore",
				desc: "Every published view, queryable in browser",
			},
		],
	},
	{
		label: "Developers",
		href: "/docs",
		caption: "Reference",
		items: [
			// The bar no longer says "Docs" anywhere, so the panel says it — the
			// label itself also navigates to /docs on click.
			{
				label: "Documentation",
				href: "/docs",
				desc: "Guides, concepts and reference",
			},
			{
				label: "Quickstart",
				href: "/docs/quickstart",
				desc: "First query in five minutes",
			},
			{
				label: "API reference",
				href: "/docs/api-reference",
				desc: "REST endpoints and OpenAPI",
			},
			{
				label: "CLI & SDK",
				href: "/docs/cli",
				desc: "TypeScript, local devnet",
			},
			{
				label: "MCP server",
				href: "/docs/mcp",
				desc: "Point an agent at your data",
			},
			{
				label: "Migrate from Chainhook",
				href: "/docs/migrate-chainhook",
				desc: "Predicate-to-trigger mapping",
			},
		],
	},
	{
		label: "Resources",
		caption: "Stay current",
		items: [
			{
				label: "Writing",
				href: "/writing",
				desc: "Notes on indexing Stacks",
			},
			{
				label: "Changelog",
				href: "/docs/changelog",
				desc: "What shipped, when",
			},
			{
				label: "Status",
				href: "/status",
				desc: "Indexer lag and system health",
			},
		],
	},
	{ label: "Pricing", href: "/pricing" },
];

/**
 * The "leave docs" strip.
 *
 * Docs has its own chrome — a sidebar that owns sub-navigation and a top strip
 * with nowhere to hang a hover panel — so it stays flat rather than mirroring
 * the marketing bar's groups. Its job is the way back out to the product
 * pages, which is why there's no Docs entry here: it pointed at the page you
 * were already on, and the sidebar already says where you are.
 */
export const DOCS_STRIP: NavLink[] = [
	{ label: "Index", href: "/indexes" },
	{ label: "Subgraphs", href: "/subgraphs" },
	{ label: "Streams", href: "/streams" },
	{ label: "Subscriptions", href: "/subscriptions" },
	{ label: "Explore", href: "/subgraphs/explore" },
	{ label: "Pricing", href: "/pricing" },
];

function matches(pathname: string, href: string): boolean {
	if (href === "/") return pathname === "/";
	return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The most specific nav href the current path sits under, or null.
 *
 * Longest match wins, which is what lets /subgraphs/explore beat /subgraphs
 * without the hand-written exception the flat array needed.
 */
export function activeHref(pathname: string): string | null {
	let best: string | null = null;
	for (const entry of NAV) {
		const hrefs = isGroup(entry)
			? entry.items.map((i) => i.href)
			: [entry.href];
		for (const href of hrefs) {
			if (matches(pathname, href) && (!best || href.length > best.length)) {
				best = href;
			}
		}
	}
	return best;
}

/** Index of the group holding the active route — the one the sheet opens on. */
export function activeGroupIndex(pathname: string): number {
	const active = activeHref(pathname);
	if (!active) return -1;
	return NAV.findIndex(
		(entry) => isGroup(entry) && entry.items.some((i) => i.href === active),
	);
}

/** A live public subgraph row in the Explore panel. Populated by nav-live.ts. */
export interface NavSubgraph {
	name: string;
	/** Pre-formatted for display — the nav never does math on this. */
	rows: string;
}
