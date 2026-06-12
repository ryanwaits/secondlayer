"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type Step = {
	label: string;
	desc: string;
	/** 1-based inclusive line range to keep lit while this step is active. */
	from: number;
	to: number;
};

/**
 * Steps on the left, one full code block on the right. Selecting a step lights
 * its line range and fades the rest. The code is real Shiki output passed as
 * children; we toggle per-line opacity (Shiki wraps each line in `.line`).
 */
export function CodeWalkthrough({
	steps,
	children,
}: {
	steps: Step[];
	children: ReactNode;
}) {
	const [active, setActive] = useState(0);
	const codeRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const lines =
			codeRef.current?.querySelectorAll<HTMLElement>(".shiki .line");
		if (!lines) return;
		const step = steps[active];
		lines.forEach((el, i) => {
			const n = i + 1;
			el.style.opacity = step && n >= step.from && n <= step.to ? "1" : "0.26";
		});
	}, [active, steps]);

	return (
		<div className="pp-walk">
			<div className="pp-walk-steps" role="tablist">
				{steps.map((step, i) => (
					<button
						key={step.label}
						type="button"
						role="tab"
						aria-selected={i === active}
						className={`pp-walk-step${i === active ? " on" : ""}`}
						onClick={() => setActive(i)}
						onMouseEnter={() => setActive(i)}
						onFocus={() => setActive(i)}
					>
						<h4>{step.label}</h4>
						<p>{step.desc}</p>
					</button>
				))}
			</div>
			<div className="pp-walk-code" ref={codeRef}>
				{children}
			</div>
		</div>
	);
}
