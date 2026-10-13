import { DocsTopNav } from "@/components/docs-top-nav";
import { Logo } from "@/components/logo";
import { docsHeadingIndex } from "@/lib/docs-source";
import { GITHUB_URL } from "@/lib/site";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DocsDrawerProvider } from "./docs-drawer";
import { DocsSidebar } from "./docs-sidebar";
import { DocsView } from "./docs-view";
import "./docs.css";
import { DocsScrollTop } from "./scroll-top";

// Every docs page shares the docs share card; og/twitter title and
// description fall through to each page's own metadata export.
export const metadata: Metadata = {
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
		images: ["/og/docs.png"],
	},
};

export default async function DocsLayout({
	children,
}: { children: ReactNode }) {
	const headings = await docsHeadingIndex();
	// The top bar spans the page; the shell below is sidebar and article.
	return (
		<DocsDrawerProvider>
			<DocsScrollTop />
			<DocsTopNav headings={headings} />
			<div className="docs-shell">
				<DocsSidebar />
				<main className="docs-content">
					<DocsView>{children}</DocsView>
				</main>
			</div>
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
		</DocsDrawerProvider>
	);
}
