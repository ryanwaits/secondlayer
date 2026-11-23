import { docsNavPages } from "@/app/(www)/docs/nav";
import { dataPath, liveDataTopics } from "@/lib/data-topics";
import { getPublishedPosts } from "@/lib/writing";
import type { MetadataRoute } from "next";

const BASE = "https://www.secondlayer.tools";

export const ROUTES = [
	"/",
	"/p/archive",
	"/p/index",
	"/p/streams",
	"/p/subgraphs",
	"/p/webhooks",
	"/verify",
	"/pricing",
	"/contact",
	"/blog",
	"/robinhood",
	"/robinhood/guide",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
	// No lastModified on static routes: a build-time stamp marks every page
	// changed on every deploy, which crawlers learn to ignore.
	const staticRoutes: MetadataRoute.Sitemap = ROUTES.map((path) => ({
		url: `${BASE}${path}`,
		changeFrequency: path === "/" ? "weekly" : "monthly",
		priority: path === "/" ? 1 : 0.6,
	}));
	const docs: MetadataRoute.Sitemap = [
		...new Set(docsNavPages().map((page) => page.href.split("#")[0])),
	].map((path) => ({
		url: `${BASE}${path}`,
		changeFrequency: "weekly",
		priority: path === "/docs" ? 0.8 : 0.7,
	}));
	const data: MetadataRoute.Sitemap = liveDataTopics().map((topic) => ({
		url: `${BASE}${dataPath(topic)}`,
		changeFrequency: "monthly",
		priority: 0.7,
	}));
	const posts: MetadataRoute.Sitemap = getPublishedPosts().map((post) => ({
		url: `${BASE}/blog/${post.slug}`,
		lastModified: new Date(`${post.date}T00:00:00Z`),
		changeFrequency: "yearly",
		priority: 0.5,
	}));
	return [...staticRoutes, ...data, ...docs, ...posts];
}
