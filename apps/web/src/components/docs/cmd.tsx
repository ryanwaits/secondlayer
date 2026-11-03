"use client";

import { CopyButton } from "@/components/copy-button";

/**
 * A runnable command inside a sentence: the same inline-code look as any other
 * code span (`.docs-article :not(pre) > code`) plus a copy button that shows on
 * hover or keyboard focus. Identifiers, flags and env names stay plain code.
 */
export function Cmd({ children }: { children: string }) {
	return (
		<span className="docs-cmd">
			<code>{children}</code>
			<CopyButton code={children} />
		</span>
	);
}
