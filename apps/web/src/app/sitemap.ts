import type { MetadataRoute } from "next";

const BASE = "https://www.secondlayer.tools";

const ROUTES = [
	"/",
	"/pricing",
	"/docs",
	"/docs/cli",
	"/docs/sdk",
	"/docs/mcp",
	"/docs/stacks",
	"/docs/subgraphs",
	"/docs/datasets",
	"/docs/datasets/stx-transfers",
	"/docs/datasets/sbtc",
	"/docs/datasets/pox-4",
	"/docs/datasets/bns",
	"/docs/datasets/network-health",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
	const lastModified = new Date();
	return ROUTES.map((path) => ({
		url: `${BASE}${path}`,
		lastModified,
		changeFrequency: path === "/" || path === "/pricing" ? "weekly" : "monthly",
		priority: path === "/" ? 1 : path.startsWith("/docs/datasets/") ? 0.8 : 0.6,
	}));
}
