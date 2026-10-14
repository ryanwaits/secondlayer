/**
 * Single source for the marketing shell: the five products (names, verb lines,
 * order, routes) and the top-bar links. The nav, footer, home spine and
 * "rest of the platform" all read this. Adding a product = one entry.
 *
 * Client-safe: marketing-nav.tsx and site-footer.tsx are client components.
 */

export const GITHUB_URL = "https://github.com/ryanwaits/secondlayer";

export interface Product {
	noun: string;
	verb: string;
	href: string;
	line: string;
}

export const PRODUCTS = [
	{
		noun: "Archive",
		verb: "Restore signed history",
		href: "/p/archive",
		line: "Signed history. Check your copy free.",
	},
	{
		noun: "Streams",
		verb: "Stream raw events",
		href: "/p/streams",
		line: "Every event. You hold the cursor.",
	},
	{
		noun: "Index",
		verb: "Query decoded rows",
		href: "/p/index",
		line: "Typed rows from genesis.",
	},
	{
		noun: "Subgraphs",
		verb: "Index your contract",
		href: "/p/subgraphs",
		line: "Your contract, as a table.",
	},
	{
		noun: "Webhooks",
		verb: "Get told first",
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
