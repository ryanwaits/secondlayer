import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	SEMANTIC_DIGEST_SPEC_V1,
	SemanticDigestRollup,
	canonicalJson,
	semanticDigest,
} from "./semantic-digest.ts";

/**
 * These tests pin the v1 encoding as bytes. Two consequences: any accidental
 * change to a field order, delimiter, null marker, or JSON canonicalization is
 * caught by an exact-string comparison rather than by a downstream integration
 * test, and future test vectors in other runtimes can be produced against
 * these fixture bytes without depending on this package.
 *
 * If a test here fails, the correct response is almost always to bump to v2 —
 * NOT to update the fixture. The whole point of the spec is that the bytes
 * never move.
 */

const FIELD_SEP = "\x1f";
const NULL = "\x00";

const sha256Hex = (input: string): string =>
	createHash("sha256").update(input).digest("hex");

const sampleBlock = {
	height: 500_000,
	hash: "0xabc123",
	parent_hash: "0xdef456",
	burn_block_height: 800_000,
	burn_block_hash: "0xbtc",
	index_block_hash: "0xidx",
	timestamp: 1_720_000_000,
};

const sampleBurnBlockWithNulls = {
	height: 500_001,
	hash: "0xffff",
	parent_hash: "0xabc123",
	burn_block_height: 800_001,
	burn_block_hash: null,
	index_block_hash: null,
	timestamp: 1_720_000_600,
};

const sampleTx = {
	tx_id: "0xdeadbeef",
	block_height: 500_000,
	tx_index: 3,
	type: "contract_call",
	sender: "SP123",
	status: "success",
	contract_id: "SP123.my-contract",
	function_name: "transfer",
	function_args: { amount: "1000", recipient: "SP456", memo: null },
	raw_result: "(ok true)",
	raw_tx: "0x00112233",
};

const sampleEvent = {
	tx_id: "0xdeadbeef",
	block_height: 500_000,
	event_index: 0,
	type: "stx_transfer",
	data: { amount: "1000", recipient: "SP456", sender: "SP123" },
};

const sampleStateWrite = {
	block_height: 500_000,
	ordinal: 7,
	tx_index: 3,
	key: "vm::SP123.my-contract::1::balance",
	value_hex: "0x0100000000000000000000000000000064",
};

const sampleBlockLevelWrite = {
	block_height: 500_000,
	ordinal: 0,
	tx_index: null,
	key: "vm-metadata::9::contract",
	value_hex: "0x00",
};

describe("SEMANTIC_DIGEST_SPEC_V1", () => {
	test("spec identifier is frozen", () => {
		expect(SEMANTIC_DIGEST_SPEC_V1).toBe("sha256:semantic-v1");
	});
});

describe("v1 encode — pinned bytes", () => {
	test("block encoding is exactly this string", () => {
		expect(semanticDigest.v1.encodeBlock(sampleBlock)).toBe(
			[
				"500000",
				"0xabc123",
				"0xdef456",
				"800000",
				"0xbtc",
				"0xidx",
				"1720000000",
			].join(FIELD_SEP),
		);
	});

	test("block encoding uses \\x00 for null burn/index hashes", () => {
		expect(semanticDigest.v1.encodeBlock(sampleBurnBlockWithNulls)).toBe(
			["500001", "0xffff", "0xabc123", "800001", NULL, NULL, "1720000600"].join(
				FIELD_SEP,
			),
		);
	});

	test("transaction encoding canonicalizes function_args by key", () => {
		expect(semanticDigest.v1.encodeTransaction(sampleTx)).toBe(
			[
				"0xdeadbeef",
				"500000",
				"3",
				"contract_call",
				"SP123",
				"success",
				"SP123.my-contract",
				"transfer",
				// canonical: keys sorted → amount, memo, recipient
				'{"amount":"1000","memo":null,"recipient":"SP456"}',
				"(ok true)",
				"0x00112233",
			].join(FIELD_SEP),
		);
	});

	test("event encoding canonicalizes data by key", () => {
		expect(semanticDigest.v1.encodeEvent(sampleEvent)).toBe(
			[
				"0xdeadbeef",
				"500000",
				"0",
				"stx_transfer",
				// canonical: amount, recipient, sender
				'{"amount":"1000","recipient":"SP456","sender":"SP123"}',
			].join(FIELD_SEP),
		);
	});
});

describe("v1 stateWrite encoding", () => {
	test("state write encoding is exactly this string", () => {
		expect(semanticDigest.v1.encodeStateWrite(sampleStateWrite)).toBe(
			[
				"500000",
				"7",
				"3",
				"vm::SP123.my-contract::1::balance",
				"0x0100000000000000000000000000000064",
			].join(FIELD_SEP),
		);
	});

	test("a block-level write encodes its null tx_index as \\x00", () => {
		expect(semanticDigest.v1.encodeStateWrite(sampleBlockLevelWrite)).toBe(
			["500000", "0", NULL, "vm-metadata::9::contract", "0x00"].join(FIELD_SEP),
		);
	});

	test("stateWrite semantic digest is stable", () => {
		expect(semanticDigest.v1.stateWrite(sampleStateWrite)).toBe(
			"b7c6d7245be72d986641ceed6c58fd2322a08f247e47b6c12d43fef5aac97f8b",
		);
		expect(semanticDigest.v1.stateWrite(sampleBlockLevelWrite)).toBe(
			"8d2406737a1728b57086d93f2a223de739ba2e840b10ce372b171ad9fa54cc4a",
		);
	});
});

describe("v1 golden digests", () => {
	// Pinned as hex, not only as encoded strings: adding an encoder must never
	// move an existing one's bytes.
	test("existing encoders' golden digests are unchanged", () => {
		expect(semanticDigest.v1.block(sampleBlock)).toBe(
			"2ce2debca37dc57f4e9ec2b9177625e3e428a7089cd083a35b61d8c86692150e",
		);
		expect(semanticDigest.v1.transaction(sampleTx)).toBe(
			"a62ab82c4707ec2cf57d1d61c26dc955c14fb2a1717681ccf8a581588d275a46",
		);
		expect(semanticDigest.v1.event(sampleEvent)).toBe(
			"15e4526a799afde8afaf723da6dd87eb7e2ed5cc8f78265e4b1c8aef7e4f934a",
		);
	});
});

describe("v1 digest — sha256 of encoded bytes", () => {
	test("block digest = sha256(encoded)", () => {
		expect(semanticDigest.v1.block(sampleBlock)).toBe(
			sha256Hex(semanticDigest.v1.encodeBlock(sampleBlock)),
		);
	});

	test("transaction digest = sha256(encoded)", () => {
		expect(semanticDigest.v1.transaction(sampleTx)).toBe(
			sha256Hex(semanticDigest.v1.encodeTransaction(sampleTx)),
		);
	});

	test("event digest = sha256(encoded)", () => {
		expect(semanticDigest.v1.event(sampleEvent)).toBe(
			sha256Hex(semanticDigest.v1.encodeEvent(sampleEvent)),
		);
	});
});

describe("v1 cross-runtime invariance", () => {
	test("key order in function_args does not change tx digest", () => {
		const reordered = {
			...sampleTx,
			function_args: {
				memo: null,
				recipient: "SP456",
				amount: "1000",
			},
		};
		expect(semanticDigest.v1.transaction(reordered)).toBe(
			semanticDigest.v1.transaction(sampleTx),
		);
	});

	test("nested key order in event data does not change digest", () => {
		const reordered = {
			...sampleEvent,
			data: {
				sender: "SP123",
				amount: "1000",
				recipient: "SP456",
			},
		};
		expect(semanticDigest.v1.event(reordered)).toBe(
			semanticDigest.v1.event(sampleEvent),
		);
	});

	test("bigint and number blocks with same value produce same digest", () => {
		const bigintForm = {
			...sampleBlock,
			height: 500_000n,
			burn_block_height: 800_000n,
			timestamp: 1_720_000_000n,
		};
		expect(semanticDigest.v1.block(bigintForm)).toBe(
			semanticDigest.v1.block(sampleBlock),
		);
	});

	test("null and undefined encode identically as scalars", () => {
		const withUndefined = {
			...sampleBurnBlockWithNulls,
			burn_block_hash: undefined as unknown as null,
			index_block_hash: undefined as unknown as null,
		};
		expect(semanticDigest.v1.block(withUndefined)).toBe(
			semanticDigest.v1.block(sampleBurnBlockWithNulls),
		);
	});
});

describe("v1 collision resistance — sensitive fields", () => {
	test("changing burn_block_hash from null to empty string changes digest", () => {
		const emptyString = { ...sampleBurnBlockWithNulls, burn_block_hash: "" };
		expect(semanticDigest.v1.block(emptyString)).not.toBe(
			semanticDigest.v1.block(sampleBurnBlockWithNulls),
		);
	});

	test("changing raw_tx changes tx digest", () => {
		const forged = { ...sampleTx, raw_tx: "0xffffffff" };
		expect(semanticDigest.v1.transaction(forged)).not.toBe(
			semanticDigest.v1.transaction(sampleTx),
		);
	});

	test("changing event data value changes digest", () => {
		const tampered = {
			...sampleEvent,
			data: { ...(sampleEvent.data as object), amount: "9999" },
		};
		expect(semanticDigest.v1.event(tampered)).not.toBe(
			semanticDigest.v1.event(sampleEvent),
		);
	});

	test("changing event_index changes event digest at same block", () => {
		const shifted = { ...sampleEvent, event_index: 4 };
		expect(semanticDigest.v1.event(shifted)).not.toBe(
			semanticDigest.v1.event(sampleEvent),
		);
	});
});

describe("v1 rejects unencodable input", () => {
	test("non-finite timestamp throws", () => {
		expect(() =>
			semanticDigest.v1.block({ ...sampleBlock, timestamp: Number.NaN }),
		).toThrow(/non-finite/);
	});

	test("non-integer height throws", () => {
		expect(() =>
			semanticDigest.v1.block({ ...sampleBlock, height: 500_000.5 }),
		).toThrow(/non-integer/);
	});

	test("non-finite number inside function_args throws", () => {
		expect(() =>
			semanticDigest.v1.transaction({
				...sampleTx,
				function_args: { amount: Number.POSITIVE_INFINITY },
			}),
		).toThrow(/non-finite/);
	});
});

describe("canonicalJson", () => {
	test("sorts keys deterministically at every depth", () => {
		expect(
			canonicalJson({ b: 1, a: { d: 2, c: 3 }, nested: [{ z: 1, y: 2 }] }),
		).toBe('{"a":{"c":3,"d":2},"b":1,"nested":[{"y":2,"z":1}]}');
	});

	test("bigint becomes quoted decimal", () => {
		expect(canonicalJson({ n: 123n })).toBe('{"n":"123"}');
	});

	test("null distinguishes from missing", () => {
		expect(canonicalJson({ a: null })).toBe('{"a":null}');
	});
});

describe("SemanticDigestRollup", () => {
	test("empty rollup returns null and reports v1 spec", () => {
		const roll = SemanticDigestRollup.forDataset("blocks");
		expect(roll.digest()).toBeNull();
		expect(roll.rowCount()).toBe(0);
		expect(roll.spec()).toBe(SEMANTIC_DIGEST_SPEC_V1);
	});

	test("rollup composes as sha256 of concatenated per-row digest bytes", () => {
		const roll = SemanticDigestRollup.forDataset("blocks");
		const d1 = semanticDigest.v1.block(sampleBlock);
		const d2 = semanticDigest.v1.block(sampleBurnBlockWithNulls);
		roll.appendRowDigest(d1);
		roll.appendRowDigest(d2);

		const expected = createHash("sha256")
			.update(Buffer.from(d1, "hex"))
			.update(Buffer.from(d2, "hex"))
			.digest("hex");
		expect(roll.digest()).toBe(expected);
		expect(roll.rowCount()).toBe(2);
	});

	test("digest() is repeatable and does not consume the hasher", () => {
		const roll = SemanticDigestRollup.forDataset("blocks");
		roll.appendRowDigest(semanticDigest.v1.block(sampleBlock));
		const first = roll.digest();
		const second = roll.digest();
		expect(first).toBe(second);
		// Appending after reading still produces the correct extended digest.
		roll.appendRowDigest(semanticDigest.v1.block(sampleBurnBlockWithNulls));
		expect(roll.digest()).not.toBe(first);
	});

	test("reordering rows changes the rollup — order is part of the contract", () => {
		const a = SemanticDigestRollup.forDataset("blocks");
		const b = SemanticDigestRollup.forDataset("blocks");
		const d1 = semanticDigest.v1.block(sampleBlock);
		const d2 = semanticDigest.v1.block(sampleBurnBlockWithNulls);
		a.appendRowDigest(d1);
		a.appendRowDigest(d2);
		b.appendRowDigest(d2);
		b.appendRowDigest(d1);
		expect(a.digest()).not.toBe(b.digest());
	});
});
