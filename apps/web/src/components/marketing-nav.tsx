"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Marketing bar (mock shell): brand left, quiet text links + the two pill
 * actions right. Fixed 64px with the paper/85 + blur treatment from
 * .marketing-nav. Docs keeps its own chrome — this renders null there.
 * The floating AuthBar is hidden wherever this bar is present (globals.css),
 * so the bar owns the top edge alone.
 */
export function MarketingNav() {
	const pathname = usePathname();
	if (pathname.startsWith("/docs")) return null;

	return (
		<nav className="marketing-nav" aria-label="Main">
			<Link href="/" className="marketing-nav-brand">
				<svg
					viewBox="4 7 40 28"
					width="22"
					height="15"
					fill="none"
					aria-hidden="true"
				>
					<polygon points="8,25 28,17 42,25 22,33" className="logo-echo" />
					<polygon points="8,19 28,11 42,19 22,27" className="logo-primary" />
				</svg>
				<span>secondlayer</span>
			</Link>
			<span className="marketing-nav-spacer" />
			<Link
				href="/docs"
				className="mnav-plain"
				aria-current={pathname.startsWith("/docs") ? "page" : undefined}
			>
				Docs
			</Link>
			<Link
				href="/docs/archive"
				className="mnav-plain"
				aria-current={pathname === "/docs/archive" ? "page" : undefined}
			>
				Archive
			</Link>
			<Link href="/login" className="mnav-pill line">
				Console
			</Link>
			<Link href="/docs/self-host" className="mnav-pill solid">
				Get started
			</Link>
		</nav>
	);
}
