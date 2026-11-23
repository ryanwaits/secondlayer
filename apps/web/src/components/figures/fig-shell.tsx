import type { ReactNode } from "react";

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
