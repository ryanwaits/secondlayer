"use client";

import { useState } from "react";

export type Step = {
	/** Index of the highlighted line at this step. */
	now: number;
	/** Line indices struck through at this step (the crash case). */
	dead?: number[];
	caption: string;
};

/**
 * D3 StepThrough — an algorithm, one move at a time, for logic where
 * the reader must hold intermediate state in their head. Arrow keys
 * work on the stage; the final step often rewinds to the failure case,
 * which is the payoff.
 */
export function StepThrough({
	lines,
	steps,
}: {
	lines: string[];
	steps: Step[];
}) {
	const [i, setI] = useState(0);
	const step = steps[i];
	const dead = new Set(step.dead ?? []);
	const prev = () => setI(Math.max(i - 1, 0));
	const next = () => setI(Math.min(i + 1, steps.length - 1));

	return (
		<div>
			<div className="fig-steps-controls">
				<button
					type="button"
					className="fig-btn"
					aria-label="Previous step"
					onClick={prev}
				>
					←
				</button>
				<button
					type="button"
					className="fig-btn"
					aria-label="Next step"
					onClick={next}
				>
					→
				</button>
				<span className="fig-step-count">
					step {i + 1} of {steps.length}
				</span>
			</div>
			<div
				className="fig-steps-stage"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: stage receives arrow-key navigation
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === "ArrowRight") {
						next();
						e.preventDefault();
					}
					if (e.key === "ArrowLeft") {
						prev();
						e.preventDefault();
					}
				}}
			>
				{lines.map((line, j) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
						key={j}
						className={[
							"fig-sline",
							j === step.now ? "now" : "",
							j < step.now && !dead.has(j) ? "done" : "",
							dead.has(j) ? "dead" : "",
						]
							.filter(Boolean)
							.join(" ")}
					>
						{line}
					</span>
				))}
			</div>
			<div className="fig-step-cap">{step.caption}</div>
		</div>
	);
}
