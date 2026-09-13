import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Served behind the operator's domain at /console — same prefix whether the
	// container sits behind their reverse proxy or the compose network.
	basePath: "/console",
	// Self-contained server bundle for the console image: node_modules pruned to
	// what the server actually imports, run with `node server.js`.
	output: "standalone",
	async redirects() {
		return [
			{
				source: "/subscriptions", // deprecated alias redirect
				destination: "/webhooks",
				permanent: true,
			},
			{
				source: "/subgraphs/:name/subscriptions", // deprecated alias redirect
				destination: "/subgraphs/:name/webhooks",
				permanent: true,
			},
			{
				source: "/subgraphs/:name/subscriptions/:path*", // deprecated alias redirect
				destination: "/subgraphs/:name/webhooks/:path*",
				permanent: true,
			},
		];
	},
};

export default nextConfig;
