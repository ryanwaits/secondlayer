import { describe, expect, test } from "bun:test";
import { config } from "./middleware";

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
