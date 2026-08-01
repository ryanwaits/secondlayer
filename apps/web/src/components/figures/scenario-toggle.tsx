"use client";

import { type ReactNode, useState } from "react";

/**
 * D2 ScenarioToggle — two (or more) named worlds to compare. Segmented
 * buttons switch which panel renders. Panels are plain ReactNode, so
 * server MDX can compose this with static figure children directly.
 */
export function ScenarioToggle({
	labels,
	panels,
}: {
	labels: string[];
	panels: ReactNode[];
}) {
	const [idx, setIdx] = useState(0);

	return (
		<div>
			<div className="fig-controls">
				{labels.map((label, i) => (
					<button
						key={label}
						type="button"
						className="fig-btn"
						aria-pressed={i === idx}
						onClick={() => setIdx(i)}
					>
						{label}
					</button>
				))}
			</div>
			{panels[idx]}
		</div>
	);
}
