"use client";

import { useState } from "react";

export type DiffLine = { text: string; op?: "add" | "del" };

/**
 * A7 CodeDiff — a migration or fix as the story. Deletions tinted alarm,
 * additions tinted ok (semantic colors, never the role palette). The
 * "result" view is what a reader copies.
 */
export function CodeDiff({
	lines,
	result,
}: {
	lines: DiffLine[];
	/** The clean after-state; derived from `lines` minus deletions if omitted. */
	result?: string[];
}) {
	const [unified, setUnified] = useState(true);
	const after =
		result ?? lines.filter((l) => l.op !== "del").map((l) => l.text);

	return (
		<div className="fig-diff">
			<div className="fig-controls">
				<button
					type="button"
					className="fig-btn"
					aria-pressed={unified}
					onClick={() => setUnified(true)}
				>
					unified
				</button>
				<button
					type="button"
					className="fig-btn"
					aria-pressed={!unified}
					onClick={() => setUnified(false)}
				>
					result
				</button>
			</div>
			<pre>
				{unified
					? lines.map((line, i) => (
							<span
								// biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
								key={i}
								className={`fig-diff-line${line.op ? ` ${line.op}` : ""}`}
							>
								<span className="fig-diff-g">
									{line.op === "add" ? "+" : line.op === "del" ? "-" : " "}
								</span>
								{line.text}
							</span>
						))
					: after.map((text, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
							<span key={i} className="fig-diff-line">
								<span className="fig-diff-g"> </span>
								{text}
							</span>
						))}
			</pre>
		</div>
	);
}
