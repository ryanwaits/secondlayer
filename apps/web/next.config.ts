import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// .mdx files are first-class pages (docs site lives at /docs).
	pageExtensions: ["ts", "tsx", "mdx"],
	// PostHog's ingest paths must not be trailing-slash-redirected out from
	// under the SDK.
	skipTrailingSlashRedirect: true,
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
	async rewrites() {
		return {
			// First-party proxy for PostHog, same slot and rationale the Umami
			// tracker used: ad-blockers and Brave shields blocklist the vendor
			// hosts, so anything loaded cross-origin loses pageviews silently.
			// Serving ingestion from our own origin makes it indistinguishable
			// from app traffic.
			//
			// /ingest/static/* must come first — it is a prefix of /ingest/* and
			// resolves to a different upstream (assets CDN, not ingestion).
			// beforeFiles guarantees both win over the app's /api/* handlers.
			beforeFiles: [
				{
					source: "/ingest/static/:path*",
					destination: "https://us-assets.i.posthog.com/static/:path*",
				},
				{
					source: "/ingest/:path*",
					destination: "https://us.i.posthog.com/:path*",
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
			// /account split into /account/keys and /account/credits. Old links,
			// and Stripe returns issued before the split (?topup=…), still land.
			// Query strings carry over to the destination.
			{
				source: "/account",
				has: [{ type: "query", key: "topup" }],
				destination: "/account/credits",
				permanent: false,
			},
			{
				source: "/account",
				destination: "/account/keys",
				permanent: false,
			},
			{
				source: "/index-api",
				destination: "/docs/index",
				permanent: true,
			},
			{
				source: "/indexes",
				destination: "/docs/index",
				permanent: true,
			},
			{
				source: "/streams",
				destination: "/docs/streams",
				permanent: true,
			},
			{
				source: "/subgraphs/explore",
				destination: "/docs/subgraphs",
				permanent: true,
			},
			{
				source: "/subgraphs/explore/:path*",
				destination: "/docs/subgraphs",
				permanent: true,
			},
			{
				source: "/subscriptions",
				destination: "/docs/webhooks",
				permanent: true,
			},
			{
				source: "/docs/subscriptions",
				destination: "/docs/webhooks",
				permanent: true,
			},
			{
				source: "/docs/subscriptions/:path*",
				destination: "/docs/webhooks/:path*",
				permanent: true,
			},
			{
				source: "/sbtc",
				destination: "/docs/index#sbtc",
				permanent: true,
			},
			{
				source: "/claim/:token",
				destination: "/archive",
				permanent: true,
			},
			// Hosted-era surfaces removed 2026-08: no plans to sell hosted, so
			// pricing and status land on the archive (the paid surface).
			{
				source: "/pricing",
				destination: "/archive",
				permanent: true,
			},
			{
				source: "/status",
				destination: "/archive",
				permanent: true,
			},
			// 2026-08 self-host docs consolidation: platform-specific consumer
			// deploys folded into /docs/deploy, custom sinks into /docs/sinks,
			// x402 into the self-host page.
			{
				source: "/docs/deploy/railway",
				destination: "/docs/deploy",
				permanent: true,
			},
			{
				source: "/docs/deploy/render",
				destination: "/docs/deploy",
				permanent: true,
			},
			{
				source: "/docs/deploy/fly",
				destination: "/docs/deploy",
				permanent: true,
			},
			{
				source: "/docs/deploy/vercel",
				destination: "/docs/deploy",
				permanent: true,
			},
			{
				source: "/docs/custom-sinks",
				destination: "/docs/sinks",
				permanent: true,
			},
			// Filters folded into the SDK page, custom sinks into Sinks, Docker and
			// EC2 into Deploy.
			{
				source: "/docs/filters",
				destination: "/docs/sdk#filters",
				permanent: true,
			},
			{
				source: "/docs/sinks/custom",
				destination: "/docs/sinks#write-your-own-sink",
				permanent: true,
			},
			{
				source: "/docs/deploy/docker",
				destination: "/docs/deploy#docker-and-ec2",
				permanent: true,
			},
			// Quickstart folded into the Introduction's Get started panel.
			{
				source: "/docs/quickstart",
				destination: "/docs#get-started",
				permanent: true,
			},
			// Upgrade lives on the Run in production page.
			{
				source: "/docs/self-host/upgrade",
				destination: "/docs/self-host/production#upgrade",
				permanent: true,
			},
			// Product satellites folded into their parent pages.
			{
				source: "/docs/contracts",
				destination: "/docs/index#find-contracts-by-standard",
				permanent: true,
			},
			{
				source: "/docs/pox5-events",
				destination: "/docs/index#pox-5",
				permanent: true,
			},
			{
				source: "/docs/sbtc-settlement",
				destination: "/docs/index#sbtc",
				permanent: true,
			},
			{
				source: "/docs/runes",
				destination: "/docs/index#runes",
				permanent: true,
			},
			{
				source: "/docs/subgraphs/hosted",
				destination: "/docs/subgraphs",
				permanent: true,
			},
			{
				source: "/docs/webhooks/event-shapes",
				destination: "/docs/webhooks/deliveries#event-shapes",
				permanent: true,
			},
			{
				source: "/docs/x402",
				destination: "/docs/self-host",
				permanent: true,
			},
			{
				source: "/docs/extended",
				destination: "/docs/rest-api",
				permanent: true,
			},
			{
				source: "/docs/console",
				destination: "/docs/self-host",
				permanent: true,
			},
			{
				source: "/workflows",
				destination: "/docs/webhooks",
				permanent: true,
			},
			{
				source: "/workflows/:path*",
				destination: "/docs/webhooks",
				permanent: true,
			},
			{
				source: "/sentries",
				destination: "/docs/webhooks",
				permanent: true,
			},
			{
				source: "/sentries/:path*",
				destination: "/docs/webhooks",
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
			// Library pages moved to stacks.secondlayer.tools (plan 012).
			{
				source: "/docs/stacks",
				destination: "https://stacks.secondlayer.tools/",
				permanent: true,
			},
			{
				source: "/docs/bitcoin-spv",
				destination: "https://stacks.secondlayer.tools/guide/bitcoin-spv",
				permanent: true,
			},
			{
				source: "/docs/pox5",
				destination: "https://stacks.secondlayer.tools/guide/pox5",
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
