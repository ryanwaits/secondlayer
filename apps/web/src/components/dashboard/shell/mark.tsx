import type { ReactNode } from "react";

/**
 * The value that is wrong on a flagged row or page. Attention is the brand
 * `.hl` block (`--hi` ground); failing is the inverted neutral block, the same
 * in light and dark.
 */
export function Mark({
	tone,
	children,
}: {
	tone: "att" | "fail";
	children: ReactNode;
}) {
	return <span className={`dash-mark ${tone}`}>{children}</span>;
}
