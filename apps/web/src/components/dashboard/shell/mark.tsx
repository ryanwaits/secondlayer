import type { ReactNode } from "react";

export function Mark({
	tone,
	children,
}: {
	tone: "att" | "fail";
	children: ReactNode;
}) {
	return <span className={`dash-mark ${tone}`}>{children}</span>;
}
