import {
	type WritingPost,
	getAdjacentPosts,
	getPost,
	getVisiblePosts,
	longDate,
} from "@/lib/writing";
import Link from "next/link";

function Neighbor({ post, label }: { post: WritingPost; label: string }) {
	return (
		<Link href={`/writing/${post.slug}`}>
			<span className="k">{label}</span>
			<span className="t">{post.title}</span>
			<span className="m">
				{longDate(post.date)} · {post.readingTime}
			</span>
		</Link>
	);
}

/**
 * The end of a post: the previous and next posts, and where a neighbor is
 * missing, the way back to every post, so the newest post still leads
 * somewhere. Then the post's tags and the feed.
 */
export function PostFooter({ slug }: { slug: string }) {
	const { prev, next } = getAdjacentPosts(slug);
	const post = getPost(slug);
	const count = getVisiblePosts().length;
	const all = (label: string) => (
		<Link href="/writing" className="all">
			<span className="k">{label}</span>
			<span className="t">Back to the blog</span>
			<span className="m">
				{count} {count === 1 ? "post" : "posts"}
			</span>
		</Link>
	);

	return (
		<footer className="writing-end">
			<nav className="writing-next" aria-label="More posts">
				{prev ? (
					<Neighbor post={prev} label="← Previous" />
				) : (
					all("← All posts")
				)}
				{next ? (
					<Neighbor post={next} label="Next →" />
				) : prev ? (
					all("All posts →")
				) : null}
			</nav>
			<div className="writing-end-row">
				{post ? <span>Filed under {post.tags.join(" · ")}</span> : <span />}
				<a href="/feed.xml">RSS</a>
			</div>
		</footer>
	);
}
