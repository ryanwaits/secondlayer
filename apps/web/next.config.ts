import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	experimental: {
		staleTimes: {
			dynamic: 30,
		},
		optimizePackageImports: ["@tanstack/react-query"],
	},
	// Server-only packages that can't be bundled by Turbopack:
	// - @secondlayer/bundler / esbuild: native binary + dynamic import(dataUri)
	// - @secondlayer/scaffold: transitively pulls string templates that the
	//   bundler uses; keep it in-process via require() for consistency
	// - @secondlayer/workflows: templates + validators are server-only
	serverExternalPackages: [
		"@secondlayer/bundler",
		"@secondlayer/scaffold",
		"@secondlayer/workflows",
		"esbuild",
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
