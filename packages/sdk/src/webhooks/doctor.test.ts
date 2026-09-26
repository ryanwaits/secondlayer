import { describe, expect, it } from "bun:test";
import type {
	DeadRow,
	DeliveryRow,
	WebhookDetail,
} from "@secondlayer/shared/schemas/webhooks";
import {
	buildDoctorReport,
	buildListIssue,
	isSuccessDelivery,
} from "./doctor.ts";

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

	it("gives every existing issue code a severity", () => {
		const report = buildDoctorReport({
			webhook: {
				...baseDetail,
				status: "paused",
				lastError: "receiver 500",
				circuitFailures: 2,
			},
			deliveries: [],
			dead: [deadRow],
			subgraph: null,
		});
		const severityByCode = Object.fromEntries(
			report.issues.map((i) => [i.code, i.severity]),
		);
		expect(severityByCode.paused).toBe("warn");
		expect(severityByCode.last_error).toBe("warn");
		expect(severityByCode.circuit).toBe("bad");
		expect(severityByCode.dead_letters).toBe("bad");
	});
});

let deliveryCounter = 0;
function mkDelivery(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
	deliveryCounter += 1;
	return {
		id: `del-${deliveryCounter}`,
		attempt: 1,
		statusCode: 200,
		errorMessage: null,
		durationMs: 10,
		responseBody: null,
		dispatchedAt: "2026-04-23T00:00:00.000Z",
		blockTime: null,
		...overrides,
	};
}

describe("receiver_rate_limited detector", () => {
	it("fires at >=10 attempts with >=50% 429s", () => {
		const deliveries = [
			...Array.from({ length: 5 }, () =>
				mkDelivery({ statusCode: 429, errorMessage: "Retry-After: 30" }),
			),
			...Array.from({ length: 5 }, () => mkDelivery({ statusCode: 200 })),
		];
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		const issue = report.issues.find((i) => i.code === "receiver_rate_limited");
		expect(issue).toBeDefined();
		expect(issue?.severity).toBe("warn");
		expect(
			issue?.evidence?.find((e) => e.label === "429 responses")?.value,
		).toBe("5 of 10 attempts");
		expect(
			issue?.evidence?.find((e) => e.label === "latest Retry-After")?.value,
		).toBe("30s");
	});

	it("does not fire just under the attempt threshold", () => {
		const deliveries = [
			...Array.from({ length: 4 }, () => mkDelivery({ statusCode: 429 })),
			...Array.from({ length: 5 }, () => mkDelivery({ statusCode: 200 })),
		];
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		expect(
			report.issues.find((i) => i.code === "receiver_rate_limited"),
		).toBeUndefined();
	});

	it("does not fire just under the ratio threshold", () => {
		const deliveries = [
			...Array.from({ length: 4 }, () => mkDelivery({ statusCode: 429 })),
			...Array.from({ length: 6 }, () => mkDelivery({ statusCode: 200 })),
		];
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		expect(
			report.issues.find((i) => i.code === "receiver_rate_limited"),
		).toBeUndefined();
	});
});

describe("receiver_down detector", () => {
	it("fires on 5 consecutive 5xx/timeout attempts from the start", () => {
		const deliveries = [
			...Array.from({ length: 3 }, () => mkDelivery({ statusCode: 502 })),
			...Array.from({ length: 2 }, () =>
				mkDelivery({ statusCode: null, errorMessage: "timeout" }),
			),
			mkDelivery({ statusCode: 200 }),
		];
		const report = buildDoctorReport({
			webhook: { ...baseDetail, lastSuccessAt: "2026-04-22T00:00:00.000Z" },
			deliveries,
			dead: [],
			subgraph: null,
		});
		const issue = report.issues.find((i) => i.code === "receiver_down");
		expect(issue).toBeDefined();
		expect(issue?.severity).toBe("bad");
		expect(
			issue?.evidence?.find((e) => e.label === "consecutive failures")?.value,
		).toBe("5");
		expect(
			issue?.evidence?.find((e) => e.label === "last success")?.value,
		).toBe("2026-04-22 00:00 UTC");
	});

	it("does not fire on only 4 consecutive failures", () => {
		const deliveries = [
			...Array.from({ length: 4 }, () => mkDelivery({ statusCode: 502 })),
			mkDelivery({ statusCode: 200 }),
		];
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		expect(
			report.issues.find((i) => i.code === "receiver_down"),
		).toBeUndefined();
	});
});

describe("receiver_rejects detector", () => {
	it("fires on 5 consecutive non-429 4xx attempts from the start", () => {
		const deliveries = [
			...Array.from({ length: 5 }, () =>
				mkDelivery({
					statusCode: 401,
					errorMessage: "Unauthorized: bad signature",
				}),
			),
			mkDelivery({ statusCode: 200 }),
		];
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		const issue = report.issues.find((i) => i.code === "receiver_rejects");
		expect(issue).toBeDefined();
		expect(issue?.severity).toBe("bad");
		expect(issue?.evidence?.find((e) => e.label === "breakdown")?.value).toBe(
			"5× 401",
		);
		expect(issue?.evidence?.find((e) => e.label === "first error")?.value).toBe(
			"Unauthorized: bad signature",
		);
	});

	it("does not fire on only 4 consecutive rejects", () => {
		const deliveries = [
			...Array.from({ length: 4 }, () => mkDelivery({ statusCode: 401 })),
			mkDelivery({ statusCode: 200 }),
		];
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		expect(
			report.issues.find((i) => i.code === "receiver_rejects"),
		).toBeUndefined();
	});

	it("does not treat a 429 streak as a rejects streak", () => {
		const deliveries = Array.from({ length: 5 }, () =>
			mkDelivery({ statusCode: 429 }),
		);
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		expect(
			report.issues.find((i) => i.code === "receiver_rejects"),
		).toBeUndefined();
	});
});

describe("receiver_slow detector", () => {
	it("fires when the median of the newest 20 is >=50% of the timeout", () => {
		const deliveries = Array.from({ length: 6 }, () =>
			mkDelivery({ statusCode: 200, durationMs: 6000 }),
		); // baseDetail.timeoutMs = 10_000, so 6000ms is 60%
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		const issue = report.issues.find((i) => i.code === "receiver_slow");
		expect(issue).toBeDefined();
		expect(issue?.severity).toBe("warn");
		expect(
			issue?.evidence?.find((e) => e.label === "median response time")?.value,
		).toBe("6.0s");
	});

	it("does not fire just under the ratio threshold", () => {
		const deliveries = Array.from({ length: 6 }, () =>
			mkDelivery({ statusCode: 200, durationMs: 4000 }),
		); // 40% of the 10_000ms timeout
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		expect(
			report.issues.find((i) => i.code === "receiver_slow"),
		).toBeUndefined();
	});

	it("does not fire with fewer than the minimum samples", () => {
		const deliveries = Array.from({ length: 3 }, () =>
			mkDelivery({ statusCode: 200, durationMs: 9000 }),
		);
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		expect(
			report.issues.find((i) => i.code === "receiver_slow"),
		).toBeUndefined();
	});
});

describe("delivery_lag detector", () => {
	it("fires when the median dispatch-vs-block lag exceeds 60s", () => {
		const deliveries = Array.from({ length: 6 }, () =>
			mkDelivery({
				dispatchedAt: "2026-04-23T00:02:00.000Z",
				blockTime: "2026-04-23T00:00:00.000Z", // 120s lag
			}),
		);
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		const issue = report.issues.find((i) => i.code === "delivery_lag");
		expect(issue).toBeDefined();
		expect(issue?.severity).toBe("warn");
		expect(issue?.fix?.command).toBeUndefined();
		expect(issue?.evidence?.find((e) => e.label === "median lag")?.value).toBe(
			"120.0s",
		);
	});

	it("does not fire just under the 60s threshold", () => {
		const deliveries = Array.from({ length: 6 }, () =>
			mkDelivery({
				dispatchedAt: "2026-04-23T00:00:50.000Z",
				blockTime: "2026-04-23T00:00:00.000Z", // 50s lag
			}),
		);
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		expect(
			report.issues.find((i) => i.code === "delivery_lag"),
		).toBeUndefined();
	});

	it("ignores rows with no block time", () => {
		const deliveries = Array.from({ length: 6 }, () =>
			mkDelivery({ dispatchedAt: "2026-04-23T00:02:00.000Z", blockTime: null }),
		);
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries,
			dead: [],
			subgraph: null,
		});
		expect(
			report.issues.find((i) => i.code === "delivery_lag"),
		).toBeUndefined();
	});
});

describe("primary", () => {
	it("is null when there are no issues", () => {
		const report = buildDoctorReport({
			webhook: baseDetail,
			deliveries: [mkDelivery({ statusCode: 200 })],
			dead: [],
			subgraph: null,
		});
		expect(report.primary).toBeNull();
	});

	it("picks the most severe issue (bad over warn over calm)", () => {
		const report = buildDoctorReport({
			webhook: { ...baseDetail, status: "paused" }, // warn
			deliveries: [],
			dead: [{ ...deadRow }], // bad
			subgraph: null,
		});
		expect(report.primary?.code).toBe("dead_letters");
		expect(report.primary?.severity).toBe("bad");
	});

	it("breaks a same-severity tie by rule priority (circuit before dead_letters)", () => {
		const report = buildDoctorReport({
			webhook: { ...baseDetail, circuitFailures: 3 }, // bad
			deliveries: [mkDelivery({ statusCode: 200 })], // non-empty: no_deliveries stays quiet
			dead: [{ ...deadRow }], // bad
			subgraph: null,
		});
		expect(report.issues.map((i) => i.code)).toEqual([
			"circuit",
			"dead_letters",
		]);
		expect(report.primary?.code).toBe("circuit");
	});
});

describe("buildListIssue", () => {
	it("returns null for an active webhook", () => {
		expect(
			buildListIssue({
				status: "active",
				circuitOpenedAt: null,
				lastSuccessAt: null,
			}),
		).toBeNull();
	});

	it("returns a warn paused issue for a manual pause (no circuit)", () => {
		const issue = buildListIssue({
			status: "paused",
			circuitOpenedAt: null,
			lastSuccessAt: null,
		});
		expect(issue).toEqual({ code: "paused", severity: "warn" });
	});

	it("returns a bad circuit issue with evidence when the circuit tripped", () => {
		const issue = buildListIssue({
			status: "paused",
			circuitOpenedAt: "2026-04-23T00:00:00.000Z",
			lastSuccessAt: "2026-04-22T00:00:00.000Z",
		});
		expect(issue?.code).toBe("circuit");
		expect(issue?.severity).toBe("bad");
		expect(
			issue?.evidence?.find((e) => e.label === "circuit opened")?.value,
		).toBe("2026-04-23 00:00 UTC");
	});
});
