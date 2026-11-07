import {
	type WritingPost,
	getAdjacentPosts,
	getPost,
	getVisiblePosts,
	longDate,
} from "@/lib/writing";
import Link from "next/link";
import { UpdatesSignup, UpdatesUnsubscribe } from "./updates-signup";

function Neighbor({ post, label }: { post: WritingPost; label: string }) {
	return (
		<Link href={`/blog/${post.slug}`}>
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
 * somewhere. Then the post's related pages and the feed, with Unsubscribe
 * at the far end for a reader on the list.
 */
export function PostFooter({ slug }: { slug: string }) {
	const { prev, next } = getAdjacentPosts(slug);
	const count = getVisiblePosts().length;
	const all = (label: string) => (
		<Link href="/blog" className="all">
			<span className="k">{label}</span>
			<span className="t">Back to the blog</span>
			<span className="m">
				{count} {count === 1 ? "post" : "posts"}
			</span>
		</Link>
	);

	return (
		<footer className="writing-end">
			<UpdatesSignup inPost />
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
				{getPost(slug)?.related.map((page) => (
					<Link href={page.href} key={page.href}>
						{page.label}
					</Link>
				))}
				<a href="/feed.xml">RSS</a>
				<UpdatesUnsubscribe />
			</div>
		</footer>
	);
}
