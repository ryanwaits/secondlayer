import { describe, expect, test } from "bun:test";
import { upstreamPathShape } from "./upstream-timeout";

describe("upstreamPathShape", () => {
	test("replaces a webhook or subgraph id and drops the query", () => {
		expect(upstreamPathShape("/api/webhooks/wh_123/deliveries?_limit=5")).toBe(
			"/api/webhooks/:id/deliveries",
		);
		expect(upstreamPathShape("/api/subgraphs/my-graph/health?hours=168")).toBe(
			"/api/subgraphs/:id/health",
		);
	});

	test("leaves list and account paths as they are", () => {
		expect(upstreamPathShape("/api/webhooks")).toBe("/api/webhooks");
		expect(upstreamPathShape("/api/billing/usage?month=2026-11")).toBe(
			"/api/billing/usage",
		);
	});
});
