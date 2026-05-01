import { describe, expect, test } from "bun:test";
import { buildSessionInstructions } from "./instructions";
import type { AccountResources } from "./tools";

describe("buildSessionInstructions", () => {
	test("includes subscription resources and lifecycle guidance", () => {
		const resources: AccountResources = {
			instance: {
				exists: true,
				slug: "alex",
				plan: "hobby",
				status: "active",
				apiUrl: "https://alex.secondlayer.tools",
			},
			subgraphs: [
				{
					name: "alex-swaps",
					version: "1.0.0",
					status: "active",
					lastProcessedBlock: 100,
					totalProcessed: 10,
					totalErrors: 0,
					tables: ["swaps"],
					createdAt: "2026-01-01T00:00:00Z",
				},
			],
			subscriptions: [
				{
					id: "sub-1",
					name: "swap-hook",
					status: "paused",
					subgraphName: "alex-swaps",
					tableName: "swaps",
					format: "standard-webhooks",
					runtime: "node",
					url: "https://example.com/hooks/sl",
					lastDeliveryAt: null,
					lastSuccessAt: null,
					createdAt: "2026-01-01T00:00:00Z",
					updatedAt: "2026-01-01T00:00:00Z",
				},
			],
			keys: [],
			chainTip: 120,
		};
		const text = buildSessionInstructions(resources);
		expect(text).toContain("### Subscriptions");
		expect(text).toContain('name:"swap-hook"');
		expect(text).toContain("manage_subscriptions");
		expect(text).toContain("test_subscription");
		expect(text).toContain("Never request, recover, infer, or reveal");
	});

	test("tells chat not to treat a missing instance as missing auth", () => {
		const resources: AccountResources = {
			instance: { exists: false },
			subgraphs: [],
			subscriptions: [],
			keys: [],
			chainTip: null,
		};
		const text = buildSessionInstructions(resources);
		expect(text).toContain("No instance exists for this account");
		expect(text).toContain("setupRequired: true");
		expect(text).toContain("do not tell an already logged-in dashboard user");
	});
});
