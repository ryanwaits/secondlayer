import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	experimental: {
		staleTimes: {
			dynamic: 30,
		},
		optimizePackageImports: ["@tanstack/react-query"],
	},
	// Server-only packages that can't be bundled by Turbopack:
	// - @secondlayer/scaffold: ships string templates used by the scaffold tools
	// - @secondlayer/workflows: templates + validators are server-only
	// - diff: unified patch helpers used by the server-side diff route
	//
	// NOTE: @secondlayer/bundler + esbuild were removed here — workflow
	// bundling now happens on the Hetzner API via POST /api/workflows/bundle,
	// and the Vercel session proxy only forwards bytes.
	serverExternalPackages: [
		"@secondlayer/scaffold",
		"@secondlayer/workflows",
		"diff",
	],
	async rewrites() {
		return [
			{
				source: "/site/:path*",
				destination: "/:path*",
			},
		];
	},
};

export default nextConfig;
