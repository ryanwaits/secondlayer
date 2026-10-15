import { Eyebrow, Highlight } from "@/components/site";
import { socialMeta } from "@/lib/og";
import { getVisiblePosts, longDate } from "@/lib/writing";
import type { Metadata } from "next";
import Link from "next/link";

const LEDE =
	"Short posts on how we index Stacks and Bitcoin, and how to check our work.";

export const metadata: Metadata = {
	...socialMeta({
		title: "Blog · secondlayer",
		description: LEDE,
		image: "/og/writing.png",
		path: "/writing",
	}),
	alternates: {
		types: { "application/rss+xml": "/feed.xml" },
	},
};

/** The blog index: one ruled row per post, newest first, on the site grid. */
export default function WritingIndexPage() {
	const posts = [...getVisiblePosts()].sort((a, b) => b.number - a.number);

	return (
		<main className="site writing-index">
			<div className="shell">
				<div className="writing-index-head">
					<Eyebrow noun="Blog" />
					<h1>
						Notes from <Highlight>the index.</Highlight>
					</h1>
					<p className="lede">{LEDE}</p>
				</div>
				<div className="writing-ledger">
					{posts.map((post) => (
						<Link key={post.slug} href={`/writing/${post.slug}`}>
							<span className="no">
								<b>{String(post.number).padStart(2, "0")}</b>
								{longDate(post.date)}
							</span>
							<span>
								<span className="t">
									{post.title}
									{post.status === "draft" && (
										<span className="writing-draft-chip">draft</span>
									)}
								</span>
								<span className="d">{post.dek}</span>
							</span>
							<span className="m">
								{post.readingTime} <span className="ar">→</span>
							</span>
						</Link>
					))}
				</div>
			</div>
		</main>
	);
}
