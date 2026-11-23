import type { ReactNode } from "react";

export function Steps({ children }: { children?: ReactNode }) {
	return <div className="docs-steps">{children}</div>;
}
