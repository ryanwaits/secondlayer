import { describe, expect, test } from "bun:test";
import { config, isMarketingOnlyPath } from "./middleware";

// The matcher entries are regex sources Next anchors over the full path.
function runsMiddleware(pathname: string): boolean {
	return config.matcher.some((src) => new RegExp(`^${src}$`).test(pathname));
}

describe("middleware matcher", () => {
	// Regression: the exclusion must be anchored to the `/api/` segment. An
	// unanchored `(?!api|...)` also excludes clean console paths that merely
	// start with "api" — e.g. /api-keys — so middleware never rewrites them to
	// /platform/api-keys and the route 404s. See the /keys -> /api-keys rename.
	test("runs on /api-keys so it gets rewritten to /platform/api-keys", () => {
		expect(runsMiddleware("/api-keys")).toBe(true);
	});

	test("skips real /api/* route handlers", () => {
		expect(runsMiddleware("/api/keys")).toBe(false);
		expect(runsMiddleware("/api/send")).toBe(false);
	});

	test("runs on the other clean console paths", () => {
		for (const p of ["/", "/subgraphs", "/billing", "/settings"]) {
			expect(runsMiddleware(p)).toBe(true);
		}
	});

	test("skips static assets and Next internals", () => {
		for (const p of ["/favicon.ico", "/_next/static/chunk.js", "/logo.svg"]) {
			expect(runsMiddleware(p)).toBe(false);
		}
	});
});

describe("marketing-only paths", () => {
	// Regression: /subgraphs is a DUAL_PATH, so a bare prefix match rewrote every
	// nested route to /platform. Explore lives in (www) with no /platform twin, so
	// /subgraphs/explore resolved as /platform/subgraphs/[name] with name="explore",
	// found no subgraph, and 404'd for every signed-in visitor.
	test("Explore is never rewritten into /platform", () => {
		expect(isMarketingOnlyPath("/subgraphs/explore")).toBe(true);
		expect(isMarketingOnlyPath("/subgraphs/explore/bns-names")).toBe(true);
		expect(isMarketingOnlyPath("/subgraphs/explore/contract-deployments")).toBe(
			true,
		);
	});

	// The exclusion must stay narrow — the console's own subgraph routes still
	// need the /platform rewrite.
	test("real console subgraph paths still rewrite", () => {
		expect(isMarketingOnlyPath("/subgraphs")).toBe(false);
		expect(isMarketingOnlyPath("/subgraphs/bns-names")).toBe(false);
		expect(isMarketingOnlyPath("/subgraphs/bns-names/subscriptions")).toBe(
			false,
		);
	});

	// Prefix matching is segment-anchored, so a name that merely starts with
	// "explore" is a console subgraph, not the marketing route.
	test("does not match a subgraph named explore-something", () => {
		expect(isMarketingOnlyPath("/subgraphs/explorer")).toBe(false);
		expect(isMarketingOnlyPath("/subgraphs/explore-data")).toBe(false);
	});
});
