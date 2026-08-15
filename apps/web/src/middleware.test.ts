import { describe, expect, test } from "bun:test";
import { config } from "./middleware";

// The matcher entries are regex sources Next anchors over the full path.
function runsMiddleware(pathname: string): boolean {
	return config.matcher.some((src) => new RegExp(`^${src}$`).test(pathname));
}

describe("middleware matcher", () => {
	test("runs on exact /subgraphs so the docs redirect fires", () => {
		expect(runsMiddleware("/subgraphs")).toBe(true);
	});

	test("skips nested subgraph-ish paths — no prefix matching", () => {
		for (const p of ["/subgraphs/explore", "/subgraphs/bns-names"]) {
			expect(runsMiddleware(p)).toBe(false);
		}
	});

	test("skips every other route, including API and static assets", () => {
		for (const p of [
			"/",
			"/docs/subgraphs",
			"/login",
			"/archive",
			"/api/keys",
			"/api/public/credits/checkout",
			"/favicon.ico",
			"/_next/static/chunk.js",
		]) {
			expect(runsMiddleware(p)).toBe(false);
		}
	});
});
