"use client";

import { type ReactNode, useState } from "react";

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
