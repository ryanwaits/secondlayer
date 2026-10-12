"use client";

import { Logo } from "@/components/logo";
import Link from "next/link";
import { usePathname } from "next/navigation";

const COLS: { title: string; links: { label: string; href: string }[] }[] = [
	{
		title: "Surfaces",
		links: [
			{ label: "Archive", href: "/docs/archive" },
			{ label: "Streams", href: "/docs/streams" },
			{ label: "Index", href: "/docs/index" },
			{ label: "Subgraphs", href: "/docs/subgraphs" },
			{ label: "Webhooks", href: "/docs/webhooks" },
		],
	},
	{
		title: "Developers",
		links: [
			{ label: "CLI", href: "/docs/cli" },
			{ label: "SDK", href: "/docs/sdk" },
			{ label: "MCP", href: "/docs/mcp" },
			{ label: "Verify", href: "/docs/verification" },
		],
	},
	{
		title: "Resources",
		links: [
			{ label: "Blog", href: "/writing" },
			{ label: "Changelog", href: "/docs/changelog" },
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
						<Link href="/" className="b">
							<Logo size={22} />
							<span>secondlayer</span>
						</Link>
						<p>
							Instant data for apps on Bitcoin. Inspired by the ideas behind{" "}
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
						<p className="site-footer-copy">
							<span>© {new Date().getFullYear()} Secondlayer</span>
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
			</div>
		</footer>
	);
}
