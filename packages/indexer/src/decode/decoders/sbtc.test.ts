import { describe, expect, test } from "bun:test";
import type { StreamsEvent } from "@secondlayer/shared/streams-rows";
import {
	bufferCV,
	serializeCV,
	standardPrincipalCV,
	stringAsciiCV,
	tupleCV,
	uintCV,
} from "@secondlayer/stacks/clarity";
import {
	SBTC_ASSET_IDENTIFIER_MAINNET,
	SBTC_CONTRACTS,
} from "@secondlayer/stacks/sbtc";
import { decodeRegistryPrint, depositRecipient } from "./sbtc.ts";

const REGISTRY_CONTRACT = `${SBTC_CONTRACTS.mainnet.address}.${SBTC_CONTRACTS.mainnet.registry}`;
const TOKEN_CONTRACT = `${SBTC_CONTRACTS.mainnet.address}.${SBTC_CONTRACTS.mainnet.token}`;

function bytes(...values: number[]): Uint8Array {
	return new Uint8Array(values);
}

function hexBuffer(buf: Uint8Array): string {
	return `0x${Buffer.from(buf).toString("hex")}`;
}

function buildPrintEvent(
	tuple: ReturnType<typeof tupleCV>,
	overrides: Partial<StreamsEvent> = {},
): StreamsEvent {
	return {
		cursor: "100:7",
		block_height: 100,
		block_hash: "0xblock",
		burn_block_height: 902481,
		tx_id: "0xtx",
		tx_index: 3,
		event_index: 7,
		event_type: "print",
		contract_id: REGISTRY_CONTRACT,
		payload: {
			contract_id: REGISTRY_CONTRACT,
			topic: "print",
			value: { hex: serializeCV(tuple), repr: "(tuple ...)" },
		},
		ts: "2026-05-05T12:34:56.000Z",
		...overrides,
	} as StreamsEvent;
}

describe("decodeRegistryPrint", () => {
	test("completed-deposit", () => {
		const txid = bytes(0xaa, 0xbb, 0xcc);
		const burnHash = bytes(0xde, 0xad, 0xbe, 0xef);
		const sweepTxid = bytes(0x11, 0x22, 0x33);
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("completed-deposit"),
				"bitcoin-txid": bufferCV(txid),
				"output-index": uintCV(1n),
				amount: uintCV(100_000_000n),
				"burn-hash": bufferCV(burnHash),
				"burn-height": uintCV(902481n),
				"sweep-txid": bufferCV(sweepTxid),
			}),
		);

		const row = decodeRegistryPrint(event);
		expect(row).not.toBeNull();
		expect(row?.topic).toBe("completed-deposit");
		expect(row?.bitcoin_txid).toBe(hexBuffer(txid));
		expect(row?.output_index).toBe(1);
		expect(row?.amount).toBe("100000000");
		expect(row?.burn_hash).toBe(hexBuffer(burnHash));
		expect(row?.burn_height).toBe(902481);
		expect(row?.sweep_txid).toBe(hexBuffer(sweepTxid));
		expect(row?.cursor).toBe("100:7");
		expect(row?.source_cursor).toBe("100:7");
	});

	test("withdrawal-create with BTC recipient tuple", () => {
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("withdrawal-create"),
				"request-id": uintCV(42n),
				amount: uintCV(50_000_000n),
				sender: standardPrincipalCV("SP000000000000000000002Q6VF78"),
				recipient: tupleCV({
					version: bufferCV(bytes(0x04)),
					hashbytes: bufferCV(bytes(0xab, 0xcd, 0xef)),
				}),
				"block-height": uintCV(7_870_000n),
				"max-fee": uintCV(1000n),
			}),
		);

		const row = decodeRegistryPrint(event);
		expect(row?.topic).toBe("withdrawal-create");
		expect(row?.request_id).toBe(42);
		expect(row?.amount).toBe("50000000");
		expect(row?.sender).toBe("SP000000000000000000002Q6VF78");
		expect(row?.recipient_btc_version).toBe(0x04);
		expect(row?.recipient_btc_hashbytes).toBe("0xabcdef");
		expect(row?.block_height_at_request).toBe(7_870_000);
		expect(row?.max_fee).toBe("1000");
	});

	test("withdrawal-accept", () => {
		const txid = bytes(0xfe, 0xdc);
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("withdrawal-accept"),
				"request-id": uintCV(7n),
				"bitcoin-txid": bufferCV(txid),
				"signer-bitmap": uintCV(123n),
				"output-index": uintCV(0n),
				fee: uintCV(500n),
				"burn-hash": bufferCV(bytes(0x01, 0x02)),
				"burn-height": uintCV(902500n),
				"sweep-txid": bufferCV(bytes(0x03, 0x04)),
			}),
		);

		const row = decodeRegistryPrint(event);
		expect(row?.topic).toBe("withdrawal-accept");
		expect(row?.request_id).toBe(7);
		expect(row?.bitcoin_txid).toBe(hexBuffer(txid));
		expect(row?.signer_bitmap).toBe("123");
		expect(row?.fee).toBe("500");
		expect(row?.burn_height).toBe(902500);
	});

	test("withdrawal-reject", () => {
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("withdrawal-reject"),
				"request-id": uintCV(9n),
				"signer-bitmap": uintCV(456n),
			}),
		);

		const row = decodeRegistryPrint(event);
		expect(row?.topic).toBe("withdrawal-reject");
		expect(row?.request_id).toBe(9);
		expect(row?.signer_bitmap).toBe("456");
		expect(row?.amount).toBeNull();
	});

	test("key-rotation", () => {
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("key-rotation"),
				"new-keys": tupleCV({}), // Empty tuple - we only care about array detection
				"new-address": standardPrincipalCV("SP000000000000000000002Q6VF78"),
				"new-aggregate-pubkey": bufferCV(bytes(0x02, 0x03)),
				"new-signature-threshold": uintCV(11n),
			}),
		);

		const row = decodeRegistryPrint(event);
		expect(row?.topic).toBe("key-rotation");
		expect(row?.signer_aggregate_pubkey).toBe("0x0203");
		expect(row?.signer_threshold).toBe(11);
		expect(row?.signer_address).toBe("SP000000000000000000002Q6VF78");
	});

	test("update-protocol-contract", () => {
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("update-protocol-contract"),
				"contract-type": bufferCV(bytes(0x02)),
				"new-contract": standardPrincipalCV("SP000000000000000000002Q6VF78"),
			}),
		);

		const row = decodeRegistryPrint(event);
		expect(row?.topic).toBe("update-protocol-contract");
		expect(row?.governance_contract_type).toBe(0x02);
		expect(row?.governance_new_contract).toBe("SP000000000000000000002Q6VF78");
	});

	test("returns null for unknown topic", () => {
		const event = buildPrintEvent(
			tupleCV({
				topic: stringAsciiCV("something-from-the-future"),
				amount: uintCV(0n),
			}),
		);

		expect(decodeRegistryPrint(event)).toBeNull();
	});

	test("returns null for non-tuple payload", () => {
		const event = {
			...buildPrintEvent(tupleCV({ topic: stringAsciiCV("ignored") })),
			payload: { contract_id: REGISTRY_CONTRACT, topic: "print", value: null },
		} as StreamsEvent;
		expect(decodeRegistryPrint(event)).toBeNull();
	});
});

describe("depositRecipient", () => {
	const deposit = { tx_id: "0xtx", event_index: 7, amount: "14025" };

	function mint(overrides: Partial<StreamsEvent> = {}, payload = {}) {
		return {
			cursor: "100:6",
			block_height: 100,
			block_hash: "0xblock",
			burn_block_height: 902481,
			tx_id: "0xtx",
			tx_index: 3,
			event_index: 6,
			event_type: "ft_mint",
			contract_id: TOKEN_CONTRACT,
			payload: {
				asset_identifier: SBTC_ASSET_IDENTIFIER_MAINNET,
				recipient: "SP34HBPH4EHPVW0NSXBCV5Z27FAGTC62RV5Y9Y9MR",
				amount: "14025",
				...payload,
			},
			ts: "2026-11-01T05:17:31.000Z",
			...overrides,
		} as StreamsEvent;
	}

	test("is the recipient of the sBTC mint just before the print", () => {
		expect(depositRecipient(deposit, [mint()])).toBe(
			"SP34HBPH4EHPVW0NSXBCV5Z27FAGTC62RV5Y9Y9MR",
		);
	});

	test("ignores mints from another tx, another position or another asset", () => {
		expect(depositRecipient(deposit, [mint({ tx_id: "0xother" })])).toBeNull();
		expect(depositRecipient(deposit, [mint({ event_index: 5 })])).toBeNull();
		expect(
			depositRecipient(deposit, [
				mint({}, { asset_identifier: "SP1.other-token::other" }),
			]),
		).toBeNull();
	});

	test("refuses a mint whose amount differs from the deposit", () => {
		expect(depositRecipient(deposit, [mint({}, { amount: "1" })])).toBeNull();
	});
});
