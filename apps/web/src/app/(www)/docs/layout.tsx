import type { ReactNode } from "react";
import { DocsSidebar } from "./docs-sidebar";
import { DocsToc } from "./docs-toc";

export default function DocsLayout({ children }: { children: ReactNode }) {
	// No custom topbar — the docs site uses the global marketing nav (AuthBar).
	return (
		<div className="docs-shell">
			<DocsSidebar />
			<main className="docs-content">
				<article className="docs-article" id="docs-article">
					{children}
				</article>
			</main>
			<DocsToc />
		</div>
	);
}
