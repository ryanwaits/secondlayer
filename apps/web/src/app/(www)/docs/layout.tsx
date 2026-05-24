import type { ReactNode } from "react";
import { DocsModeProvider, ModeToggle } from "./docs-mode";
import { DocsSidebar } from "./docs-sidebar";
import { DocsToc } from "./docs-toc";
import { DocsView } from "./docs-view";

export default function DocsLayout({ children }: { children: ReactNode }) {
	// No custom topbar — docs use the global marketing nav (AuthBar).
	// DocsView switches the body between the human reading view and the agent-doc.
	return (
		<DocsModeProvider>
			<div className="docs-shell">
				<DocsSidebar />
				<main className="docs-content">
					<DocsView>{children}</DocsView>
				</main>
				<DocsToc />
			</div>
			<ModeToggle />
		</DocsModeProvider>
	);
}
