import type { ReactNode } from "react";

/**
 * A11 SourceQuote — a cited pull-quote from a spec, contract, or paper.
 * Deliberately unnumbered: it sits in the prose flow, not the figure
 * sequence. Static.
 */
export function SourceQuote({
	source,
	href,
	children,
}: {
	source: string;
	href?: string;
	children: ReactNode;
}) {
	return (
		<figure className="fig-squote">
			<blockquote>{children}</blockquote>
			<figcaption>
				{source}
				{href && (
					<>
						{" · "}
						<a href={href}>{href.replace(/^https?:\/\//, "")}</a>
					</>
				)}
			</figcaption>
		</figure>
	);
}
