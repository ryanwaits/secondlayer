import type { MetadataRoute } from "next";

const BASE = "https://www.secondlayer.tools";

const ROUTES = [
	"/",
	"/streams",
	"/index-api",
	"/subgraphs",
	"/subscriptions",
	"/datasets",
	"/datasets/stx-transfers",
	"/datasets/sbtc",
	"/datasets/pox-4",
	"/datasets/bns",
	"/datasets/network-health",
	"/sdk",
	"/cli",
	"/mcp",
	"/migration/v1-to-v2",
	"/status",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
	const lastModified = new Date();
	return ROUTES.map((path) => ({
		url: `${BASE}${path}`,
		lastModified,
		changeFrequency: path === "/" ? "weekly" : "monthly",
		priority: path === "/" ? 1 : path.startsWith("/datasets/") ? 0.8 : 0.6,
	}));
}
