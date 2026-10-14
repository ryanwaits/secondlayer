import type { ReactNode } from "react";

/**
 * Copy on one side, art on the other. `flip` puts the art first; `wide` gives
 * the art the room a code figure with margin notes needs.
 */
export function Split({
	flip,
	wide,
	copy,
	art,
}: {
	flip?: boolean;
	wide?: boolean;
	copy: ReactNode;
	art: ReactNode;
}) {
	return (
		<div className={`split${flip ? " flip" : ""}${wide ? " wide" : ""}`}>
			<div className="copy">{copy}</div>
			{art}
		</div>
	);
}
