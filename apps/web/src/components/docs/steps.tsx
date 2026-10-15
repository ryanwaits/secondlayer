import type { ReactNode } from "react";

/** Numbered steps: each `###` inside is one step, numbered 01, 02, … in order.
 *  Use only where the order is the point (a setup sequence). */
export function Steps({ children }: { children?: ReactNode }) {
	return <div className="docs-steps">{children}</div>;
}
