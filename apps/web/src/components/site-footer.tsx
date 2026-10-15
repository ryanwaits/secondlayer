"use client";

import { Logo } from "@/components/logo";
import { GITHUB_URL } from "@/lib/site";
import { PRODUCTS } from "@/lib/site";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface FooterLink {
	label: string;
	href: string;
	external?: boolean;
}

const COLS: { title: string; links: readonly FooterLink[] }[] = [
	{
		title: "Products",
		links: PRODUCTS.map((p) => ({ label: p.noun, href: p.href })),
	},
	{
		title: "Developers",
		links: [
			{ label: "CLI", href: "/docs/cli" },
			{ label: "SDK", href: "/docs/sdk" },
			{ label: "MCP", href: "/docs/mcp" },
			{ label: "Verify", href: "/verify" },
		],
	},
	{
		title: "Resources",
		links: [
			{ label: "Pricing", href: "/pricing" },
			{ label: "Self-host", href: "/docs/self-host" },
			{ label: "Blog", href: "/blog" },
			{ label: "Changelog", href: "/docs/changelog" },
			{ label: "GitHub", href: GITHUB_URL, external: true },
		],
	},
];

/** Marketing-page footer: brand, tagline, three link columns. Hidden on docs. */
export function SiteFooter() {
	const pathname = usePathname();
	if (pathname.startsWith("/docs")) return null;

	return (
		<footer className="site-footer">
			<div className="site-footer-in">
				<div className="site-footer-grid">
					<div className="site-footer-brand">
						<Link href="/" className="b">
							<Logo size={22} />
							<span>secondlayer</span>
						</Link>
						<p className="site-footer-tag">Instant data for apps on Bitcoin.</p>
						<p className="site-footer-credit">
							Inspired by the ideas behind{" "}
							<a
								href="https://paragraph.com/@aulneau/project-kourier"
								target="_blank"
								rel="noopener noreferrer"
							>
								Project Kourier
							</a>
							.
						</p>
					</div>
					{COLS.map((col) => (
						<div className="site-footer-col" key={col.title}>
							<h5>{col.title}</h5>
							<ul>
								{col.links.map((l) => (
									<li key={l.label}>
										{l.external ? (
											<a href={l.href} rel="noopener noreferrer">
												{l.label}
											</a>
										) : (
											<Link href={l.href}>{l.label}</Link>
										)}
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			</div>
		</footer>
	);
}
