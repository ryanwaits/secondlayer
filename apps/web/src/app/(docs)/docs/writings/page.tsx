import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";
import { groupWritingsByYear, writings } from "./posts";

export const metadata: Metadata = {
	title: "Writings | secondlayer",
	description:
		"Notes, post-mortems, and architecture pieces from the team building Second Layer.",
};

export default function WritingsPage() {
	const grouped = groupWritingsByYear(writings);
	const toc: TocItem[] = grouped.map((group) => ({
		label: String(group.year),
		href: `#${group.year}`,
	}));

	return (
		<div className="article-layout">
			<Sidebar title="Writings" toc={toc} />
			<WritingsIndexContent />
		</div>
	);
}

export function WritingsIndexContent() {
	const grouped = groupWritingsByYear(writings);

	return (
		<main className="content-area">
			<header className="page-header">
				<h1 className="page-title">Writings</h1>
			</header>

			<section
				className="index-group"
				style={{ marginTop: "var(--spacing-xl)" }}
			>
				{grouped.map((group) => (
					<div
						key={group.year}
						id={String(group.year)}
						className="index-year-group"
					>
						<div className="index-year">{group.year}</div>
						<ul className="index-list">
							{group.posts.map((post) => (
								<li key={post.slug} className="index-item">
									<a
										href={`/writings/${post.slug}`}
										className="index-link"
									>
										<span className="index-link-label">{post.title}</span>
										<span className="index-date">{post.date}</span>
									</a>
								</li>
							))}
						</ul>
					</div>
				))}
			</section>
		</main>
	);
}
