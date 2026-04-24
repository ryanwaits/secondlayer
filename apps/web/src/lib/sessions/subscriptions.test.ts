import { describe, expect, test } from "bun:test";
import type {
	DeadRow,
	DeliveryRow,
	SubgraphDetail,
	SubscriptionDetail,
} from "../types";
import {
	buildSignedSubscriptionFixture,
	buildSubscriptionDiagnostics,
} from "./subscriptions";

const baseSubscription: SubscriptionDetail = {
	id: "sub-1",
	name: "whale-alerts",
	status: "active",
	subgraphName: "token-transfers",
	tableName: "transfers",
	format: "standard-webhooks",
	runtime: "node",
	url: "https://example.com/hooks/sl",
	filter: {},
	authConfig: {},
	maxRetries: 7,
	timeoutMs: 10_000,
	concurrency: 4,
	circuitFailures: 0,
	circuitOpenedAt: null,
	lastDeliveryAt: "2026-01-01T00:00:00Z",
	lastSuccessAt: "2026-01-01T00:00:00Z",
	lastError: null,
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
};

function delivery(
	statusCode: number | null,
	errorMessage: string | null = null,
): DeliveryRow {
	return {
		id: `del-${statusCode ?? "err"}`,
		attempt: 1,
		statusCode,
		errorMessage,
		durationMs: 12,
		responseBody: null,
		dispatchedAt: "2026-01-01T00:00:00Z",
	};
}

const deadRow: DeadRow = {
	id: "out-1",
	eventType: "token-transfers.transfers.created",
	attempt: 7,
	blockHeight: 123,
	txId: "0xabc",
	payload: { amount: "1000" },
	failedAt: "2026-01-01T00:00:00Z",
	createdAt: "2026-01-01T00:00:00Z",
};

describe("subscription diagnostics", () => {
	test("reports healthy subscriptions", () => {
		const report = buildSubscriptionDiagnostics({
			subscription: baseSubscription,
			deliveries: [delivery(200)],
			deadRows: [],
		});
		expect(report.findings[0]?.title).toBe("Subscription looks healthy");
		expect(report.deliverySummary.successful).toBe(1);
	});

	test("reports paused circuit state", () => {
		const report = buildSubscriptionDiagnostics({
			subscription: {
				...baseSubscription,
				status: "paused",
				circuitOpenedAt: "2026-01-01T00:00:00Z",
			},
			deliveries: [delivery(500)],
			deadRows: [],
		});
		expect(
			report.findings.some((f) => f.title.includes("Circuit breaker")),
		).toBe(true);
		expect(report.findings.some((f) => f.severity === "danger")).toBe(true);
	});

	test("reports error, DLQ, and linked subgraph warnings", () => {
		const subgraph = {
			name: "token-transfers",
			status: "active",
			lastProcessedBlock: 100,
			sync: {
				status: "catching_up",
				chainTip: 150,
				progress: 0.7,
				blocksRemaining: 50,
				gaps: { count: 2 },
				integrity: "gap",
			},
			tables: {},
			health: {
				totalProcessed: 1,
				totalErrors: 0,
				errorRate: 0,
				lastError: null,
				lastErrorAt: null,
			},
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			version: "1.0.0",
		} as unknown as SubgraphDetail;
		const report = buildSubscriptionDiagnostics({
			subscription: {
				...baseSubscription,
				status: "error",
				lastError: "receiver returned 500",
			},
			deliveries: [delivery(500, "receiver returned 500")],
			deadRows: [deadRow],
			subgraph,
		});
		expect(report.findings.some((f) => f.title.includes("error"))).toBe(true);
		expect(report.findings.some((f) => f.title.includes("dead-letter"))).toBe(
			true,
		);
		expect(
			report.findings.some((f) => f.title === "Linked subgraph has gaps"),
		).toBe(true);
	});
});

describe("signed subscription fixtures", () => {
	test("signs Standard Webhooks output with supplied secret and emits curl", () => {
		const fixture = buildSignedSubscriptionFixture({
			subscription: baseSubscription,
			row: { amount: "1000" },
			signingSecret: "topsecret",
			nowSeconds: 1_700_000_000,
			id: "test-sub-1",
		});
		expect(JSON.parse(fixture.body)).toEqual({
			type: "token-transfers.transfers.created",
			timestamp: "2023-11-14T22:13:20.000Z",
			data: { amount: "1000" },
		});
		expect(fixture.headers["webhook-id"]).toBe("test-sub-1");
		expect(fixture.headers["webhook-signature"]?.startsWith("v1,")).toBe(true);
		expect(fixture.curl).toContain("curl -X POST");
		expect(fixture.curl).toContain("https://example.com/hooks/sl");
		expect(fixture.curl).not.toContain("topsecret");
	});
});
