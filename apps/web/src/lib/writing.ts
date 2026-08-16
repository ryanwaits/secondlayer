import type { Metadata } from "next";
import { socialMeta } from "./og";

/**
 * Writings registry — the single source of post metadata. Posts are
 * per-directory page.mdx files under src/app/(www)/writing/(post)/<slug>/;
 * this file feeds the index page, sitemap, RSS feed, and OG cards, so it
 * stays dependency-free of app code beyond og.ts (scripts/generate-og.tsx
 * imports it with a relative path).
 */
export type WritingPost = {
	slug: string;
	/** Sequential post number, shown as the mono "Writings · 01" eyebrow. */
	number: number;
	title: string;
	/** One-paragraph standfirst under the title; doubles as meta description. */
	dek: string;
	/** ISO date (YYYY-MM-DD) of publication. */
	date: string;
	tags: string[];
	readingTime: string;
	/** Figure titles in order — feeds the post's meta-rail figure index
	 *  (jump links to #fig-N anchors). Omit to hide the index. */
	figures?: string[];
	/**
	 * How this post surfaces its Sidenotes. "inline" drops a ruled aside into
	 * the column; "popover" keeps the column unbroken and opens the note from
	 * its marker. Per post on purpose — a piece heavy on hedges reads better
	 * inline, a tight argument reads better undisturbed. Defaults to inline.
	 */
	notes?: "inline" | "popover";
	/** Drafts render in dev but 404 in production and never hit sitemap/RSS. */
	status: "draft" | "published";
};

export const POSTS: WritingPost[] = [
	{
		slug: "checkpoint-receipt-not-bookmark",
		number: 1,
		title: "Why your indexer resumes from the same block",
		dek: "Restart a consumer and it logs the same cursor it logged an hour ago, forty thousand blocks behind the tip. It's caught up: the checkpoint marks the last row it kept, and the other numbers on the health endpoint measure something else.",
		date: "2026-08-01",
		tags: ["indexers", "checkpoints"],
		readingTime: "8 min",
		notes: "popover",
		figures: [
			"timeline of heights",
			"the poll, as a spec",
			"seeks per restart",
			"crash asymmetry",
			"selectivity explorer",
		],
		status: "published",
	},
	{
		slug: "not-in-anyones-api",
		number: 2,
		title: "The data your app needs isn't in anyone's API",
		dek: "Public APIs index what's general, and your contract is specific by definition. Here's why that gap never closes on its own, what it leaves you with, and what we built instead.",
		date: "2026-08-15",
		tags: ["indexers", "stacks"],
		readingTime: "6 min",
		notes: "popover",
		figures: ["the one choice"],
		status: "published",
	},
];

const SHOW_DRAFTS = process.env.NODE_ENV !== "production";

/** Posts for the /writing index — drafts included in dev only. */
export function getVisiblePosts(): WritingPost[] {
	return POSTS.filter((p) => p.status === "published" || SHOW_DRAFTS);
}

/** Posts for sitemap/RSS/OG — never drafts, regardless of environment. */
export function getPublishedPosts(): WritingPost[] {
	return POSTS.filter((p) => p.status === "published");
}

export function getPost(slug: string): WritingPost | undefined {
	return POSTS.find((p) => p.slug === slug);
}

/** Previous/next among visible posts, by number (continuum footer). */
export function getAdjacentPosts(slug: string): {
	prev: WritingPost | undefined;
	next: WritingPost | undefined;
} {
	const posts = [...getVisiblePosts()].sort((a, b) => a.number - b.number);
	const i = posts.findIndex((p) => p.slug === slug);
	return {
		prev: i > 0 ? posts[i - 1] : undefined,
		next: i >= 0 && i < posts.length - 1 ? posts[i + 1] : undefined,
	};
}

/** Per-post Metadata: title/description/OG card from the registry entry. */
export function postMeta(slug: string): Metadata {
	const post = getPost(slug);
	if (!post) throw new Error(`Unknown writing post: ${slug}`);
	return socialMeta({
		title: `${post.title} — secondlayer`,
		description: post.dek,
		image: `/og/writing-${post.slug}.png`,
		path: `/writing/${post.slug}`,
	});
}
