import type { ReactNode } from "react";

export type Tone = "ok" | "alarm" | "hi" | "idle";

export const dotClass = (tone: Tone) =>
	tone === "ok" ? "dash-dot" : `dash-dot ${tone}`;

/** The one-line answer at the top of a dashboard screen, with an optional sub-line. */
export function StatusSentence({
	tone,
	children,
	sub,
}: {
	tone: Tone;
	children: ReactNode;
	sub?: ReactNode;
}) {
	return (
		<div className="dash-status-wrap">
			<h1 className="dash-status">
				<span className={dotClass(tone)} />
				{children}
			</h1>
			{sub ? <p className="dash-status-sub">{sub}</p> : null}
		</div>
	);
}
