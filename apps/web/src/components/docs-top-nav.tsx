import { DOCS_STRIP } from "@/lib/nav";
import Link from "next/link";

/**
 * Product nav for the docs shell — laid out inside the docs grid so it starts
 * at the sidebar's right edge instead of covering it. The whole strip sits on
 * the right: Home · Docs · Archive · Blog · GitHub. Docs is the only link that
 * can be current here, so it's marked statically.
 */
export function DocsTopNav() {
	return (
		<nav className="docs-topnav" aria-label="Site">
			{DOCS_STRIP.map((p) => (
				<Link
					key={p.href}
					href={p.href}
					className="docs-topnav-link"
					aria-current={p.href === "/docs" ? "page" : undefined}
				>
					{p.label}
				</Link>
			))}
			<a
				href="https://github.com/ryanwaits/secondlayer"
				className="auth-bar-cta"
				target="_blank"
				rel="noopener noreferrer"
			>
				GitHub
			</a>
		</nav>
	);
}
