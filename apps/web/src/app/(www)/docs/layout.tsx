import { DocsTopNav } from "@/components/docs-top-nav";
import type { ReactNode } from "react";
import { DocsModeProvider, ModeToggle } from "./docs-mode";
import { DocsSidebar } from "./docs-sidebar";
import { DocsToc } from "./docs-toc";
import { DocsView } from "./docs-view";
import { DocsScrollTop } from "./scroll-top";

export default function DocsLayout({ children }: { children: ReactNode }) {
	// The product nav lives inside the shell so it starts at the sidebar's right
	// edge (the sidebar drives docs sub-navigation). AuthBar floats top-right.
	// DocsView switches the body between the human reading view and the agent-doc.
	return (
		<DocsModeProvider>
			<DocsScrollTop />
			<div className="docs-shell">
				<DocsSidebar />
				<DocsTopNav />
				<main className="docs-content">
					<DocsView>{children}</DocsView>
				</main>
				<DocsToc />
			</div>
			<ModeToggle />
		</DocsModeProvider>
	);
}
