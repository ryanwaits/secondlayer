import type { Metadata } from "next";
import { socialMeta } from "./og";

/**
 * Stays dependency-free of app code beyond og.ts (scripts/generate-og.tsx
 * imports it with a relative path).
 */
export type WritingPost = {
	slug: string;
	number: number;
	title: string;
	dek: string;
	date: string;
	readingTime: string;
	notes?: "inline" | "popover";
	status: "draft" | "published";
	related: readonly { href: string; label: string }[];
};

export const POSTS: WritingPost[] = [
	{
		slug: "not-in-any-public-api",
		number: 1,
		title: "Your contract's data isn't in any public API",
		dek: "Public APIs index what every app shares, so your contract's data isn't there. What that leaves you with, and the indexer we built instead.",
		date: "2026-08-15",
		readingTime: "4 min",
		notes: "popover",
		status: "published",
		related: [
			{ href: "/p/subgraphs", label: "Subgraphs" },
			{
				href: "/docs/guides/index-contract-into-postgres",
				label: "Index a contract into Postgres",
			},
		],
	},
	{
		slug: "an-index-you-can-check",
		number: 2,
		title: "An index you can check, starting with a bridge",
		dek: "Every indexer asks you to trust its answers. We're building one you can check, and the first test is a bridge from Stacks to Robinhood Chain.",
		date: "2026-10-14",
		readingTime: "5 min",
		notes: "popover",
		status: "published",
		related: [
			{ href: "/verify", label: "Verify" },
			{
				href: "/docs/guides/decode-print-events",
				label: "Decode Clarity print events",
			},
		],
	},
	{
		slug: "clarity-state-from-genesis",
		number: 3,
		title: "Every Clarity state change on Stacks, indexed from genesis",
		dek: "Maps, data vars and inner calls from every Clarity contract, as rows from block 1 and checked against each block. What that opens up for apps, wallets and protocols.",
		date: "2026-11-05",
		readingTime: "5 min",
		notes: "popover",
		status: "published",
		related: [
			{ href: "/docs/subgraphs", label: "Subgraphs" },
			{ href: "/docs/webhooks", label: "Webhooks" },
		],
	},
];

const SHOW_DRAFTS = process.env.NODE_ENV !== "production";

export function getVisiblePosts(): WritingPost[] {
	return POSTS.filter((p) => p.status === "published" || SHOW_DRAFTS);
}

export function getPublishedPosts(): WritingPost[] {
	return POSTS.filter((p) => p.status === "published");
}

const NEW_FOR_MS = 14 * 24 * 60 * 60 * 1000;

export function isNew(post: WritingPost, now = Date.now()): boolean {
	const age = now - Date.parse(`${post.date}T00:00:00Z`);
	return post.status === "published" && age >= 0 && age < NEW_FOR_MS;
}

export function getPost(slug: string): WritingPost | undefined {
	return POSTS.find((p) => p.slug === slug);
}

export function longDate(date: string): string {
	return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
}

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
