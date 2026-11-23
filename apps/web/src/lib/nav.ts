/** Must stay free of server-only imports: client components import it. */

export interface NavLink {
	label: string;
	href: string;
}

export const DOCS_STRIP: NavLink[] = [
	{ label: "Home", href: "/" },
	{ label: "Archive", href: "/p/archive" },
	{ label: "Pricing", href: "/pricing" },
	{ label: "Docs", href: "/docs" },
	{ label: "Blog", href: "/blog" },
];
