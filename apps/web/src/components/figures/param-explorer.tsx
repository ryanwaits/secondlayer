"use client";

import { type ReactNode, useId, useState } from "react";

/**
 * D1 ParamExplorer — a slider drives a live re-render of its children plus
 * a readout sentence. Generic shell: post-specific explorers are small
 * client components composing this with their own children/readout logic
 * (render props can't cross the server→client boundary, so composition
 * happens client-side, one file per post explorer).
 *
 * One explorer per post, maximum — the house rule.
 */
export function ParamExplorer({
	label,
	min = 0,
	max = 100,
	initial = max,
	step = 1,
	endLabels,
	ariaLabel,
	children,
	readout,
}: {
	label: string;
	min?: number;
	max?: number;
	initial?: number;
	step?: number;
	/** Captions under the slider's two ends. */
	endLabels?: [ReactNode, ReactNode];
	ariaLabel: string;
	children?: (value: number) => ReactNode;
	readout?: (value: number) => ReactNode;
}) {
	const [value, setValue] = useState(initial);
	const id = useId();

	return (
		<div>
			{children?.(value)}
			<label htmlFor={id} className="fig-range-label">
				{label}
			</label>
			<input
				id={id}
				type="range"
				className="fig-range"
				min={min}
				max={max}
				step={step}
				value={value}
				aria-label={ariaLabel}
				onChange={(e) => setValue(Number(e.target.value))}
			/>
			{endLabels && (
				<div className="fig-range-ends">
					<span>{endLabels[0]}</span>
					<span className="end-r">{endLabels[1]}</span>
				</div>
			)}
			{readout && <div className="fig-readout">{readout(value)}</div>}
		</div>
	);
}
