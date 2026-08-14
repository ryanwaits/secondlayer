import { DOCS_STRIP } from "@/lib/nav";
import Link from "next/link";

/**
 * Product nav for the docs shell — laid out inside the docs grid so it starts
 * at the sidebar's right edge instead of covering it.
 *
 * Every link leaves docs, so nothing here is ever the current page and there's
 * no active state to track. The sidebar and the page title say where you are.
 */
export function DocsTopNav() {
	return (
		<nav className="docs-topnav" aria-label="Site">
			{DOCS_STRIP.map((p) => (
				<Link key={p.href} href={p.href} className="docs-topnav-link">
					{p.label}
				</Link>
			))}
		</nav>
	);
}
