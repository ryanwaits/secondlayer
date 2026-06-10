"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const COLS: { title: string; links: { label: string; href: string }[] }[] = [
	{
		title: "Product",
		links: [
			{ label: "Index", href: "/index-api" },
			{ label: "Subgraphs", href: "/subgraphs" },
			{ label: "Streams", href: "/streams" },
			{ label: "Subscriptions", href: "/subscriptions" },
			{ label: "Datasets", href: "/datasets" },
		],
	},
	{
		title: "Developers",
		links: [
			{ label: "Docs", href: "/docs" },
			{ label: "Explore", href: "/subgraphs/explore" },
			{ label: "OpenAPI", href: "https://api.secondlayer.tools/v1/openapi.json" },
			{ label: "MCP", href: "/mcp" },
			{ label: "Status", href: "/status" },
		],
	},
	{
		title: "Resources",
		links: [
			{ label: "CLI", href: "/cli" },
			{ label: "SDK", href: "/sdk" },
			{ label: "Pricing", href: "/pricing" },
			{ label: "Migration", href: "/migration" },
		],
	},
];

/** Marketing-page footer (dotted rules, Field Notebook). Hidden on docs. */
export function SiteFooter() {
	const pathname = usePathname();
	if (pathname.startsWith("/docs")) return null;

	return (
		<footer className="site-footer">
			<div className="site-footer-in">
				<div className="site-footer-grid">
					<div className="site-footer-brand">
						<p className="b">secondlayer</p>
						<p>
							The data plane for Stacks — indexing run as a utility. Born from
							Project Kourier.
						</p>
					</div>
					<div className="site-footer-cols">
						{COLS.map((col) => (
							<div className="site-footer-col" key={col.title}>
								<h5>{col.title}</h5>
								<ul>
									{col.links.map((l) =>
										l.href.startsWith("http") ? (
											<li key={l.label}>
												<a href={l.href} rel="noopener noreferrer">
													{l.label}
												</a>
											</li>
										) : (
											<li key={l.label}>
												<Link href={l.href}>{l.label}</Link>
											</li>
										),
									)}
								</ul>
							</div>
						))}
					</div>
				</div>
				<div className="site-footer-base">
					<span>© {new Date().getFullYear()} Secondlayer</span>
					<span className="m">stacks mainnet</span>
				</div>
			</div>
		</footer>
	);
}
