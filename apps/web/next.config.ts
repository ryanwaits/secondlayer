import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	experimental: {
		staleTimes: {
			dynamic: 30,
		},
		optimizePackageImports: ["@tanstack/react-query"],
	},
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
