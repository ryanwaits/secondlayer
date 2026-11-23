import type { ReactNode } from "react";

export function Highlight({ children }: { children: ReactNode }) {
	return <span className="hl">{children}</span>;
}
