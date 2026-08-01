import type { ReactNode } from "react";

/**
 * Shared figure chrome: "Fig. N" eyebrow, title, body, caption. Every
 * library figure composes into this. Numbering is an explicit prop so
 * prose references ("see Fig. 3") and the rendered label can't drift.
 * SourceQuote (A11) is the one deliberate exception — an unnumbered
 * pull-quote that sits directly in the prose flow.
 */
export function FigShell({
	n,
	title,
	caption,
	children,
}: {
	n: number;
	title: string;
	caption?: ReactNode;
	children: ReactNode;
}) {
	return (
		<figure className="fig" id={`fig-${n}`}>
			<div className="fig-head">
				<span className="fig-no">Fig. {n}</span>
				<span className="fig-title">{title}</span>
			</div>
			<div className="fig-body">{children}</div>
			{caption && <figcaption className="fig-caption">{caption}</figcaption>}
		</figure>
	);
}
