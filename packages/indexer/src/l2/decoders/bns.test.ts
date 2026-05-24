import { describe, expect, test } from "bun:test";
import type { StreamsEvent } from "@secondlayer/sdk";
import {
	boolCV,
	bufferCV,
	contractPrincipalCV,
	cvToValue,
	deserializeCV,
	listCV,
	noneCV,
	serializeCV,
	someCV,
	standardPrincipalCV,
	stringAsciiCV,
	tupleCV,
	uintCV,
} from "@secondlayer/stacks/clarity";
import {
	decodeMarketplaceEvent,
	decodeNameEvent,
	decodeNamespaceEvent,
} from "./bns.ts";

const BNS_CONTRACT = "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2";
const OWNER = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const NEW_OWNER = "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF";
const MANAGER = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";

function bytesFromString(s: string, len: number): Uint8Array {
	const out = new Uint8Array(len);
	const utf8 = new TextEncoder().encode(s);
	out.set(utf8.subarray(0, Math.min(utf8.length, len)));
	return out;
}

function buildPrintEvent(
	tuple: ReturnType<typeof tupleCV>,
	overrides: Partial<StreamsEvent> = {},
): StreamsEvent {
	return {
		cursor: "100:7",
		block_height: 100,
		block_hash: "0xblock",
		burn_block_height: 902_481,
		tx_id: "0xtx",
		tx_index: 3,
		event_index: 7,
		event_type: "print",
		contract_id: BNS_CONTRACT,
		payload: {
			contract_id: BNS_CONTRACT,
			topic: "print",
			value: { hex: serializeCV(tuple), repr: "(tuple ...)" },
		},
		ts: "2026-05-05T12:34:56.000Z",
		...overrides,
	};
}

function decodePayloadFromEvent(event: StreamsEvent): Record<string, unknown> {
	const value = (event.payload as { value: { hex: string } }).value;
	const hex = value.hex.startsWith("0x") ? value.hex.slice(2) : value.hex;
	return cvToValue(deserializeCV(hex)) as Record<string, unknown>;
}

// ── Name events (topic discriminator) ───────────────────────────────────────

describe("decodeNameEvent", () => {
	test("new-name decodes namespace, name, fqn, owner, properties", () => {
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("new-name"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				name: bufferCV(bytesFromString("alice", 48)),
				id: uintCV(12_345n),
				owner: standardPrincipalCV(OWNER),
				properties: tupleCV({
					"registered-at": someCV(uintCV(7_869_999n)),
					"imported-at": noneCV(),
					"renewal-height": someCV(uintCV(7_919_999n)),
					"stx-burn": uintCV(2_500_000n),
					"preordered-by": someCV(standardPrincipalCV(OWNER)),
					"hashed-salted-fqn-preorder": bufferCV(new Uint8Array(32).fill(0x11)),
				}),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeNameEvent(event, tuple);
		expect(row).not.toBeNull();
		expect(row?.topic).toBe("new-name");
		expect(row?.namespace).toBe("btc");
		expect(row?.name).toBe("alice");
		expect(row?.fqn).toBe("alice.btc");
		expect(row?.owner).toBe(OWNER);
		expect(row?.bns_id).toBe("12345");
		expect(row?.registered_at).toBe(7_869_999);
		expect(row?.renewal_height).toBe(7_919_999);
		expect(row?.stx_burn).toBe("2500000");
		expect(row?.preordered_by).toBe(OWNER);
		expect(row?.hashed_salted_fqn_preorder).toBe(`0x${"11".repeat(32)}`);
		expect(row?.cursor).toBe("100:7");
	});

	test("transfer-name updates owner, retains namespace+name", () => {
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("transfer-name"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				name: bufferCV(bytesFromString("alice", 48)),
				id: uintCV(12_345n),
				owner: standardPrincipalCV(NEW_OWNER),
				properties: tupleCV({
					"registered-at": someCV(uintCV(7_869_999n)),
					"renewal-height": someCV(uintCV(7_919_999n)),
				}),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeNameEvent(event, tuple);
		expect(row?.topic).toBe("transfer-name");
		expect(row?.owner).toBe(NEW_OWNER);
		expect(row?.fqn).toBe("alice.btc");
	});

	test("renew-name carries renewal_height", () => {
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("renew-name"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				name: bufferCV(bytesFromString("alice", 48)),
				id: uintCV(12_345n),
				owner: standardPrincipalCV(OWNER),
				properties: tupleCV({
					"renewal-height": someCV(uintCV(8_000_000n)),
				}),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeNameEvent(event, tuple);
		expect(row?.topic).toBe("renew-name");
		expect(row?.renewal_height).toBe(8_000_000);
	});

	test("burn-name nulls the owner", () => {
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("burn-name"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				name: bufferCV(bytesFromString("alice", 48)),
				id: uintCV(12_345n),
				owner: standardPrincipalCV(OWNER),
				properties: tupleCV({}),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeNameEvent(event, tuple);
		expect(row?.topic).toBe("burn-name");
		expect(row?.owner).toBeNull();
	});

	test("new-airdrop populates owner and bns_id", () => {
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("new-airdrop"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				name: bufferCV(bytesFromString("airdrop", 48)),
				id: uintCV(99n),
				owner: standardPrincipalCV(OWNER),
				properties: tupleCV({
					"registered-at": someCV(uintCV(7_869_000n)),
				}),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeNameEvent(event, tuple);
		expect(row?.topic).toBe("new-airdrop");
		expect(row?.owner).toBe(OWNER);
		expect(row?.bns_id).toBe("99");
	});

	test("unknown topic returns null", () => {
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("not-a-real-topic"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				name: bufferCV(bytesFromString("alice", 48)),
				id: uintCV(1n),
				owner: standardPrincipalCV(OWNER),
				properties: tupleCV({}),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		expect(decodeNameEvent(event, tuple)).toBeNull();
	});
});

// ── Namespace events (status discriminator) ─────────────────────────────────

describe("decodeNamespaceEvent", () => {
	test("launch decodes manager, lifetime, price-function, launched-at", () => {
		const event = buildPrintEvent(
			tupleCV({
				status: stringAsciiCV("launch"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				properties: tupleCV({
					"namespace-manager": someCV(standardPrincipalCV(MANAGER)),
					"manager-frozen": boolCV(false),
					"manager-transfers": boolCV(true),
					"price-function": tupleCV({
						base: uintCV(100n),
						coeff: uintCV(2n),
						buckets: listCV([uintCV(1n), uintCV(2n), uintCV(3n)]),
						"no-vowel-discount": uintCV(1n),
						"nonalpha-discount": uintCV(1n),
					}),
					"price-frozen": boolCV(false),
					lifetime: uintCV(52_560n),
					"revealed-at": someCV(uintCV(7_500_000n)),
					"launched-at": someCV(uintCV(7_700_000n)),
				}),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeNamespaceEvent(event, tuple);
		expect(row?.status).toBe("launch");
		expect(row?.namespace).toBe("btc");
		expect(row?.manager).toBe(MANAGER);
		expect(row?.manager_frozen).toBe(false);
		expect(row?.manager_transfers_disabled).toBe(false);
		expect(row?.lifetime).toBe(52_560);
		expect(row?.launched_at).toBe(7_700_000);
		expect(row?.price_function).not.toBeNull();
		// price_function is JSON-encoded; check at least the base key is present
		expect(row?.price_function).toContain("base");
	});

	test("transfer-manager updates manager", () => {
		const event = buildPrintEvent(
			tupleCV({
				status: stringAsciiCV("transfer-manager"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				properties: tupleCV({
					"namespace-manager": someCV(standardPrincipalCV(MANAGER)),
				}),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeNamespaceEvent(event, tuple);
		expect(row?.status).toBe("transfer-manager");
		expect(row?.manager).toBe(MANAGER);
	});

	test("freeze-manager sets manager_frozen=true", () => {
		const event = buildPrintEvent(
			tupleCV({
				status: stringAsciiCV("freeze-manager"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				properties: tupleCV({ "manager-frozen": boolCV(true) }),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeNamespaceEvent(event, tuple);
		expect(row?.status).toBe("freeze-manager");
		expect(row?.manager_frozen).toBe(true);
	});

	test("freeze-price-manager sets price_frozen=true", () => {
		const event = buildPrintEvent(
			tupleCV({
				status: stringAsciiCV("freeze-price-manager"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				properties: tupleCV({ "price-frozen": boolCV(true) }),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeNamespaceEvent(event, tuple);
		expect(row?.status).toBe("freeze-price-manager");
		expect(row?.price_frozen).toBe(true);
	});

	test("turn-off-manager-transfers inverts manager-transfers", () => {
		const event = buildPrintEvent(
			tupleCV({
				status: stringAsciiCV("turn-off-manager-transfers"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				properties: tupleCV({ "manager-transfers": boolCV(false) }),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeNamespaceEvent(event, tuple);
		expect(row?.status).toBe("turn-off-manager-transfers");
		expect(row?.manager_transfers_disabled).toBe(true);
	});

	test("update-price-manager carries new price-function", () => {
		const event = buildPrintEvent(
			tupleCV({
				status: stringAsciiCV("update-price-manager"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				properties: tupleCV({
					"price-function": tupleCV({
						base: uintCV(200n),
						coeff: uintCV(1n),
						buckets: listCV([]),
						"no-vowel-discount": uintCV(1n),
						"nonalpha-discount": uintCV(1n),
					}),
				}),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeNamespaceEvent(event, tuple);
		expect(row?.status).toBe("update-price-manager");
		expect(row?.price_function).toContain('"base"');
	});

	test("unknown status returns null", () => {
		const event = buildPrintEvent(
			tupleCV({
				status: stringAsciiCV("not-a-status"),
				namespace: bufferCV(bytesFromString("btc", 20)),
				properties: tupleCV({}),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		expect(decodeNamespaceEvent(event, tuple)).toBeNull();
	});
});

// ── Marketplace events (a discriminator) ────────────────────────────────────

describe("decodeMarketplaceEvent", () => {
	test("list-in-ustx captures price + commission", () => {
		const event = buildPrintEvent(
			tupleCV({
				a: stringAsciiCV("list-in-ustx"),
				id: uintCV(12_345n),
				price: uintCV(50_000_000n),
				commission: contractPrincipalCV(MANAGER, "commission"),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeMarketplaceEvent(event, tuple);
		expect(row?.action).toBe("list-in-ustx");
		expect(row?.bns_id).toBe("12345");
		expect(row?.price_ustx).toBe("50000000");
		expect(row?.commission).toBe(`${MANAGER}.commission`);
	});

	test("unlist-in-ustx has no price", () => {
		const event = buildPrintEvent(
			tupleCV({
				a: stringAsciiCV("unlist-in-ustx"),
				id: uintCV(12_345n),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeMarketplaceEvent(event, tuple);
		expect(row?.action).toBe("unlist-in-ustx");
		expect(row?.bns_id).toBe("12345");
		expect(row?.price_ustx).toBeNull();
	});

	test("buy-in-ustx records sale price", () => {
		const event = buildPrintEvent(
			tupleCV({
				a: stringAsciiCV("buy-in-ustx"),
				id: uintCV(12_345n),
				price: uintCV(50_000_000n),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		const row = decodeMarketplaceEvent(event, tuple);
		expect(row?.action).toBe("buy-in-ustx");
		expect(row?.price_ustx).toBe("50000000");
	});

	test("unknown action returns null", () => {
		const event = buildPrintEvent(
			tupleCV({
				a: stringAsciiCV("not-a-real-action"),
				id: uintCV(1n),
			}),
		);
		const tuple = decodePayloadFromEvent(event);
		expect(decodeMarketplaceEvent(event, tuple)).toBeNull();
	});
});
