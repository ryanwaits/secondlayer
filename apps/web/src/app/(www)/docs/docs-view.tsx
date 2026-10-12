"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AgentView } from "./agent-view";
import { useDocsMode } from "./docs-mode";
import { docsNavPages } from "./nav";
import { PageActions } from "./page-actions";

function lookup(pathname: string) {
	const pages = docsNavPages();
	const at = pages.findIndex((p) => p.href === pathname);
	if (at < 0) return null;
	const page = pages[at];
	return {
		group: page.group,
		title: page.title,
		prev: pages[at - 1],
		next: pages[at + 1],
	};
}

/** Switches the docs body between the human reading view (MDX) and the
 *  agent-doc view, and renders the breadcrumb + page-actions chrome for human mode. */
export function DocsView({ children }: { children: ReactNode }) {
	const { mode } = useDocsMode();
	const pathname = usePathname();
	const info = lookup(pathname);

	// Agent mode replaces the page: the deck IS the view. The reference an
	// agent needs lives at the page's raw-markdown endpoint (`<slug>.md`),
	// which AgentView links — rendering the human article underneath just
	// duplicated the page below the deck.
	if (mode === "agent") {
		return <AgentView slug={pathname} title={info?.title ?? "Docs"} />;
	}

	return (
		<>
			<div className="docs-topline">
				{info && (
					<nav className="docs-crumb" aria-label="Breadcrumb">
						<Link href="/docs">Docs</Link>
						<span className="sep">/</span>
						<span>{info.group}</span>
						<span className="sep">/</span>
						<span aria-current="page">{info.title}</span>
					</nav>
				)}
			</div>
			{/* Below the rail's width the same rows sit in a disclosure. */}
			<details className="docs-pa-m">
				<summary>
					Page actions
					<svg viewBox="0 0 12 12" aria-hidden="true">
						<path d="M3 4.5 6 7.5l3-3" />
					</svg>
				</summary>
				<PageActions />
			</details>
			<article className="docs-article" id="docs-article">
				{children}
				{info && (info.prev || info.next) ? (
					<nav className="docs-pn" aria-label="Previous and next">
						{info.prev ? (
							<Link href={info.prev.href} rel="prev">
								<span>← Previous</span>
								<b>{info.prev.title}</b>
							</Link>
						) : (
							<span />
						)}
						{info.next ? (
							<Link href={info.next.href} rel="next">
								<span>Next →</span>
								<b>{info.next.title}</b>
							</Link>
						) : null}
					</nav>
				) : null}
			</article>
		</>
	);
}
