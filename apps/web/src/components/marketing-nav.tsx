"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PRODUCTS = [
	{ label: "Index", href: "/index-api" },
	{ label: "Subgraphs", href: "/subgraphs" },
	{ label: "Streams", href: "/streams" },
	{ label: "Datasets", href: "/datasets" },
	{ label: "Explore", href: "/subgraphs/explore" },
];

/**
 * Top-left product nav for marketing pages — the counterpart to AuthBar
 * (top-right), sharing its mono-uppercase link treatment so the two read
 * as one bar. Docs and platform keep their own chrome: this renders null
 * there (docs has the sidebar shell; platform is outside the (www) group).
 */
export function MarketingNav() {
	const pathname = usePathname();
	if (pathname.startsWith("/docs")) return null;

	return (
		<nav className="marketing-nav" aria-label="Products">
			<Link href="/" className="marketing-nav-brand">
				secondlayer
			</Link>
			{PRODUCTS.map((p) => {
				const active =
					p.href === "/subgraphs/explore"
						? pathname.startsWith(p.href)
						: pathname === p.href ||
							(pathname.startsWith(`${p.href}/`) &&
								!pathname.startsWith("/subgraphs/explore"));
				return (
					<Link
						key={p.href}
						href={p.href}
						className="auth-bar-nav-link marketing-nav-link"
						aria-current={active ? "page" : undefined}
					>
						<span className="auth-bar-nav-label">{p.label}</span>
					</Link>
				);
			})}
		</nav>
	);
}
