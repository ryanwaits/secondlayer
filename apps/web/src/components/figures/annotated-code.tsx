"use client";

import { useHoverPin } from "./use-hover-pin";

/**
 * A6 AnnotatedCode — logic explained line by line (A4's sibling:
 * payloads get field notes, logic gets line notes). Lines are buttons;
 * hover, focus, or tap lights the margin note. Lines may share a note.
 */
export function AnnotatedCode({
	lines,
	notes,
}: {
	lines: { code: string; note: string }[];
	notes: { id: string; label: string; body: string }[];
}) {
	const { active, bind } = useHoverPin();

	return (
		<div className="fig-acode">
			<pre>
				{lines.map((line, i) => (
					<button
						// biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
						key={i}
						type="button"
						className={active === line.note ? "fig-aline on" : "fig-aline"}
						{...bind(line.note)}
					>
						{line.code}
					</button>
				))}
			</pre>
			<div className="fig-notes">
				{notes.map((note) => (
					<div
						key={note.id}
						className={active === note.id ? "fig-note on" : "fig-note"}
					>
						<b>{note.label}</b>: {note.body}
					</div>
				))}
			</div>
		</div>
	);
}
