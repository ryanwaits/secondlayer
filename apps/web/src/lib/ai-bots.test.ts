import { describe, expect, test } from "bun:test";
import { config } from "../proxy";
import { AI_BOT_UA_MATCHER, aiBot } from "./ai-bots";

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
	const values = config.matcher.map((entry) => entry.has[0].value);
	// Next evaluates a has value exactly like this.
	const matches = (ua: string) =>
		values.every((value) => new RegExp(`^${value}$`).test(ua));

	test("every user-agent condition equals the exported matcher", () => {
		expect(values).toHaveLength(2);
		for (const value of values) expect(value).toBe(AI_BOT_UA_MATCHER);
	});

	test("matches real crawler user agents the way Next evaluates them", () => {
		const uas = [
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
			"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
		];
		for (const ua of uas) expect(matches(ua)).toBe(true);
	});

	test("skips browsers", () => {
		expect(
			matches(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
			),
		).toBe(false);
		expect(
			matches(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
			),
		).toBe(false);
	});

	test("never matches ingest, next internals or api routes", () => {
		for (const { source } of config.matcher) {
			for (const prefix of ["/ingest", "/_next", "/api"]) {
				expect(source.startsWith(prefix)).toBe(false);
			}
		}
	});
});
