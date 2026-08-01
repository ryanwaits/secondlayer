"use client";

import { type ReactNode, useId, useState } from "react";
import { useMediaQuery } from "./use-media-query";

/**
 * A5 Sidenote — a numbered aside for hedges, sources, and precision
 * upgrades that would break the paragraph's stride.
 *
 * ≥1100px the note is always visible, floated into the right margin
 * beside its reference (Tufte-style; float CSS is scoped to
 * `.writing-article`, so the catalog shows the margin variant inline).
 * Below that, a superscript button expands the note inline under the
 * paragraph.
 *
 * Usage: place inside the paragraph right after the referenced phrase,
 * with the note body as children.
 */
export function Sidenote({ n, children }: { n: number; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const id = useId();
	const wide = useMediaQuery("(min-width: 1180px)");
	const sup = "¹²³⁴⁵⁶⁷⁸⁹"[n - 1] ?? `(${n})`;

	if (wide) {
		return (
			<>
				<sup className="fig-snref-static">{sup}</sup>
				<span className="fig-snbody margin">
					<b>{n}</b>. {children}
				</span>
			</>
		);
	}

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
