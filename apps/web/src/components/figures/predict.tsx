"use client";

import { type ReactNode, useState } from "react";

/**
 * D4 Predict — the reader commits to a guess before the reveal. Wrong
 * picks stay visible so the correction lands. One per post, placed at
 * the turn.
 */
export function Predict({
	question,
	options,
	reveal,
}: {
	question: ReactNode;
	options: { label: string; right?: boolean }[];
	reveal: ReactNode;
}) {
	const [picked, setPicked] = useState<number | null>(null);

	return (
		<div>
			<p className="fig-predict-q">{question}</p>
			<div className="fig-predict-opts">
				{options.map((opt, i) => (
					<button
						key={opt.label}
						type="button"
						className="fig-popt"
						disabled={picked !== null}
						data-state={
							picked === null
								? undefined
								: opt.right
									? "right"
									: i === picked
										? "wrong"
										: undefined
						}
						onClick={() => setPicked(i)}
					>
						{opt.label}
					</button>
				))}
			</div>
			<div
				className={
					picked !== null ? "fig-predict-reveal open" : "fig-predict-reveal"
				}
			>
				{reveal}
			</div>
		</div>
	);
}
