import type { ReactNode } from "react";

/** Inverted ink block behind a headline phrase: the one beat the line is about. */
export function Highlight({ children }: { children: ReactNode }) {
	return <span className="hl">{children}</span>;
}
