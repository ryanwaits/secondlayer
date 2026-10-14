import type { ReactNode } from "react";

/**
 * Copy on one side, art on the other. `flip` puts the art first. A code
 * figure's margin notes hang off the outer edge (site.css).
 */
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
