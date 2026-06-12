"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRODUCTS } from "./marketing-nav";

/**
 * Product nav for the docs shell — the same links as the marketing nav, but
 * laid out inside the docs grid so it starts at the sidebar's right edge
 * instead of covering it. "Docs" is the active item here (the sidebar drives
 * sub-navigation); every other link leaves docs for that page.
 */
export function DocsTopNav() {
	const pathname = usePathname();
	return (
		<nav className="docs-topnav" aria-label="Products">
			{PRODUCTS.map((p) => {
				const active = p.href === "/docs" && pathname.startsWith("/docs");
				return (
					<Link
						key={p.href}
						href={p.href}
						className="docs-topnav-link"
						aria-current={active ? "page" : undefined}
					>
						{p.label}
					</Link>
				);
			})}
		</nav>
	);
}
