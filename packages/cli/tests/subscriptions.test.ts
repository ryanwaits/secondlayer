import { describe, expect, it } from "bun:test";
import type { SecondLayer } from "@secondlayer/sdk";
import type {
	DeadRow,
	DeliveryRow,
	SubscriptionDetail,
} from "@secondlayer/shared/schemas/subscriptions";
import {
	buildDoctorReport,
	buildSubscriptionTestFixture,
	buildSyntheticRow,
	buildUpdatePatch,
	resolveSigningSecret,
	resolveSubscriptionRef,
} from "../src/commands/subscriptions.ts";
import { validateSubscriptionTargetFromApi } from "../src/lib/subscription-validation.ts";

const baseDetail: SubscriptionDetail = {
	id: "sub-1",
	name: "whale-alerts",
	status: "active",
	subgraphName: "token-transfers",
	tableName: "transfers",
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
};

const delivery = (statusCode: number | null): DeliveryRow => ({
	id: `del-${statusCode ?? "err"}`,
	attempt: 1,
	statusCode,
	errorMessage: statusCode === null ? "failed" : null,
	durationMs: 10,
	responseBody: null,
	dispatchedAt: "2026-04-23T00:00:00.000Z",
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

describe("subscriptions command helpers", () => {
	it("resolves subscription refs by id, name, then direct get fallback", async () => {
		const calls: string[] = [];
		const client = {
			subscriptions: {
				list: async () => ({
					data: [
						{ ...baseDetail, id: "sub-1", name: "one" },
						{ ...baseDetail, id: "sub-2", name: "two" },
					],
				}),
				get: async (id: string) => {
					calls.push(id);
					return { ...baseDetail, id, name: id };
				},
			},
		};

		expect((await resolveSubscriptionRef(client, "sub-1")).id).toBe("sub-1");
		expect((await resolveSubscriptionRef(client, "two")).id).toBe("sub-2");
		expect((await resolveSubscriptionRef(client, "sub-missing")).id).toBe(
			"sub-missing",
		);
		expect(calls).toEqual(["sub-1", "sub-2", "sub-missing"]);
	});

	it("builds update payloads and rejects ambiguous filter flags", () => {
		expect(
			buildUpdatePatch({
				url: "https://example.com/next",
				runtime: "none",
				filter: ["amount.gte=1000"],
				maxRetries: "3",
				timeoutMs: "1000",
				concurrency: "2",
			}),
		).toEqual({
			url: "https://example.com/next",
			runtime: null,
			filter: { amount: { gte: "1000" } },
			maxRetries: 3,
			timeoutMs: 1000,
			concurrency: 2,
		});

		expect(() =>
			buildUpdatePatch({
				filter: ["amount=1"],
				clearFilter: true,
			}),
		).toThrow("Use either --filter or --clear-filter");
	});

	it("generates doctor hints for paused/error/DLQ/gap states", () => {
		const report = buildDoctorReport({
			subscription: {
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
	});

	it("builds signed Standard Webhooks test fixtures", () => {
		const fixture = buildSubscriptionTestFixture({
			subscription: baseDetail,
			row: { amount: "1000" },
			signingSecret: "whsec_dGVzdA==",
			nowSeconds: 1_700_000_000,
			id: "msg-test",
		});

		expect(JSON.parse(fixture.body)).toEqual({
			type: "token-transfers.transfers.created",
			timestamp: "2023-11-14T22:13:20.000Z",
			data: { amount: "1000" },
		});
		expect(fixture.headers["webhook-id"]).toBe("msg-test");
		expect(fixture.headers["webhook-signature"]).toMatch(/^v1,/);
		expect(fixture.curl).toContain("curl -X POST");
	});

	it("uses explicit or env signing secret for test fixtures", () => {
		expect(resolveSigningSecret({ signingSecret: "explicit" }, {})).toBe(
			"explicit",
		);
		expect(resolveSigningSecret({}, { SIGNING_SECRET: "from-env" })).toBe(
			"from-env",
		);
		expect(() => resolveSigningSecret({}, {})).toThrow(
			"Provide --signing-secret",
		);
	});

	it("builds synthetic rows from subgraph table columns", () => {
		const row = buildSyntheticRow(
			{
				name: "token-transfers",
				version: "1.0.0",
				status: "active",
				lastProcessedBlock: 1,
				health: {
					totalProcessed: 0,
					totalErrors: 0,
					errorRate: 0,
					lastError: null,
					lastErrorAt: null,
				},
				sync: {
					status: "synced",
					startBlock: 1,
					lastProcessedBlock: 1,
					chainTip: 1,
					blocksRemaining: 0,
					progress: 1,
					gaps: { count: 0, totalMissingBlocks: 0, ranges: [] },
					integrity: "complete",
				},
				tables: {
					transfers: {
						endpoint: "/subgraphs/token-transfers/transfers",
						rowCount: 0,
						example: "",
						columns: {
							_id: { type: "serial" },
							amount: { type: "uint" },
							sender: { type: "principal" },
							confirmed: { type: "boolean" },
						},
					},
				},
				createdAt: "2026-04-23T00:00:00.000Z",
				updatedAt: "2026-04-23T00:00:00.000Z",
			},
			"transfers",
		);

		expect(row).toEqual({
			amount: "1000",
			sender: "SP000000000000000000002Q6VF78",
			confirmed: true,
		});
	});

	it("rejects schema-aware filter mistakes before create/update", async () => {
		const client = {
			subgraphs: {
				get: async () => ({
					tables: {
						transfers: {
							columns: {
								amount: { type: "uint" },
								memo: { type: "text" },
							},
						},
					},
				}),
			},
		} as unknown as SecondLayer;

		await expect(
			validateSubscriptionTargetFromApi(client, {
				subgraphName: "token-transfers",
				tableName: "transfers",
				filter: { amount: { gte: "1000" } },
			}),
		).resolves.toBeUndefined();

		await expect(
			validateSubscriptionTargetFromApi(client, {
				subgraphName: "token-transfers",
				tableName: "transfers",
				filter: { memo: { gt: "x" } },
			}),
		).rejects.toThrow('Operator "gt" is not supported');
	});
});
