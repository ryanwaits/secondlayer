import type { ReactNode } from "react";

/** The one-line answer at the top of a dashboard screen, with an optional sub-line. */
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
