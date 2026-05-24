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
			// The Index product page lives at /index-page on disk: a top-level
			// app/index/ segment collides with the root's index.html output on
			// Vercel (ENOENT app/index.html). Serve it at the canonical /index.
			{
				source: "/index",
				destination: "/index-page",
			},
		];
	},
	async redirects() {
		// Workflow + sentry packages were deprecated in the 2026-04-23 pivot;
		// inbound traffic lands on Subscriptions or the migration guide.
		// (The former /docs → / collapse was reverted: /docs is now the docs site.)
		return [
			// Canonicalize the on-disk path back to /index (see rewrites()).
			{ source: "/index-page", destination: "/index", permanent: true },
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
