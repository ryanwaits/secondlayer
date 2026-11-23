import type { ReactNode } from "react";

export function StatusSentence({
	children,
	sub,
}: {
	children: ReactNode;
	sub?: ReactNode;
}) {
	return (
		<div className="dash-status-wrap">
			<h1 className="dash-status">{children}</h1>
			{sub ? <p className="dash-status-sub">{sub}</p> : null}
		</div>
	);
}
