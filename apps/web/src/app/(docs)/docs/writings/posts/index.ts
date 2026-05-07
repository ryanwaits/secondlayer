import type { ComponentType } from "react";
import type { Metadata } from "next";

import {
	WelcomeContent,
	welcomeMeta,
} from "./welcome";

export type WritingPost = {
	slug: string;
	title: string;
	description: string;
	/** ISO-8601 date the post was published, e.g. `2026-05-06`. */
	date: string;
	/** UTC year for grouping in the index. */
	year: number;
	Component: ComponentType;
	metadata?: Partial<Metadata>;
};

export const writings: WritingPost[] = [
	{
		slug: "welcome",
		title: welcomeMeta.title,
		description: welcomeMeta.description,
		date: welcomeMeta.date,
		year: welcomeMeta.year,
		Component: WelcomeContent,
	},
];

export function getWritingBySlug(slug: string): WritingPost | undefined {
	return writings.find((post) => post.slug === slug);
}

export function groupWritingsByYear(
	posts: readonly WritingPost[],
): { year: number; posts: WritingPost[] }[] {
	const map = new Map<number, WritingPost[]>();
	for (const post of posts) {
		const list = map.get(post.year) ?? [];
		list.push(post);
		map.set(post.year, list);
	}
	const grouped = Array.from(map.entries()).map(([year, posts]) => ({
		year,
		posts: [...posts].sort((a, b) => (a.date < b.date ? 1 : -1)),
	}));
	grouped.sort((a, b) => b.year - a.year);
	return grouped;
}
