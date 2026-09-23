import { describe, expect, test } from "bun:test";
// Plan 040 step 2: `cli.ts repair-entries` backfills `symbol_codepoint`/
// `has_terms` on rows written before migration 0003. These tests exercise
// `resolveRepairForRow`/`repairRows` against a stub RPC returning real raw
// tx hex (built by hand below, the same wire format `getrawtransaction
// <txid> false` returns) — no live bitcoind, no Postgres.
import { bytesToHex } from "@noble/hashes/utils.js";
import {
	type EtchingTxFetcher,
	RepairDisagreementError,
	type RepairSourceRow,
	repairRows,
	resolveRepairForRow,
} from "./repair.ts";
import { Flag, flagMask } from "./runes/flag.ts";
import { Tag } from "./runes/tag.ts";
import { encode } from "./runes/varint.ts";

const OP_RETURN = 0x6a;
const MAGIC_NUMBER = 0x5d; // Runestone::MAGIC_NUMBER (OP_PUSHNUM_13), see ./runes/runestone.ts
/** UNCOMMON•GOODS's symbol codepoint (seedGenesis), per ../runes/state.ts. */
const UNCOMMON_GOODS_SYMBOL_CODEPOINT = "⧉".codePointAt(0) as number;

// Below: the same script/payload construction `./runes/runestone.test.ts`
// uses, plus a minimal legacy-tx wire serializer, since (unlike that file)
// these tests need real raw TX HEX — the stub RPC's `getRawTx` return value
// — not just a `TxLike` handed straight to `runestoneDecipher`.
function pushSlice(bytes: Uint8Array): number[] {
	const out: number[] = [];
	const len = bytes.length;
	if (len <= 0x4b) out.push(len);
	else if (len <= 0xff) out.push(0x4c, len);
	else throw new Error("test helper only supports small pushes");
	out.push(...bytes);
	return out;
}
function scriptFromParts(parts: Array<number | Uint8Array>): Uint8Array {
	const out: number[] = [];
	for (const part of parts) {
		if (typeof part === "number") out.push(part);
		else out.push(...pushSlice(part));
	}
	return Uint8Array.from(out);
}
function payloadBytes(integers: bigint[]): Uint8Array {
	const out: number[] = [];
	for (const n of integers) out.push(...encode(n));
	return Uint8Array.from(out);
}
function opReturnScript(integers: bigint[]): Uint8Array {
	return scriptFromParts([OP_RETURN, MAGIC_NUMBER, payloadBytes(integers)]);
}

function le32(n: number): Uint8Array {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, n, true);
	return out;
}
function le64(n: bigint): Uint8Array {
	const out = new Uint8Array(8);
	new DataView(out.buffer).setBigUint64(0, n, true);
	return out;
}
function compactSize(n: number): Uint8Array {
	if (n >= 0xfd)
		throw new Error("test helper only supports small compact sizes");
	return Uint8Array.of(n);
}
function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, c) => sum + c.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

/**
 * A minimal legacy (non-segwit) raw tx: one dummy input, one output carrying
 * `script`. Exactly the wire format `getrawtransaction <txid> false` returns
 * for a real etching tx — enough for `parseTransaction` to read back.
 */
function buildRawEtchingTxHex(script: Uint8Array): string {
	return bytesToHex(
		concatBytes([
			le32(1), // version
			compactSize(1), // input count
			new Uint8Array(32), // prevTxid (dummy, all-zero)
			le32(0), // prevVout
			compactSize(0), // scriptSig (empty)
			le32(0xffffffff), // sequence
			compactSize(1), // output count
			le64(0n), // value
			compactSize(script.length),
			script,
			le32(0), // locktime
		]),
	);
}

function stubFetcher(hexByTxid: Map<string, string>): {
	fetcher: EtchingTxFetcher;
	calls: string[];
} {
	const calls: string[] = [];
	return {
		calls,
		fetcher: {
			getRawTx: async (txid) => {
				calls.push(txid);
				const hex = hexByTxid.get(txid);
				if (!hex) throw new Error(`stub has no tx for ${txid}`);
				return hex;
			},
		},
	};
}

function ambiguousRow(runeId: string, etchingTxid: string): RepairSourceRow {
	return {
		runeId,
		etchingTxid,
		symbol: null,
		termsColumnsAnyNonNull: false,
	};
}

describe("resolveRepairForRow", () => {
	test("a U+0000-symbol etching resolves to codepoint 0", async () => {
		const txid = "a".repeat(64);
		const hex = buildRawEtchingTxHex(
			opReturnScript([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Rune),
				4n,
				BigInt(Tag.Symbol),
				0n, // U+0000
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		);
		const { fetcher, calls } = stubFetcher(new Map([[txid, hex]]));

		const outcome = await resolveRepairForRow(
			ambiguousRow("840000:1", txid),
			fetcher,
		);

		expect(outcome.symbolCodepoint).toBe(0);
		expect(outcome.hasTerms).toBe(false);
		expect(outcome.usedRpc).toBe(true);
		expect(calls).toEqual([txid]);
	});

	test("an empty-terms etching (Terms flag set, no terms_* tags) resolves to has_terms true", async () => {
		const txid = "b".repeat(64);
		const hex = buildRawEtchingTxHex(
			opReturnScript([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching) | flagMask(Flag.Terms),
				BigInt(Tag.Rune),
				5n,
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		);
		const { fetcher, calls } = stubFetcher(new Map([[txid, hex]]));

		const outcome = await resolveRepairForRow(
			ambiguousRow("840000:2", txid),
			fetcher,
		);

		expect(outcome.hasTerms).toBe(true);
		expect(outcome.symbolCodepoint).toBeNull();
		expect(outcome.usedRpc).toBe(true);
		expect(calls).toEqual([txid]);
	});

	test("a cenotaph etching resolves to symbol none / has_terms false", async () => {
		const txid = "c".repeat(64);
		// Same "unrecognized even tag forces a cenotaph" shape as
		// ./runes/runestone.test.ts's "runestone_with_unrecognized_even_tag_is_cenotaph".
		const hex = buildRawEtchingTxHex(
			opReturnScript([
				BigInt(Tag.Cenotaph),
				0n,
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		);
		const { fetcher, calls } = stubFetcher(new Map([[txid, hex]]));

		const outcome = await resolveRepairForRow(
			ambiguousRow("840000:3", txid),
			fetcher,
		);

		expect(outcome.symbolCodepoint).toBeNull();
		expect(outcome.hasTerms).toBe(false);
		expect(outcome.usedRpc).toBe(true);
		expect(calls).toEqual([txid]);
	});

	test("rune 1:0 resolves from seedGenesis with no RPC, even if the fetcher would throw", async () => {
		const fetcher: EtchingTxFetcher = {
			getRawTx: async () => {
				throw new Error("must not be called for the genesis rune");
			},
		};

		const outcome = await resolveRepairForRow(
			{
				runeId: "1:0",
				etchingTxid: "0".repeat(64),
				symbol: null,
				termsColumnsAnyNonNull: false,
			},
			fetcher,
		);

		expect(outcome.usedRpc).toBe(false);
		expect(outcome.hasTerms).toBe(true);
		expect(outcome.symbolCodepoint).toBe(UNCOMMON_GOODS_SYMBOL_CODEPOINT);
	});

	test("symbol already known (text non-null) and terms already known (a terms_* column non-null): no RPC", async () => {
		const fetcher: EtchingTxFetcher = {
			getRawTx: async () => {
				throw new Error("must not be called when both are already known");
			},
		};

		const outcome = await resolveRepairForRow(
			{
				runeId: "840000:4",
				etchingTxid: "d".repeat(64),
				symbol: "⧉",
				termsColumnsAnyNonNull: true,
			},
			fetcher,
		);

		expect(outcome.usedRpc).toBe(false);
		expect(outcome.symbolCodepoint).toBe(UNCOMMON_GOODS_SYMBOL_CODEPOINT);
		expect(outcome.hasTerms).toBe(true);
	});

	test("STOP condition: a re-deciphered symbol disagreeing with a non-null stored symbol throws, not silently overwrites", async () => {
		const txid = "e".repeat(64);
		// Decodes to symbol "a", not "⧉" — a stand-in for a genuinely corrupt
		// original decode, which repair-entries must surface, not paper over.
		const hex = buildRawEtchingTxHex(
			opReturnScript([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Symbol),
				BigInt("a".codePointAt(0) as number),
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		);
		const { fetcher } = stubFetcher(new Map([[txid, hex]]));

		await expect(
			resolveRepairForRow(
				{
					runeId: "840000:5",
					etchingTxid: txid,
					symbol: "⧉", // stored symbol disagrees with the re-decode ("a")
					termsColumnsAnyNonNull: false, // still ambiguous -> forces the RPC path
				},
				fetcher,
			),
		).rejects.toThrow(RepairDisagreementError);
	});
});

describe("repairRows idempotency", () => {
	test("a second run over zero remaining rows makes zero RPC calls", async () => {
		const txid = "f".repeat(64);
		const hex = buildRawEtchingTxHex(
			opReturnScript([
				BigInt(Tag.Cenotaph),
				0n,
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		);
		const { fetcher, calls } = stubFetcher(new Map([[txid, hex]]));

		const first = await repairRows([ambiguousRow("840000:6", txid)], fetcher);
		expect(first.rpcCalls).toBe(1);
		expect(calls).toHaveLength(1);

		// Simulates the second `repair-entries` run: the DB's
		// `WHERE repaired_at IS NULL` now returns nothing, since the first run
		// marked this row's `repaired_at`.
		const second = await repairRows([], fetcher);
		expect(second.rpcCalls).toBe(0);
		expect(calls).toHaveLength(1); // unchanged
	});
});
