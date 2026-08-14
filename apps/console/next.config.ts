import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Served behind the operator's domain at /console — same prefix whether the
	// container sits behind their reverse proxy or the compose network.
	basePath: "/console",
	// Self-contained server bundle for the console image: node_modules pruned to
	// what the server actually imports, run with `node server.js`.
	output: "standalone",
};

export default nextConfig;
