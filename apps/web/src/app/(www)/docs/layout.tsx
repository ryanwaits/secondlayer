import { DocsTopNav } from "@/components/docs-top-nav";
import { readGithubStars } from "@/lib/github-stars";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DocsModeProvider, ModeToggle } from "./docs-mode";
import { DocsSidebar } from "./docs-sidebar";
import { DocsToc } from "./docs-toc";
import { DocsView } from "./docs-view";
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
}: {
	children: ReactNode;
}) {
	const stars = await readGithubStars();
	// The product nav lives inside the shell so it starts at the sidebar's right
	// edge (the sidebar drives docs sub-navigation). Session chrome lives in
	// DocsTopNav. DocsView switches the body between the human reading view
	// and the agent-doc.
	return (
		<DocsModeProvider>
			<DocsScrollTop />
			<div className="docs-shell">
				<DocsSidebar />
				<DocsTopNav stars={stars} />
				<main className="docs-content">
					<DocsView>{children}</DocsView>
				</main>
				<DocsToc />
			</div>
			<ModeToggle />
		</DocsModeProvider>
	);
}
