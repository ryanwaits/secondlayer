import { describe, expect, it } from "bun:test";
import type { SecondLayer } from "@secondlayer/sdk";
import type {
	WebhookDetail,
	WebhookSummary,
} from "@secondlayer/shared/schemas/webhooks";
import {
	buildWebhookTestFixture,
	buildWebhookUpdatePatch,
	formatAuthLine,
	formatWebhookTarget,
	resolveSigningSecret,
	resolveWebhookRef,
} from "../src/commands/webhooks.ts";

const baseDetail: WebhookDetail = {
	id: "sub-1",
	name: "whale-alerts",
	status: "active",
	kind: "chain",
	triggers: [{ type: "stx_transfer" }],
	format: "standard-webhooks",
	url: "https://example.com/webhook",
	lastDeliveryAt: null,
	lastSuccessAt: null,
	createdAt: "2026-04-23T00:00:00.000Z",
	updatedAt: "2026-04-23T00:00:00.000Z",
	auth: { type: "none", headerNames: [], hasSecret: false },
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

	it("builds update payloads from flags", () => {
		expect(
			buildWebhookUpdatePatch({
				url: "https://example.com/next",
				authToken: "receiver-token",
				maxRetries: "3",
				timeoutMs: "1000",
				concurrency: "2",
			}),
		).toEqual({
			url: "https://example.com/next",
			authConfig: { authType: "bearer", token: "receiver-token" },
			maxRetries: 3,
			timeoutMs: 1000,
			concurrency: 2,
		});

		expect(() => buildWebhookUpdatePatch({})).toThrow(
			"No update fields provided",
		);
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
			type: "chain.stx_transfer.apply",
			timestamp: "2023-11-14T22:13:20.000Z",
			data: {
				action: "apply",
				canonical: true,
				block_hash: "0xexampleblock",
				block_height: 0,
				tx_id: "0xexampletransaction",
				trigger: "stx_transfer",
				event: { amount: "1000" },
			},
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

	it("renders a chain webhook row without null.null", () => {
		const { triggers: _triggers, ...summary } = baseDetail;
		// A WebhookSummary (list response) has no `triggers` — falls back to
		// the bare kind, never `null.null`.
		expect(formatWebhookTarget(summary as WebhookSummary)).toBe("chain");
	});

	it("shows a chain webhook's trigger types when available (detail views)", () => {
		expect(
			formatWebhookTarget({
				...baseDetail,
				triggers: [{ type: "stx_transfer" }, { type: "contract_call" }],
			}),
		).toBe("chain.stx_transfer,contract_call");
	});

	it("formats the redacted auth line `get` prints, never a credential value", () => {
		expect(
			formatAuthLine({
				type: "bearer",
				headerNames: ["x-team"],
				hasSecret: true,
			}),
		).toBe("bearer token (set, hidden), headers: x-team");
		expect(
			formatAuthLine({ type: "bearer", headerNames: [], hasSecret: false }),
		).toBe("bearer (no token set)");
		expect(
			formatAuthLine({ type: "basic", headerNames: [], hasSecret: true }),
		).toBe("basic auth (set, hidden)");
		expect(
			formatAuthLine({ type: "none", headerNames: [], hasSecret: false }),
		).toBe("none");
	});
});
