import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AI_BOT_PATTERN, aiBot } from "./ai-bots";

describe("aiBot", () => {
	test("names real AI crawler user agents", () => {
		const cases: [string, string][] = [
			[
				"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
				"GPTBot",
			],
			[
				"Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
				"ClaudeBot",
			],
			[
				"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
				"PerplexityBot",
			],
			[
				"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
				"OAI-SearchBot",
			],
		];
		for (const [ua, name] of cases) expect(aiBot(ua)).toBe(name);
	});

	test("returns null for browsers and a missing user agent", () => {
		expect(
			aiBot(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
			),
		).toBeNull();
		expect(
			aiBot(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
			),
		).toBeNull();
		expect(aiBot(null)).toBeNull();
	});
});

describe("proxy matcher", () => {
	const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");

	test("every user-agent condition equals the exported bot pattern", () => {
		expect(source.split(`"${AI_BOT_PATTERN}"`).length - 1).toBe(2);
	});

	test("never matches ingest, next internals or api routes", () => {
		for (const prefix of ["/ingest", "/_next", "/api"]) {
			expect(source).not.toContain(`source: "${prefix}`);
		}
	});
});
