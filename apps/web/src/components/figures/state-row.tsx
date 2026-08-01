"use client";

import { useState } from "react";

export type RowState = {
	label: string;
	tone: "pending" | "confirmed" | "final";
	caption: string;
};

/**
 * B10 StateRow — a linear status progression the reader operates to
 * understand. Click advances (wraps); arrow keys move both ways. House
 * badge colors by state; past states dim, the current one fills.
 */
export function StateRow({
	states,
	ariaLabel,
}: {
	states: RowState[];
	ariaLabel: string;
}) {
	const [i, setI] = useState(0);
	const last = states.length - 1;

	return (
		<div>
			<button
				type="button"
				className="fig-staterow"
				aria-label={ariaLabel}
				onClick={() => setI((i + 1) % states.length)}
				onKeyDown={(e) => {
					if (e.key === "ArrowRight") {
						setI(Math.min(i + 1, last));
						e.preventDefault();
					}
					if (e.key === "ArrowLeft") {
						setI(Math.max(i - 1, 0));
						e.preventDefault();
					}
				}}
			>
				{states.map((s, j) => (
					<span key={s.label} style={{ display: "contents" }}>
						<span
							className={[
								"fig-st",
								`s-${s.tone}`,
								j === i ? "now" : "",
								j < i ? "past" : "",
							]
								.filter(Boolean)
								.join(" ")}
						>
							{s.label}
						</span>
						{j < last && <span className="fig-st-arrow">→</span>}
					</span>
				))}
			</button>
			<div className="fig-readout">
				{i === last ? "click to restart" : "click to advance"} ·{" "}
				{states[i].caption}
			</div>
		</div>
	);
}
