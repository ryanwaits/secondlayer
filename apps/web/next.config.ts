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
	async headers() {
		// This is an authenticated console that performs one-click destructive
		// and financial actions (revoke key, cancel plan), and the magic-link
		// verify page reads its token from the URL. Nothing in this app
		// legitimately iframes it (grep for "iframe" across src/ turns up
		// nothing), so denying framing outright is safe.
		//
		// The CSP below ships report-only. A strict enforcing policy can break
		// inline styles — enforcing it is a follow-up, not part of this change.
		return [
			{
				source: "/:path*",
				headers: [
					{
						key: "Referrer-Policy",
						value: "strict-origin-when-cross-origin",
					},
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{
						key: "Content-Security-Policy-Report-Only",
						value: [
							"default-src 'self'",
							"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.posthog.com",
							"style-src 'self' 'unsafe-inline'",
							"img-src 'self' data: https:",
							"font-src 'self' data:",
							// Wildcard rather than ${NEXT_PUBLIC_POSTHOG_HOST}: the SDK talks
							// to more than the ingestion host (assets and replay bundles come
							// from us-assets.i.posthog.com), and interpolating an env var into
							// a security header means an unset var silently renders a policy
							// with no PostHog origin at all.
							"connect-src 'self' https://*.posthog.com",
							"worker-src 'self' blob: data:",
							"frame-ancestors 'none'",
							"base-uri 'self'",
						].join("; "),
					},
				],
			},
		];
	},
	async redirects() {
		// Workflow + sentry packages were deprecated in the 2026-04-23 pivot;
		// inbound traffic lands on Subscriptions or the migration guide.
		// (The former /docs → / collapse was reverted: /docs is now the docs site.)
		return [
			{
				// Index product page route renamed /index-api → /indexes.
				source: "/index-api",
				destination: "/indexes",
				permanent: true,
			},
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
