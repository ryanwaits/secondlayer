import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	experimental: {
		staleTimes: {
			dynamic: 30,
		},
		optimizePackageImports: ["@tanstack/react-query"],
	},
	// Server-only packages that can't be bundled by Turbopack:
	// - @secondlayer/scaffold: ships string templates used by scaffold tools
	// - diff: unified patch helpers used by the server-side diff route
	serverExternalPackages: ["@secondlayer/scaffold", "diff"],
	async rewrites() {
		return [
			{
				source: "/site/:path*",
				destination: "/:path*",
			},
		];
	},
	// Old top-level reference paths now live under /docs/*. Permanent
	// redirects so existing inbound links + tweets keep working.
	async redirects() {
		// Old top-level reference paths that still exist under /docs/*.
		// Deleted routes (writings, stacks-streams, stacks-index, subscriptions,
		// quickstart) are intentionally absent — those URLs now 404 cleanly.
		const docPaths = [
			"cli",
			"sdk",
			"mcp",
			"stacks",
			"streams",
			"subgraphs",
			"subscriptions",
			"datasets",
		];
		const docRedirects = [
			...docPaths.map((p) => ({
				source: `/${p}`,
				destination: `/docs/${p}`,
				permanent: true,
			})),
			...docPaths.map((p) => ({
				source: `/${p}/:path*`,
				destination: `/docs/${p}/:path*`,
				permanent: true,
			})),
		];
		// Workflow + sentry packages were deprecated in the 2026-04-23 pivot;
		// inbound traffic should land on Subscriptions or the migration guide.
		const deprecatedRedirects = [
			{
				source: "/workflows",
				destination: "/docs/subscriptions",
				permanent: true,
			},
			{
				source: "/workflows/:path*",
				destination: "/docs/subscriptions",
				permanent: true,
			},
			{
				source: "/sentries",
				destination: "/docs/subscriptions",
				permanent: true,
			},
			{
				source: "/sentries/:path*",
				destination: "/docs/subscriptions",
				permanent: true,
			},
			{
				source: "/docs/workflows",
				destination: "/docs/migration/v1-to-v2",
				permanent: true,
			},
			{
				source: "/docs/sentries",
				destination: "/docs/migration/v1-to-v2",
				permanent: true,
			},
		];
		return [...docRedirects, ...deprecatedRedirects];
	},
};

export default nextConfig;
