import { describe, expect, test } from "bun:test";
import { sign } from "@secondlayer/shared/crypto/standard-webhooks";
import { decodeChainWebhook, verifyWebhookSignature } from "../webhooks.ts";

describe("verifyWebhookSignature", () => {
	const secret = "whsec_dGVzdC1zZWNyZXQtdmFsdWUtMzItYnl0ZXMtbG9uZw==";
	const payload = JSON.stringify({
		type: "stx-transfers.transfers.created",
		timestamp: new Date().toISOString(),
		data: { amount: "1000000", sender: "SP123", recipient: "SP456" },
	});

	test("returns true for valid Standard Webhooks signature (plain object)", () => {
		const headers = sign(payload, secret);
		expect(verifyWebhookSignature(payload, headers, secret)).toBe(true);
	});

	test("accepts Fetch Headers instance", () => {
		const signed = sign(payload, secret);
		const headers = new Headers(signed as unknown as Record<string, string>);
		expect(verifyWebhookSignature(payload, headers, secret)).toBe(true);
	});

	test("accepts a header lookup callback", () => {
		const signed = sign(payload, secret);
		expect(
			verifyWebhookSignature(
				payload,
				(name) => (signed as unknown as Record<string, string>)[name],
				secret,
			),
		).toBe(true);
	});

	test("header name matching is case-insensitive", () => {
		const signed = sign(payload, secret);
		const upper: Record<string, string> = {};
		for (const [k, v] of Object.entries(signed)) {
			upper[k.toUpperCase()] = v;
		}
		expect(verifyWebhookSignature(payload, upper, secret)).toBe(true);
	});

	test("works with a non-prefixed secret too", () => {
		const plainSecret = "shared-plain-secret-value";
		const headers = sign(payload, plainSecret);
		expect(verifyWebhookSignature(payload, headers, plainSecret)).toBe(true);
	});

	test("returns false for wrong secret", () => {
		const headers = sign(payload, secret);
		expect(
			verifyWebhookSignature(
				payload,
				headers,
				"whsec_d3Jvbmctc2VjcmV0LXZhbHVlLXRlc3RpbmctaGVscGVy",
			),
		).toBe(false);
	});

	test("returns false for tampered payload", () => {
		const headers = sign(payload, secret);
		expect(verifyWebhookSignature("tampered", headers, secret)).toBe(false);
	});

	test("returns false for expired signature", () => {
		const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
		const headers = sign(payload, secret, { timestampSeconds: oldTimestamp });
		expect(verifyWebhookSignature(payload, headers, secret, 300)).toBe(false);
	});

	test("returns false when webhook-id header missing", () => {
		const { "webhook-id": _id, ...rest } = sign(payload, secret);
		expect(verifyWebhookSignature(payload, rest, secret)).toBe(false);
	});

	test("returns false when webhook-signature header missing", () => {
		const { "webhook-signature": _sig, ...rest } = sign(payload, secret);
		expect(verifyWebhookSignature(payload, rest, secret)).toBe(false);
	});

	test("returns false when webhook-timestamp header missing", () => {
		const { "webhook-timestamp": _ts, ...rest } = sign(payload, secret);
		expect(verifyWebhookSignature(payload, rest, secret)).toBe(false);
	});

	test("returns false for malformed signature header", () => {
		const headers = sign(payload, secret);
		expect(
			verifyWebhookSignature(
				payload,
				{ ...headers, "webhook-signature": "garbage" },
				secret,
			),
		).toBe(false);
	});

	test("accepts multi-version signature header (v1,abc v2,def)", () => {
		const headers = sign(payload, secret);
		const multi = `${headers["webhook-signature"]} v2,unrelated-future-version`;
		expect(
			verifyWebhookSignature(
				payload,
				{ ...headers, "webhook-signature": multi },
				secret,
			),
		).toBe(true);
	});
});

describe("decodeChainWebhook", () => {
	// Verbatim shape of a real captured stx_transfer delivery (standard-webhooks
	// format, the subscription default). Locks the wire body this decoder must
	// keep matching — it's the ground truth a prior integration got wrong.
	test("decodes a real stx_transfer apply delivery", () => {
		const body = JSON.stringify({
			type: "chain.stx_transfer.apply",
			timestamp: "2026-05-01T12:00:00.000Z",
			data: {
				action: "apply",
				trigger: "stx_transfer",
				tx_id: "0xabc123",
				block_hash: "0xdef456",
				block_height: 8445086,
				canonical: true,
				event: {
					type: "stx_transfer_event",
					event_index: 2240,
					tx_id: "0xabc123",
					data: {
						memo: "",
						amount: "1853058049",
						sender: "SM3XVXHVUJ5JQBH03WPZ8VSDGXP0MFVKDX2W7VXG.pool",
						recipient: "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR",
					},
				},
			},
		});

		const delivery = decodeChainWebhook(body);
		if (delivery.type !== "chain.stx_transfer.apply") {
			throw new Error("expected an stx_transfer apply delivery");
		}
		// Field access below only compiles if narrowing actually worked.
		expect(delivery.data.event.type).toBe("stx_transfer_event");
		expect(delivery.data.event.data.amount).toBe("1853058049");
		expect(delivery.data.event.data.sender).toBe(
			"SM3XVXHVUJ5JQBH03WPZ8VSDGXP0MFVKDX2W7VXG.pool",
		);
		expect(delivery.data.event.data.memo).toBe("");
	});

	// Matches `applyRow`'s tx-level literal in trigger-evaluator.ts exactly:
	// flat fields on `event`, no nested `event.data`.
	test("decodes a contract_call apply delivery (flat event, no nested data)", () => {
		const body = JSON.stringify({
			type: "chain.contract_call.apply",
			timestamp: "2026-05-01T12:00:00.000Z",
			data: {
				action: "apply",
				trigger: "contract_call",
				tx_id: "0xcalltx",
				block_hash: "0xblockhash",
				block_height: 500000,
				canonical: true,
				event: {
					tx_id: "0xcalltx",
					type: "contract_call",
					sender: "SP1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
					status: "success",
					contract_id: "SP1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.amm",
					function_name: "swap-x-for-y",
					function_args: ["0x0100000000000000000000000000002710"],
					result_hex: "0x0703",
				},
			},
		});

		const delivery = decodeChainWebhook(body);
		if (delivery.type !== "chain.contract_call.apply") {
			throw new Error("expected a contract_call apply delivery");
		}
		// No `.data` nesting on a tx-level event — accessing these directly only
		// compiles because ChainTxLevelEvent is flat.
		expect(delivery.data.event.function_name).toBe("swap-x-for-y");
		expect(delivery.data.event.contract_id).toBe(
			"SP1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.amm",
		);
		expect(delivery.data.event.function_args).toEqual([
			"0x0100000000000000000000000000002710",
		]);
	});

	// print_event's `event.type` is the node's raw "contract_event", not
	// "print_event_event", and the contract field is `contract_identifier`
	// (not Streams' `contract_id`) — both easy to get wrong from guessing.
	test("decodes a print_event apply delivery", () => {
		const body = JSON.stringify({
			type: "chain.print_event.apply",
			timestamp: "2026-05-01T12:00:00.000Z",
			data: {
				action: "apply",
				trigger: "print_event",
				tx_id: "0xprinttx",
				block_hash: "0xblockhash",
				block_height: 500001,
				canonical: true,
				event: {
					tx_id: "0xprinttx",
					type: "contract_event",
					event_index: 1,
					data: {
						topic: "print",
						contract_identifier:
							"SP1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.registry",
						value: { updated: true },
						raw_value: "0x0c00000001",
					},
				},
			},
		});

		const delivery = decodeChainWebhook(body);
		if (delivery.type !== "chain.print_event.apply") {
			throw new Error("expected a print_event apply delivery");
		}
		expect(delivery.data.event.type).toBe("contract_event");
		expect(delivery.data.event.data.contract_identifier).toBe(
			"SP1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.registry",
		);
	});

	test("decodes a chain.reorg.rollback delivery", () => {
		const body = JSON.stringify({
			type: "chain.reorg.rollback",
			timestamp: "2026-05-01T12:00:00.000Z",
			data: {
				action: "rollback",
				fork_point_height: 500000,
				orphaned: [
					{ tx_id: "0xabc123", event: { type: "stx_transfer_event" } },
				],
				truncated: false,
			},
		});

		const delivery = decodeChainWebhook(body);
		if (delivery.type !== "chain.reorg.rollback") {
			throw new Error("expected a rollback delivery");
		}
		expect(delivery.data.fork_point_height).toBe(500000);
		expect(delivery.data.orphaned).toHaveLength(1);
	});

	test("decodes a chain.test.apply ping", () => {
		const body = JSON.stringify({
			type: "chain.test.apply",
			timestamp: "2026-05-01T12:00:00.000Z",
			data: {
				test: true,
				message: "Secondlayer test delivery",
				subscription_id: "sub-00000000-0000-0000-0000-000000000001",
				sent_at: "2026-05-01T12:00:00.000Z",
			},
		});

		const delivery = decodeChainWebhook(body);
		expect(delivery.type).toBe("chain.test.apply");
		if (delivery.type !== "chain.test.apply") {
			throw new Error("expected a test delivery");
		}
		expect(delivery.data.message).toBe("Secondlayer test delivery");
	});

	test("throws on a Streams-shaped body ({ event_type, payload }) instead of a chain delivery", () => {
		const streamsShaped = JSON.stringify({
			event_type: "stx_transfer",
			payload: { sender: "SP1", recipient: "SP2", amount: "100" },
		});
		expect(() => decodeChainWebhook(streamsShaped)).toThrow();
	});

	test("throws when type and data.trigger disagree", () => {
		const body = JSON.stringify({
			type: "chain.stx_transfer.apply",
			timestamp: "2026-05-01T12:00:00.000Z",
			data: { action: "apply", trigger: "ft_transfer", tx_id: "0x1" },
		});
		expect(() => decodeChainWebhook(body)).toThrow();
	});

	test("throws on malformed JSON", () => {
		expect(() => decodeChainWebhook("not json")).toThrow();
	});
});
