import { socialMeta } from "@/lib/og";
import { getVisiblePosts } from "@/lib/writing";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	...socialMeta({
		title: "Writing — secondlayer",
		description:
			"Long-form, mechanism-first posts on indexers, consumers, and the systems underneath: how they work and what to expect from them.",
		image: "/og/writing.png",
		path: "/writing",
	}),
	alternates: {
		types: { "application/rss+xml": "/feed.xml" },
	},
};

export default function WritingIndexPage() {
	const posts = getVisiblePosts();

	return (
		<main className="writing-shell">
			<header className="writing-index-head">
				<div className="writing-index-eyebrow">Writings</div>
				<h1 className="writing-index-title">Mechanism, explained</h1>
				<p className="writing-index-dek">
					Long-form technical guides to how our systems work and what to expect
					from them. Built from the same figures and data they describe.
				</p>
			</header>
			<div className="writing-index-list">
				{posts.map((post) => (
					<Link
						key={post.slug}
						href={`/writing/${post.slug}`}
						className="writing-index-row"
					>
						<span className="writing-index-no">
							{String(post.number).padStart(2, "0")}
						</span>
						<span className="writing-index-main">
							<span className="writing-index-post-title">
								{post.title}
								{post.status === "draft" && (
									<span className="writing-draft-chip">draft</span>
								)}
							</span>
							<span className="writing-index-post-dek">{post.dek}</span>
						</span>
						<span className="writing-index-date">{post.date}</span>
					</Link>
				))}
			</div>
		</main>
	);
}
