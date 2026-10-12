import { DocsTopNav } from "@/components/docs-top-nav";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DocsModeProvider } from "./docs-mode";
import { DocsSidebar } from "./docs-sidebar";
import { DocsToc } from "./docs-toc";
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

export default function DocsLayout({ children }: { children: ReactNode }) {
	// The top bar spans the page; the shell below is sidebar, article, rail.
	// DocsView switches the body between the human reading view and the
	// agent-doc.
	return (
		<DocsModeProvider>
			<DocsScrollTop />
			<DocsTopNav />
			<div className="docs-shell">
				<DocsSidebar />
				<main className="docs-content">
					<DocsView>{children}</DocsView>
				</main>
				<DocsToc />
			</div>
		</DocsModeProvider>
	);
}
