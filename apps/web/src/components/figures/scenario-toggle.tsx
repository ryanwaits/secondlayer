"use client";

import { Choice } from "@/components/choice";
import { type ReactNode, useId, useState } from "react";

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
	const name = useId();

	return (
		<div>
			<div className="fig-controls">
				<Choice
					name={name}
					legend="Scenario"
					options={labels.map((label, i) => ({ value: String(i), label }))}
					value={String(idx)}
					onChange={(v) => setIdx(Number(v))}
				/>
			</div>
			{panels[idx]}
		</div>
	);
}
