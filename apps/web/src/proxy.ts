import { aiBot } from "@/lib/ai-bots";
import {
	type NextFetchEvent,
	type NextRequest,
	NextResponse,
} from "next/server";

/** Server-side PostHog ingestion; the browser's /ingest rewrite points here. */
const POSTHOG_CAPTURE = "https://us.i.posthog.com/capture/";

/**
 * Records AI crawler fetches of the pages we want found: home, docs, products,
 * blog, data, verify, pricing and llms files. Bots run no client JS, so browser
 * capture never sees them. Always passes through.
 */
export function proxy(request: NextRequest, event: NextFetchEvent) {
	const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
	const bot = aiBot(request.headers.get("user-agent"));
	if (token && bot) {
		event.waitUntil(
			fetch(POSTHOG_CAPTURE, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					api_key: token,
					event: "ai_crawler_fetch",
					distinct_id: bot,
					properties: {
						bot,
						path: request.nextUrl.pathname,
						host: request.headers.get("host"),
						$process_person_profile: false,
					},
				}),
			}).catch(() => {}),
		);
	}
	return NextResponse.next();
}

// Literals only: Next statically analyzes this. Each user-agent value must equal
// AI_BOT_UA_MATCHER (asserted in ai-bots.test.ts), so humans never reach the proxy.
export const config = {
	matcher: [
		{
			source: "/:section(docs|p|blog|data)/:path*",
			has: [
				{
					type: "header",
					key: "user-agent",
					value:
						".*(?:GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|bingbot|Googlebot|CCBot|Applebot).*",
				},
			],
		},
		{
			source: "/:file(llms.txt|llms-full.txt|llms-api.txt|verify|pricing)",
			has: [
				{
					type: "header",
					key: "user-agent",
					value:
						".*(?:GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|bingbot|Googlebot|CCBot|Applebot).*",
				},
			],
		},
		{
			source: "/",
			has: [
				{
					type: "header",
					key: "user-agent",
					value:
						".*(?:GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|bingbot|Googlebot|CCBot|Applebot).*",
				},
			],
		},
	],
};
