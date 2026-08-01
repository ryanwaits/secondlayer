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
	/** Drafts render in dev but 404 in production and never hit sitemap/RSS. */
	status: "draft" | "published";
};

export const POSTS: WritingPost[] = [
	{
		slug: "checkpoint-receipt-not-bookmark",
		number: 1,
		title: "The checkpoint is a receipt, not a bookmark",
		dek: "Restart a consumer and it logs the same cursor it logged an hour ago, forty thousand blocks behind the tip. Nothing is stuck. Here's how to read every number your indexer reports, and why the design works this way.",
		date: "2026-08-01",
		tags: ["indexers", "checkpoints"],
		readingTime: "8 min",
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
