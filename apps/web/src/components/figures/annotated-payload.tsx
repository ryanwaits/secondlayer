"use client";

import { useHoverPin } from "./use-hover-pin";

export type PayloadSegment = string | { id: string; text: string };

/**
 * A4 AnnotatedPayload — a JSON/wire shape explained field by field.
 * Hover or focus a field to light its note; a tap pins it. Fields are
 * real buttons, keyboard reachable.
 */
export function AnnotatedPayload({
	segments,
	notes,
}: {
	/** The payload, split into plain strings and annotated fields. */
	segments: PayloadSegment[];
	notes: { id: string; label: string; body: string }[];
}) {
	const { active, bind } = useHoverPin();

	return (
		<div className="fig-payload">
			<pre>
				{segments.map((seg, i) =>
					typeof seg === "string" ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: static segment list
						<span key={i}>{seg}</span>
					) : (
						<button
							key={seg.id}
							type="button"
							className={active === seg.id ? "fig-fld on" : "fig-fld"}
							{...bind(seg.id)}
						>
							{seg.text}
						</button>
					),
				)}
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
