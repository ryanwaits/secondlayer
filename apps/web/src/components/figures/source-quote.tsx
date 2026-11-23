import type { ReactNode } from "react";

export function SourceQuote({
	source,
	author,
	date,
	href,
	children,
}: {
	source: string;
	author?: string;
	date?: string;
	href?: string;
	children: ReactNode;
}) {
	return (
		<figure className="fig-squote">
			<blockquote cite={href}>{children}</blockquote>
			<figcaption>
				{author && <span className="who">{author}</span>}
				<span className="src">
					{[source, date].filter(Boolean).join(" · ")}
				</span>
				{href && (
					<a href={href}>{href.replace(/^https?:\/\//, "").split("/")[0]} ↗</a>
				)}
			</figcaption>
		</figure>
	);
}
