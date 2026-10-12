/**
 * Single source for the marketing shell: the five products (names, verbs,
 * order, routes) and the top-bar links. The nav, footer, home spine and
 * "rest of the platform" all read this. Adding a product = one entry.
 *
 * Client-safe: marketing-nav.tsx and site-footer.tsx are client components.
 */

export interface Product {
	noun: string;
	verb: string;
	href: string;
	line: string;
}

export const PRODUCTS = [
	{
		noun: "Archive",
		verb: "verifies",
		href: "/p/archive",
		line: "Signed history. Check your copy free.",
	},
	{
		noun: "Streams",
		verb: "hands you",
		href: "/p/streams",
		line: "Every event. You hold the cursor.",
	},
	{
		noun: "Index",
		verb: "decodes",
		href: "/p/index",
		line: "Typed rows from genesis.",
	},
	{
		noun: "Subgraphs",
		verb: "fills",
		href: "/p/subgraphs",
		line: "Your contract, as a table.",
	},
	{
		noun: "Webhooks",
		verb: "delivers",
		href: "/p/webhooks",
		line: "Your server, told first.",
	},
] as const satisfies readonly Product[];

export const SITE_LINKS = [
	{ label: "Verify", href: "/verify" },
	{ label: "Pricing", href: "/pricing" },
	{ label: "Docs", href: "/docs" },
	{ label: "Blog", href: "/writing" },
] as const;

/** True when `pathname` is `href` or beneath it. */
export function isActive(pathname: string, href: string): boolean {
	return pathname === href || pathname.startsWith(`${href}/`);
}
