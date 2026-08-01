"use client";

import { type ReactNode, useId, useState } from "react";

/**
 * A5 Sidenote — a numbered aside for hedges, sources, and precision
 * upgrades that would break the paragraph's stride. Renders a superscript
 * reference inline; tapping it expands the note below the paragraph.
 * Tap target padding comes from the CSS; body is hidden until opened.
 *
 * Usage: place inside the paragraph right after the referenced phrase,
 * with the note body as children.
 */
export function Sidenote({ n, children }: { n: number; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const id = useId();
	const sup = "¹²³⁴⁵⁶⁷⁸⁹"[n - 1] ?? `(${n})`;

	return (
		<>
			<button
				type="button"
				className="fig-snref"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen(!open)}
			>
				{sup}
			</button>
			<span id={id} className={open ? "fig-snbody open" : "fig-snbody"}>
				<b>{n}</b>. {children}
			</span>
		</>
	);
}
