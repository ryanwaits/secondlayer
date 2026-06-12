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
	// No step is active by default — hover/focus highlights a range,
	// leaving the list clears it back to plain (readable) code.
	const [active, setActive] = useState<number | null>(null);
	const codeRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const lines =
			codeRef.current?.querySelectorAll<HTMLElement>(".shiki .line");
		if (!lines) return;
		const step = active === null ? null : steps[active];
		lines.forEach((el, i) => {
			const n = i + 1;
			el.classList.toggle(
				"pp-line-on",
				Boolean(step && n >= step.from && n <= step.to),
			);
		});
	}, [active, steps]);

	return (
		<div className="pp-walk">
			<div
				className="pp-walk-steps"
				role="tablist"
				onMouseLeave={() => setActive(null)}
			>
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
						onBlur={() => setActive(null)}
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
