import type { Metadata } from "next";
import { socialMeta } from "./og";

/**
 * Writings registry — the single source of post metadata. Posts are
 * per-directory page.mdx files under src/app/(www)/blog/(post)/<slug>/;
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
	readingTime: string;
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
		slug: "resuming-from-the-same-block",
		number: 1,
		title: "Why your indexer resumes from the same block",
		dek: "Restart a consumer on a quiet feed and it logs yesterday's cursor, far behind the tip. Why it's caught up anyway, and which height to alert on.",
		date: "2026-08-01",
		readingTime: "5 min",
		notes: "popover",
		status: "published",
	},
	{
		slug: "not-in-any-public-api",
		number: 2,
		title: "Your contract's data isn't in any public API",
		dek: "Public APIs index what every app shares, so your contract's data isn't there. What that leaves you with, and the indexer we built instead.",
		date: "2026-08-15",
		readingTime: "4 min",
		notes: "popover",
		status: "published",
	},
	{
		slug: "an-index-you-can-check",
		number: 3,
		title: "An index you can check, starting with a bridge",
		dek: "Every indexer asks you to trust its answers. We're building one you can check, and the first test is a bridge from Stacks to Robinhood Chain.",
		date: "2026-10-14",
		readingTime: "5 min",
		notes: "popover",
		status: "published",
	},
];

const SHOW_DRAFTS = process.env.NODE_ENV !== "production";

/** Posts for the /blog index — drafts included in dev only. */
export function getVisiblePosts(): WritingPost[] {
	return POSTS.filter((p) => p.status === "published" || SHOW_DRAFTS);
}

/** Posts for sitemap/RSS/OG — never drafts, regardless of environment. */
export function getPublishedPosts(): WritingPost[] {
	return POSTS.filter((p) => p.status === "published");
}

/** How long a published post wears the "new" chip, counted from its date. */
const NEW_FOR_MS = 14 * 24 * 60 * 60 * 1000;

/** A published post dated within the last two weeks. */
export function isNew(post: WritingPost, now = Date.now()): boolean {
	const age = now - Date.parse(`${post.date}T00:00:00Z`);
	return post.status === "published" && age >= 0 && age < NEW_FOR_MS;
}

export function getPost(slug: string): WritingPost | undefined {
	return POSTS.find((p) => p.slug === slug);
}

/** "August 15, 2026": how the index, rail and footer print a post's date. */
export function longDate(date: string): string {
	return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
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
	const meta = socialMeta({
		title: post.title,
		description: post.dek,
		image: `/og/writing-${post.slug}.png`,
		path: `/blog/${post.slug}`,
	});
	return {
		...meta,
		openGraph: {
			...meta.openGraph,
			type: "article",
			publishedTime: `${post.date}T00:00:00Z`,
			authors: ["Ryan Waits"],
		},
	};
}
