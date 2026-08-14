/**
 * Single source of truth for the marketing navigation.
 *
 * The bar, the mobile sheet and the active-route test all read this array, so
 * a route only has to be described once. Groups render as hover panels on
 * desktop and as collapsed accordions in the mobile sheet.
 *
 * This module must stay free of server-only imports — marketing-nav.tsx is a
 * client component, so anything reachable from here lands in the browser
 * bundle.
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
	caption: string;
	items: NavItem[];
	foot?: string;
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
	{ label: "Docs", href: "/docs" },
	{ label: "Self-host", href: "/docs/self-host" },
	{ label: "Archive", href: "/docs/archive" },
	{ label: "Writing", href: "/writing" },
];

/**
 * The "leave docs" strip. Docs already owns the sidebar; this is the way
 * back out.
 */
export const DOCS_STRIP: NavLink[] = [
	{ label: "Home", href: "/" },
	{ label: "Archive", href: "/docs/archive" },
	{ label: "Writing", href: "/writing" },
];

function matches(pathname: string, href: string): boolean {
	if (href === "/") return pathname === "/";
	return pathname === href || pathname.startsWith(`${href}/`);
}

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

export function activeGroupIndex(pathname: string): number {
	const active = activeHref(pathname);
	if (!active) return -1;
	return NAV.findIndex(
		(entry) => isGroup(entry) && entry.items.some((i) => i.href === active),
	);
}

export interface NavSubgraph {
	name: string;
	rows: string;
}
