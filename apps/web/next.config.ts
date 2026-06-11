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
		return [
			{
				source: "/site/:path*",
				destination: "/:path*",
			},
		];
	},
	async redirects() {
		// Workflow + sentry packages were deprecated in the 2026-04-23 pivot;
		// inbound traffic lands on Subscriptions or the migration guide.
		// (The former /docs → / collapse was reverted: /docs is now the docs site.)
		return [
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
