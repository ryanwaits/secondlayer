"use client";

import { CopyButton } from "@/components/copy-button";

export function Cmd({ children }: { children: string }) {
	return (
		<span className="docs-cmd">
			<code>{children}</code>
			<CopyButton code={children} />
		</span>
	);
}
