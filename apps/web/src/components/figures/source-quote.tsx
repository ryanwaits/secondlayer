import type { ReactNode } from "react";

/**
 * A11 SourceQuote — a cited pull-quote from a spec, contract, paper or post.
 * Deliberately unnumbered: it sits in the prose flow, not the figure
 * sequence. Static. Wrap the one phrase the paragraph is about in `<mark>`
 * (brand yellow, the same rule as `!mark` on code). Verbatim words only:
 * a paraphrase never wears quote marks.
 */
export function SourceQuote({
	source,
	author,
	date,
	href,
	children,
}: {
	/** What is quoted: a document, a file, a post title. */
	source: string;
	/** Who wrote it, when it is a person's words. */
	author?: string;
	/** When it was written, as printed ("May 2022"). */
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
