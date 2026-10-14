import { resolve } from "node:path";
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
		// nothing), so denying framing outright is safe. One exception: the
		// Lab's 400px viewport frames its own /lab/frame/* pages, same-origin
		// only, and those routes 404 outside dev/preview (labEnabled()).
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
							// The browser calls the API directly for public forms, the status
							// odometer and the block checker.
							"connect-src 'self' https://*.posthog.com https://api.secondlayer.tools",
							"worker-src 'self' blob: data:",
							"frame-ancestors 'none'",
							"base-uri 'self'",
						].join("; "),
					},
				],
			},
			{
				source: "/lab/frame/:path*",
				headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
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
			// Stripe returns issued before /account/credits existed (?topup=…)
			// still land on it. /account itself is the Overview page. Query
			// strings carry over to the destination.
			{
				source: "/account",
				has: [{ type: "query", key: "topup" }],
				destination: "/account/credits",
				permanent: false,
			},
			{
				source: "/docs/migrate-chainhook",
				destination: "/docs/webhooks#coming-from-chainhook",
				permanent: true,
			},
			{
				source: "/index-api",
				destination: "/docs/index",
				permanent: true,
			},
			{
				source: "/indexes",
				destination: "/p/index",
				permanent: true,
			},
			// Product pages live under /p so no route (e.g. `index`) shadows the home page.
			// No /index redirect: Next maps /index to /, so it would redirect home.
			{
				source: "/archive",
				destination: "/p/archive",
				permanent: true,
			},
			{
				source: "/streams",
				destination: "/p/streams",
				permanent: true,
			},
			{
				source: "/webhooks",
				destination: "/p/webhooks",
				permanent: true,
			},
			{
				source: "/subgraphs",
				destination: "/p/subgraphs",
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
				destination: "/p/webhooks",
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
				destination: "/p/archive",
				permanent: true,
			},
			// Sign-in links already in inboxes point at /verify?token=; the
			// token handler now lives at /auth/verify.
			{
				source: "/verify",
				has: [{ type: "query", key: "token" }],
				destination: "/auth/verify",
				permanent: false,
			},
			// No hosted status page: it lands on the archive.
			{
				source: "/status",
				destination: "/p/archive",
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
			// Upgrade lives on the Self-host page.
			{
				source: "/docs/self-host/upgrade",
				destination: "/docs/self-host#upgrade",
				permanent: true,
			},
			// Child pages folded into their parents. Hashless on purpose: a browser
			// keeps a shipped link's #fragment across the redirect, and each
			// section kept its original id on the parent.
			{
				source: "/docs/self-host/production",
				destination: "/docs/self-host",
				permanent: true,
			},
			{
				source: "/docs/self-host/production.md",
				destination: "/docs/self-host.md",
				permanent: true,
			},
			{
				source: "/docs/self-host/hardware",
				destination: "/docs/self-host",
				permanent: true,
			},
			{
				source: "/docs/self-host/hardware.md",
				destination: "/docs/self-host.md",
				permanent: true,
			},
			{
				source: "/docs/subgraphs/handlers",
				destination: "/docs/subgraphs",
				permanent: true,
			},
			{
				source: "/docs/subgraphs/handlers.md",
				destination: "/docs/subgraphs.md",
				permanent: true,
			},
			{
				source: "/docs/subgraphs/reading",
				destination: "/docs/subgraphs",
				permanent: true,
			},
			{
				source: "/docs/subgraphs/reading.md",
				destination: "/docs/subgraphs.md",
				permanent: true,
			},
			{
				source: "/docs/webhooks/deliveries",
				destination: "/docs/webhooks",
				permanent: true,
			},
			{
				source: "/docs/webhooks/deliveries.md",
				destination: "/docs/webhooks.md",
				permanent: true,
			},
			{
				source: "/docs/devnet",
				destination: "/docs/cli",
				permanent: true,
			},
			{
				source: "/docs/devnet.md",
				destination: "/docs/cli.md",
				permanent: true,
			},
			// The changelog archive folded into the changelog's Older releases.
			{
				source: "/docs/changelog/archive",
				destination: "/docs/changelog#older-releases",
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
				destination: "/docs/webhooks#event-shapes",
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
				destination: "/docs/webhooks",
				permanent: true,
			},
			{
				source: "/docs/sentries",
				destination: "/docs/webhooks",
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
// custom `pre` component (mdx-components.tsx), which renders `<Code>`.
// remark-code-meta is registered by absolute path: the loader resolves string
// plugins from node_modules, so a relative "./src/…" path is not found in dev.
const withMDX = createMDX({
	options: {
		remarkPlugins: [
			["remark-gfm"],
			[resolve(process.cwd(), "src/lib/remark-code-meta.mjs")],
		],
		rehypePlugins: [["rehype-slug"]],
	},
});

export default withMDX(nextConfig);
