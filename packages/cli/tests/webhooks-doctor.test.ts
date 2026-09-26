import { describe, expect, test } from "bun:test";
import { buildDoctorReport } from "@secondlayer/sdk";
import type {
	DeliveryRow,
	WebhookDetail,
} from "@secondlayer/shared/schemas/webhooks";
import { formatDoctorReport } from "../src/commands/webhooks.ts";

const webhook: WebhookDetail = {
	id: "wh-1",
	name: "pool-payouts",
	status: "active",
	kind: "subgraph",
	subgraphName: "pool",
	tableName: "payouts",
	triggers: null,
	format: "standard-webhooks",
	runtime: "node",
	url: "https://example.com/webhook",
	lastDeliveryAt: "2026-04-23T00:10:00.000Z",
	lastSuccessAt: "2026-04-22T23:00:00.000Z",
	circuitOpenedAt: null,
	createdAt: "2026-04-01T00:00:00.000Z",
	updatedAt: "2026-04-01T00:00:00.000Z",
	filter: {},
	authConfig: {},
	maxRetries: 7,
	timeoutMs: 10_000,
	concurrency: 8,
	circuitFailures: 0,
	lastError: null,
	warning: null,
};

function rateLimitedDelivery(
	overrides: Partial<DeliveryRow> = {},
): DeliveryRow {
	return {
		id: `del-${Math.random()}`,
		attempt: 1,
		statusCode: 429,
		errorMessage: "Retry-After: 20",
		durationMs: 50,
		responseBody: null,
		dispatchedAt: "2026-04-23T00:10:00.000Z",
		blockHeight: null,
		blockTime: null,
		...overrides,
	};
}

describe("formatDoctorReport", () => {
	test("leads with the primary insight (title, evidence, fix command) for a rate-limited window", () => {
		const deliveries: DeliveryRow[] = [
			...Array.from({ length: 6 }, () => rateLimitedDelivery()),
			...Array.from({ length: 4 }, () =>
				rateLimitedDelivery({ statusCode: 200, errorMessage: null }),
			),
		];
		const report = buildDoctorReport({
			webhook,
			deliveries,
			dead: [],
			subgraph: null,
		});
		expect(report.primary?.code).toBe("receiver_rate_limited");

		const output = formatDoctorReport(report);

		expect(output).toContain("rate-limiting us");
		expect(output).toContain("6 of 10 attempts");
		expect(output).toContain("20s");
		expect(output).toContain(
			`secondlayer webhooks update ${webhook.id} --concurrency 4`,
		);
		// It's the only issue that fired, so it's both the primary insight and
		// the whole report — "Next steps" (the leftover-hints section) stays out
		// rather than repeating the same fix text a second time.
		expect(output).not.toContain("Next steps");
		expect(output.match(/Lower concurrency/g) ?? []).toHaveLength(1);
	});

	test("puts the primary's own hint only under Insight, and the rest under Next steps", () => {
		const slowDeliveries: DeliveryRow[] = Array.from({ length: 6 }, () => ({
			id: `slow-${Math.random()}`,
			attempt: 1,
			statusCode: 200,
			errorMessage: null,
			durationMs: 8000, // 80% of the 10_000ms timeout
			responseBody: null,
			dispatchedAt: "2026-04-23T00:10:00.000Z",
			blockHeight: null,
			blockTime: null,
		}));
		const report = buildDoctorReport({
			webhook: { ...webhook, status: "paused" },
			deliveries: slowDeliveries,
			dead: [],
			subgraph: null,
		});
		expect(report.issues.map((i) => i.code)).toEqual([
			"paused",
			"receiver_slow",
		]);
		expect(report.primary?.code).toBe("paused");

		const output = formatDoctorReport(report);
		expect(output).toContain("Insight:");
		expect(output).toContain("This webhook is paused");
		expect(output).toContain("Next steps:");
		expect(output).toContain("Speed up your receiver");
		// The paused hint (the primary) doesn't repeat under Next steps.
		const nextSteps = output.slice(output.indexOf("Next steps:"));
		expect(nextSteps).not.toContain("secondlayer webhooks resume");
	});

	test("prints 'No immediate action needed' when there are no issues", () => {
		const report = buildDoctorReport({
			webhook,
			deliveries: [
				{
					id: "d1",
					attempt: 1,
					statusCode: 200,
					errorMessage: null,
					durationMs: 20,
					responseBody: null,
					dispatchedAt: "2026-04-23T00:00:00.000Z",
					blockHeight: null,
					blockTime: null,
				},
			],
			dead: [],
			subgraph: null,
		});
		expect(report.primary).toBeNull();

		const output = formatDoctorReport(report);
		expect(output).toContain("No immediate action needed.");
		expect(output).not.toContain("Insight:");
	});
});
