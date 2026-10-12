/**
 * Docs-side navigation. Marketing nav/footer read `lib/site.ts`.
 *
 * Must stay free of server-only imports: client components import it.
 */

export interface NavLink {
	label: string;
	href: string;
}

/**
 * The "leave docs" strip. Docs already owns the sidebar; this is the way
 * back out. Session chrome (Sign in / account chip) is not in this list —
 * DocsTopNav and the mobile drawer read the session and paint it.
 */
export const DOCS_STRIP: NavLink[] = [
	{ label: "Home", href: "/" },
	{ label: "Archive", href: "/p/archive" },
	{ label: "Pricing", href: "/pricing" },
	{ label: "Docs", href: "/docs" },
	{ label: "Blog", href: "/writing" },
];
