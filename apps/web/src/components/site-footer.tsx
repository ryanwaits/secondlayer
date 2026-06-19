"use client";

import { healthState, summaryLabel } from "@/lib/status-snapshot";
import type { SystemStatus } from "@/lib/types";
import Link from "next/link";
import { usePathname } from "next/navigation";

const COLS: { title: string; links: { label: string; href: string }[] }[] = [
	{
		title: "Product",
		links: [
			{ label: "Index", href: "/indexes" },
			{ label: "Subgraphs", href: "/subgraphs" },
			{ label: "Streams", href: "/streams" },
		],
	},
	{
		title: "Features",
		links: [
			{ label: "Subscriptions", href: "/docs/subscriptions" },
			{ label: "Explore", href: "/subgraphs/explore" },
			{ label: "Contract discovery", href: "/docs/contracts" },
			{ label: "Verification", href: "/docs/verification" },
		],
	},
	{
		title: "Developers",
		links: [
			{ label: "Docs", href: "/docs" },
			{
				label: "OpenAPI",
				href: "https://api.secondlayer.tools/v1/openapi.json",
			},
			{ label: "MCP", href: "/docs/mcp" },
			{ label: "Status", href: "/status" },
		],
	},
	{
		title: "Resources",
		links: [
			{ label: "CLI", href: "/docs/cli" },
			{ label: "SDK", href: "/docs/sdk" },
			{ label: "Pricing", href: "/pricing" },
		],
	},
];

/** Marketing-page footer (dotted rules, Field Notebook). Hidden on docs. */
export function SiteFooter({ status }: { status?: SystemStatus | null }) {
	const pathname = usePathname();
	if (pathname.startsWith("/docs")) return null;

	const state = healthState(status ?? null);

	return (
		<footer className="site-footer">
			<div className="site-footer-in">
				<div className="site-footer-grid">
					<div className="site-footer-brand">
						<p className="b">
							<svg
								viewBox="4 7 40 28"
								width="22"
								height="15"
								fill="none"
								aria-hidden="true"
							>
								<polygon
									points="8,25 28,17 42,25 22,33"
									className="logo-echo"
								/>
								<polygon
									points="8,19 28,11 42,19 22,27"
									className="logo-primary"
								/>
							</svg>
							<span>secondlayer</span>
						</p>
						<p>
							The hosted indexer for Stacks. Inspired by the ideas behind{" "}
							<a
								href="https://paragraph.com/@aulneau/project-kourier"
								target="_blank"
								rel="noopener noreferrer"
								className="footer-kourier"
							>
								Project Kourier
							</a>
							.
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
					{/* mobile home of the floating status pill (hidden ≤640px) */}
					<Link href="/status" className="footer-status" data-state={state}>
						<span className="footer-status-dot" aria-hidden="true" />
						{summaryLabel(state)}
					</Link>
				</div>
			</div>
		</footer>
	);
}
