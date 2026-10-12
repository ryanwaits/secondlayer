import type { ReactNode } from "react";

/** Copy on one side, art on the other. `flip` puts the art first. */
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
		<div className={flip ? "split flip" : "split"}>
			<div className="copy">{copy}</div>
			{art}
		</div>
	);
}
