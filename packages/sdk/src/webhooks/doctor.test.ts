import { describe, expect, it } from "bun:test";
import type {
	DeadRow,
	DeliveryRow,
	WebhookDetail,
} from "@secondlayer/shared/schemas/webhooks";
import { buildDoctorReport, isSuccessDelivery } from "./doctor.ts";

const baseDetail: WebhookDetail = {
	id: "sub-1",
	name: "whale-alerts",
	status: "active",
	kind: "subgraph",
	subgraphName: "token-transfers",
	tableName: "transfers",
	triggers: null,
	format: "standard-webhooks",
	runtime: "node",
	url: "https://example.com/webhook",
	lastDeliveryAt: null,
	lastSuccessAt: null,
	createdAt: "2026-04-23T00:00:00.000Z",
	updatedAt: "2026-04-23T00:00:00.000Z",
	filter: {},
	authConfig: {},
	maxRetries: 7,
	timeoutMs: 10_000,
	concurrency: 4,
	circuitFailures: 0,
	circuitOpenedAt: null,
	lastError: null,
	warning: null,
};

const delivery = (statusCode: number | null): DeliveryRow => ({
	id: `del-${statusCode ?? "err"}`,
	attempt: 1,
	statusCode,
	errorMessage: statusCode === null ? "failed" : null,
	durationMs: 10,
	responseBody: null,
	dispatchedAt: "2026-04-23T00:00:00.000Z",
	blockTime: null,
});

const deadRow: DeadRow = {
	id: "out-1",
	eventType: "token-transfers.transfers.created",
	attempt: 7,
	blockHeight: 100,
	txId: "0xabc",
	payload: { amount: "1000" },
	failedAt: "2026-04-23T00:00:00.000Z",
	createdAt: "2026-04-23T00:00:00.000Z",
};

describe("isSuccessDelivery", () => {
	it("treats 2xx as success and everything else (including null) as failure", () => {
		expect(isSuccessDelivery(delivery(200))).toBe(true);
		expect(isSuccessDelivery(delivery(299))).toBe(true);
		expect(isSuccessDelivery(delivery(300))).toBe(false);
		expect(isSuccessDelivery(delivery(500))).toBe(false);
		expect(isSuccessDelivery(delivery(null))).toBe(false);
	});
});

describe("buildDoctorReport", () => {
	it("generates doctor hints and issues for paused/error/DLQ/gap states", () => {
		const report = buildDoctorReport({
			webhook: {
				...baseDetail,
				status: "paused",
				lastError: "receiver 500",
				circuitFailures: 2,
			},
			deliveries: [delivery(500), delivery(200)],
			dead: [deadRow],
			subgraph: {
				name: "token-transfers",
				version: "1.0.0",
				status: "active",
				lastProcessedBlock: 90,
				health: {
					totalProcessed: 1,
					totalErrors: 0,
					errorRate: 0,
					lastError: null,
					lastErrorAt: null,
					emptyMapping: false,
				},
				sync: {
					status: "catching_up",
					startBlock: 1,
					lastProcessedBlock: 90,
					chainTip: 100,
					blocksRemaining: 10,
					progress: 0.9,
					gaps: {
						count: 1,
						totalMissingBlocks: 2,
						ranges: [{ start: 10, end: 11, size: 2, reason: "test" }],
					},
					integrity: "gaps_detected",
				},
				tables: {},
				createdAt: "2026-04-23T00:00:00.000Z",
				updatedAt: "2026-04-23T00:00:00.000Z",
			},
		});

		expect(report.deliverySummary).toMatchObject({
			total: 2,
			successful: 1,
			failed: 1,
		});
		expect(report.deadCount).toBe(1);
		expect(report.hints.join("\n")).toContain("Resume");
		expect(report.hints.join("\n")).toContain("Dead-letter rows");
		expect(report.hints.join("\n")).toContain("gaps");
		expect(report.issues.map((i) => i.code)).toEqual([
			"paused",
			"last_error",
			"circuit",
			"dead_letters",
			"subgraph_gaps",
			"subgraph_catching_up",
		]);
		expect(report.issues.find((i) => i.code === "last_error")?.detail).toBe(
			"receiver 500",
		);
	});

	it("surfaces a chain webhook's evaluator-idle warning as the first doctor hint and issue", () => {
		const report = buildDoctorReport({
			webhook: {
				...baseDetail,
				kind: "chain",
				subgraphName: null,
				tableName: null,
				triggers: [{ type: "contract_call" }],
				warning:
					"This instance's chain-trigger evaluator is not running (SUBGRAPH_SOURCE != \"streams-index\") — this chain webhook will never fire until that's set.",
			},
			deliveries: [],
			dead: [],
			subgraph: null,
		});

		expect(report.hints[0]).toContain("chain-trigger evaluator is not running");
		expect(report.issues[0]).toMatchObject({ code: "warning" });
		expect(report.issues.map((i) => i.code)).toContain("no_deliveries");
	});

	it("reports no evaluator-idle warning or issue for a healthy chain webhook", () => {
		const report = buildDoctorReport({
			webhook: {
				...baseDetail,
				kind: "chain",
				subgraphName: null,
				tableName: null,
				triggers: [{ type: "contract_call" }],
				warning: null,
			},
			deliveries: [delivery(200)],
			dead: [],
			subgraph: null,
		});

		expect(report.hints.join("\n")).not.toContain("chain-trigger evaluator");
		expect(report.issues).toEqual([]);
	});
});
