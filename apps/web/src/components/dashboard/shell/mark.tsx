import type { ReactNode } from "react";

/**
 * The value an open insight is about. A dashed box, like a failing name on the
 * index: attention is yellow, failing is red, text in the same color.
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
