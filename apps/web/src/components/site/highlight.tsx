import type { ReactNode } from "react";

/** Yellow highlighter behind a phrase. Highlight/new/signed only. */
export function Highlight({ children }: { children: ReactNode }) {
	return <span className="hl">{children}</span>;
}
