"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PRODUCTS = [
	{ label: "Index", href: "/index-api" },
	{ label: "Subgraphs", href: "/subgraphs" },
	{ label: "Streams", href: "/streams" },
	{ label: "Explore", href: "/subgraphs/explore" },
	{ label: "Pricing", href: "/pricing" },
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
