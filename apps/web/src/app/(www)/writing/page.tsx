import { PostVignette } from "@/components/writing/vignettes";
import { socialMeta } from "@/lib/og";
import { type WritingPost, getVisiblePosts } from "@/lib/writing";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	...socialMeta({
		title: "Blog · secondlayer",
		description:
			"Long-form, mechanism-first posts on indexers, consumers, and the systems underneath: how they work and what to expect from them.",
		image: "/og/writing.png",
		path: "/writing",
	}),
	alternates: {
		types: { "application/rss+xml": "/feed.xml" },
	},
};

function monthLabel(date: string): string {
	return new Date(`${date}T00:00:00Z`)
		.toLocaleDateString("en-US", {
			month: "long",
			year: "numeric",
			timeZone: "UTC",
		})
		.toUpperCase();
}

function FeaturePost({ post }: { post: WritingPost }) {
	const vignette = <PostVignette slug={post.slug} />;
	return (
		<Link
			href={`/writing/${post.slug}`}
			className={`writing-feature${vignette ? "" : " no-fig"}`}
		>
			<span className="writing-feature-main">
				<span className="writing-feature-no">
					{String(post.number).padStart(2, "0")} · {monthLabel(post.date)}
					{post.status === "draft" && (
						<span className="writing-draft-chip">draft</span>
					)}
				</span>
				<span className="writing-feature-t">{post.title}</span>
				<span className="writing-feature-d">{post.dek}</span>
				<span className="writing-feature-m">
					{post.readingTime} · {post.tags.join(" · ")}
				</span>
			</span>
			{vignette && <span className="writing-feature-fig">{vignette}</span>}
		</Link>
	);
}

/** Front-page index: the newest post leads with its signature figure;
 *  everything older drops into a two-column ledger below the rule. */
export default function WritingIndexPage() {
	const posts = [...getVisiblePosts()].sort((a, b) => b.number - a.number);
	const [feature, ...rest] = posts;

	return (
		<main className="writing-front">
			{feature && <FeaturePost post={feature} />}
			{rest.length > 0 && (
				<div className="writing-rest">
					{rest.map((post) => (
						<Link
							key={post.slug}
							href={`/writing/${post.slug}`}
							className="writing-rest-row"
						>
							<span className="writing-index-no">
								{String(post.number).padStart(2, "0")}
							</span>
							<span>
								<span className="t">
									{post.title}
									{post.status === "draft" && (
										<span className="writing-draft-chip">draft</span>
									)}
								</span>
								<span className="d">{post.dek}</span>
								<span className="m">
									{post.date} · {post.readingTime}
								</span>
							</span>
						</Link>
					))}
				</div>
			)}
		</main>
	);
}
