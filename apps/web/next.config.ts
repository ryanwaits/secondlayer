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
	// /docs was collapsed back into the marketing surface; everything lives at
	// the root now. Old inbound links (tweets, READMEs, MCP server defaults)
	// 301 to the new top-level paths.
	async redirects() {
		// /docs/<product>          → /<product>
		// /docs/datasets/<slug>    → /datasets/<slug>
		// /docs/migration/<slug>   → /migration/<slug>
		const productPaths = [
			"streams",
			"subgraphs",
			"subscriptions",
			"datasets",
			"migration",
		];
		// /docs/cli, /docs/sdk, /docs/mcp, /docs/stacks all consolidated into /tools.
		const toolsPaths = ["cli", "sdk", "mcp", "stacks"];
		const docsRedirects = [
			{ source: "/docs", destination: "/", permanent: true },
			...productPaths.map((p) => ({
				source: `/docs/${p}`,
				destination: `/${p}`,
				permanent: true,
			})),
			...productPaths.map((p) => ({
				source: `/docs/${p}/:path*`,
				destination: `/${p}/:path*`,
				permanent: true,
			})),
			...toolsPaths.map((p) => ({
				source: `/docs/${p}`,
				destination: `/tools#${p}`,
				permanent: true,
			})),
		];
		// Workflow + sentry packages were deprecated in the 2026-04-23 pivot;
		// inbound traffic lands on Subscriptions or the migration guide.
		const deprecatedRedirects = [
			{ source: "/workflows", destination: "/subscriptions", permanent: true },
			{
				source: "/workflows/:path*",
				destination: "/subscriptions",
				permanent: true,
			},
			{ source: "/sentries", destination: "/subscriptions", permanent: true },
			{
				source: "/sentries/:path*",
				destination: "/subscriptions",
				permanent: true,
			},
			{
				source: "/docs/workflows",
				destination: "/migration/v1-to-v2",
				permanent: true,
			},
			{
				source: "/docs/sentries",
				destination: "/migration/v1-to-v2",
				permanent: true,
			},
		];
		return [...docsRedirects, ...deprecatedRedirects];
	},
};

export default nextConfig;
