import { DocsTopNav } from "@/components/docs-top-nav";
import { Logo } from "@/components/logo";
import { GITHUB_URL } from "@/lib/site";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DocsDrawerProvider } from "./docs-drawer";
import { DocsSidebar } from "./docs-sidebar";
import { DocsView } from "./docs-view";
import "./docs.css";
import { DocsScrollTop } from "./scroll-top";
import { DocsTrail } from "./trail";

// The docs index's share card. Every other docs page has its own
// opengraph-image.png beside it (bun run og), which overrides this; no
// twitter image here, so X falls back to that per-page og:image. Title and
// description fall through to each page's own metadata export.
export const metadata: Metadata = {
	title: {
		default: "Stacks data API, webhooks and indexers · secondlayer docs",
		template: "%s · secondlayer docs",
	},
	openGraph: {
		siteName: "secondlayer",
		type: "website",
		images: [
			{
				url: "/og/docs.png",
				width: 1200,
				height: 630,
				alt: "secondlayer docs",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
	},
};

export default function DocsLayout({ children }: { children: ReactNode }) {
	// The top bar spans the page; the shell below is the sidebar beside the
	// article and footer, so the sidebar's sticky range runs to the page's end.
	return (
		<DocsDrawerProvider>
			<DocsScrollTop />
			<DocsTopNav />
			<div className="docs-shell">
				<DocsSidebar />
				<main className="docs-content">
					<DocsView>{children}</DocsView>
					<DocsTrail />
				</main>
				<footer className="docs-foot">
					<div className="docs-foot-in">
						<Logo size={18} />
						<span>secondlayer docs</span>
						<Link href="/docs/changelog">Changelog</Link>
						<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
							GitHub
						</a>
						<span className="docs-foot-tag">
							Instant data for apps on Bitcoin.
						</span>
					</div>
				</footer>
			</div>
		</DocsDrawerProvider>
	);
}
