import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// .mdx files are first-class pages (docs site lives at /docs).
	pageExtensions: ["ts", "tsx", "mdx"],
	experimental: {
		staleTimes: {
			dynamic: 30,
		},
		optimizePackageImports: ["@tanstack/react-query"],
	},
	async rewrites() {
		return {
			// First-party proxy for the Umami tracker so ad-blockers / Brave shields
			// (which blocklist the umami.* host + /script.js) can't drop pageviews.
			// The tracker loads from /sl.js, derives its collector from that origin,
			// and posts to /api/send — both proxied to the umami container. beforeFiles
			// guarantees these win over the app's other /api/* route handlers.
			beforeFiles: [
				{
					source: "/sl.js",
					destination: "https://umami.secondlayer.tools/script.js",
				},
				{
					source: "/api/send",
					destination: "https://umami.secondlayer.tools/api/send",
				},
			],
			afterFiles: [],
			fallback: [],
		};
	},
	async redirects() {
		// Workflow + sentry packages were deprecated in the 2026-04-23 pivot;
		// inbound traffic lands on Subscriptions or the migration guide.
		// (The former /docs → / collapse was reverted: /docs is now the docs site.)
		return [
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
				destination: "/migration/v1-to-v2",
				permanent: true,
			},
			{
				source: "/docs/sentries",
				destination: "/migration/v1-to-v2",
				permanent: true,
			},
		];
	},
};

// Turbopack requires string-form remark/rehype plugins (functions can't be
// serialized into its pipeline). Code highlighting is handled per-block by a
// custom `pre` component (mdx-components.tsx) reusing our Shiki highlight().
const withMDX = createMDX({
	options: {
		remarkPlugins: [["remark-gfm"]],
		rehypePlugins: [["rehype-slug"]],
	},
});

export default withMDX(nextConfig);
