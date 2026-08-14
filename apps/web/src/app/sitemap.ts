import { getPublishedPosts } from "@/lib/writing";
import type { MetadataRoute } from "next";

const BASE = "https://www.secondlayer.tools";

const ROUTES = [
	"/",
	"/docs",
	"/docs/self-host",
	"/docs/archive",
	"/archive",
	"/writing",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
	const lastModified = new Date();
	const staticRoutes: MetadataRoute.Sitemap = ROUTES.map((path) => ({
		url: `${BASE}${path}`,
		lastModified,
		changeFrequency: path === "/" ? "weekly" : "monthly",
		priority: path === "/" ? 1 : 0.6,
	}));
	// Published posts only — drafts and the /writing/figures catalog stay out.
	const posts: MetadataRoute.Sitemap = getPublishedPosts().map((post) => ({
		url: `${BASE}/writing/${post.slug}`,
		lastModified: new Date(`${post.date}T00:00:00Z`),
		changeFrequency: "yearly",
		priority: 0.5,
	}));
	return [...staticRoutes, ...posts];
}
