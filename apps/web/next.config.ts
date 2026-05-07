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
		const docPaths = [
			"cli",
			"sdk",
			"mcp",
			"stacks",
			"stacks-streams",
			"stacks-index",
			"subgraphs",
			"subscriptions",
			"quickstart",
			"datasets",
			"writings",
		];
		return [
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
	},
};

export default nextConfig;
