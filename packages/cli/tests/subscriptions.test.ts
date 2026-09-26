import { describe, expect, it } from "bun:test";
import type { SecondLayer } from "@secondlayer/sdk";
import type {
	ChainTrigger,
	WebhookDetail,
} from "@secondlayer/shared/schemas/webhooks";
import {
	buildSyntheticRow,
	buildWebhookTestFixture,
	buildWebhookUpdatePatch,
	formatWebhookTarget,
	resolveSigningSecret,
	resolveWebhookRef,
} from "../src/commands/webhooks.ts";
import { validateWebhookTargetFromApi } from "../src/lib/webhook-validation.ts";

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

describe("webhooks command helpers", () => {
	it("resolves refs by id and name, falls back to get for UUIDs, rejects unknown refs", async () => {
		const calls: string[] = [];
		// Partial mock — `resolveWebhookRef` only calls list + get.
		const client = {
			webhooks: {
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
		} as unknown as Pick<SecondLayer, "webhooks">;

		const UUID = "00000000-0000-0000-0000-000000000009";

		expect((await resolveWebhookRef(client, "sub-1")).id).toBe("sub-1");
		expect((await resolveWebhookRef(client, "two")).id).toBe("sub-2");
		// A UUID absent from the list is assumed to be a real id → direct get.
		expect((await resolveWebhookRef(client, UUID)).id).toBe(UUID);
		// A non-UUID ref matching no name can't be a valid webhook id.
		await expect(resolveWebhookRef(client, "sub-missing")).rejects.toThrow(
			'Webhook "sub-missing" not found.',
		);
		expect(calls).toEqual(["sub-1", "sub-2", UUID]);
	});

	it("builds update payloads and rejects ambiguous filter flags", () => {
		expect(
			buildWebhookUpdatePatch({
				url: "https://example.com/next",
				authToken: "receiver-token",
				runtime: "none",
				filter: ["amount.gte=1000"],
				maxRetries: "3",
				timeoutMs: "1000",
				concurrency: "2",
			}),
		).toEqual({
			url: "https://example.com/next",
			authConfig: { authType: "bearer", token: "receiver-token" },
			runtime: null,
			filter: { amount: { gte: "1000" } },
			maxRetries: 3,
			timeoutMs: 1000,
			concurrency: 2,
		});

		expect(() =>
			buildWebhookUpdatePatch({
				filter: ["amount=1"],
				clearFilter: true,
			}),
		).toThrow("Use either --filter or --clear-filter");
	});

	it("builds signed Standard Webhooks test fixtures", () => {
		const fixture = buildWebhookTestFixture({
			webhook: baseDetail,
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
					emptyMapping: false,
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

	it("renders a subgraph webhook's target as subgraph.table", () => {
		expect(formatWebhookTarget(baseDetail)).toBe("token-transfers.transfers");
	});

	it("renders a chain webhook row without null.null", () => {
		const summary = {
			kind: "chain" as const,
			subgraphName: null,
			tableName: null,
		};
		// A WebhookSummary (list response) has no `triggers` — falls back to
		// the bare kind, never `null.null`.
		expect(formatWebhookTarget(summary)).toBe("chain");
	});

	it("shows a chain webhook's trigger types when available (detail views)", () => {
		expect(
			formatWebhookTarget({
				kind: "chain",
				subgraphName: null,
				tableName: null,
				triggers: [
					{ type: "stx_transfer" },
					{ type: "contract_call" },
				] as ChainTrigger[],
			}),
		).toBe("chain.stx_transfer,contract_call");
	});

	it("rejects schema-aware filter mistakes before create/update", async () => {
		const client = {
			subgraphs: {
				status: async () => ({
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
			validateWebhookTargetFromApi(client, {
				subgraphName: "token-transfers",
				tableName: "transfers",
				filter: { amount: { gte: "1000" } },
			}),
		).resolves.toBeUndefined();

		await expect(
			validateWebhookTargetFromApi(client, {
				subgraphName: "token-transfers",
				tableName: "transfers",
				filter: { memo: { gt: "x" } },
			}),
		).rejects.toThrow('Operator "gt" is not supported');
	});
});
