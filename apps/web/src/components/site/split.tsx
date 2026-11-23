import type { ReactNode } from "react";

export function Split({
	flip,
	copy,
	art,
}: {
	flip?: boolean;
	copy: ReactNode;
	art: ReactNode;
}) {
	return (
		<div className={`split${flip ? " flip" : ""}`}>
			<div className="copy">{copy}</div>
			{art}
		</div>
	);
}
