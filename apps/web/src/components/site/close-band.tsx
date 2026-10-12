import type { ReactNode } from "react";

/** Closing band: big line, two actions, one caption. */
export function CloseBand({
	title,
	cta,
	caption,
}: {
	title: ReactNode;
	cta: ReactNode;
	caption?: ReactNode;
}) {
	return (
		<div className="band close">
			<div className="shell">
				<div className="close-in">
					<h2>{title}</h2>
					<div className="btns">{cta}</div>
				</div>
				{caption ? <p className="cap">{caption}</p> : null}
			</div>
		</div>
	);
}
