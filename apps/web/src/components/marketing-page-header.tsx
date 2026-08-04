import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Explore-pattern page header for marketing product pages: display headline,
 * optional cursive margin note, lede. Lives inside an `.explore-wrap`
 * container so every marketing page shares the homepage's gutter.
 *
 * The breadcrumb is opt-in. Product and pricing pages carry no crumb — the
 * accent-coloured section in the nav bar is the whole positional cue there.
 * Explore and the writing posts still pass one, because those are the places
 * you land two levels deep and want a way back up.
 */
export function MarketingPageHeader({
	crumb,
	crumbHref,
	here,
	title,
	note,
	children,
}: {
	crumb?: string;
	crumbHref?: string;
	here?: string;
	title: ReactNode;
	note?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<>
			{crumb && (
				<nav className="explore-crumb" aria-label="Breadcrumb">
					{crumbHref ? (
						<Link href={crumbHref}>{crumb}</Link>
					) : (
						<span>{crumb}</span>
					)}
					<span>/</span>
					{here}
				</nav>
			)}
			<section className="explore-hero">
				<h1>{title}</h1>
				{note && (
					<span className="explore-hero-note" aria-hidden="true">
						{note}
					</span>
				)}
				{children && <p>{children}</p>}
			</section>
		</>
	);
}
