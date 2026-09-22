// Validates decode.ts's two normalizers against each other using a real
// ord 0.29.0 `/decode/{txid}` response captured live on stacks-feeder
// (txid 11b9c94843240d65cd91ed34402017316722d3500914e68bd825d39f5eace81f,
// block 840,000, THERUNIXTOKEN — chosen because its premine
// 21000000000000000000000000000 is the exact precision case json-bigint.ts
// exists for). No network access: the capture is inlined below.
import { describe, expect, test } from "bun:test";
import type { ParsedBlock } from "../block.ts";
import { Flag, flagMask } from "../runes/flag.ts";
import { runeFromString } from "../runes/rune.ts";
import { type TxLike, runestoneDecipher } from "../runes/runestone.ts";
import { Tag } from "../runes/tag.ts";
import { encode } from "../runes/varint.ts";
import {
	normalizeOrdDecode,
	normalizeOurArtifact,
	txidsWithRunestoneMarker,
} from "./decode.ts";
import { parseJsonPreservingBigInts } from "./json-bigint.ts";

const OP_RETURN = 0x6a;
const MAGIC_NUMBER = 0x5d;

function pushSlice(bytes: Uint8Array): number[] {
	const out: number[] = [];
	const len = bytes.length;
	if (len <= 0x4b) out.push(len);
	else if (len <= 0xff) out.push(0x4c, len);
	else throw new Error("unsupported push length in test helper");
	out.push(...bytes);
	return out;
}

function runestoneScript(integers: bigint[]): Uint8Array {
	const payload: number[] = [];
	for (const v of integers) payload.push(...encode(v));
	return Uint8Array.from([
		OP_RETURN,
		MAGIC_NUMBER,
		...pushSlice(Uint8Array.from(payload)),
	]);
}

// Captured live from ord 0.29.0's `/decode/{txid}` (Accept: application/json).
// A raw string literal, NOT `JSON.stringify` on a JS object — the premine
// digit sequence must survive verbatim; round-tripping it through a JS
// `number` first (as `JSON.stringify` would) already loses precision before
// this test ever exercises the bigint-preserving parser.
const THERUNIXTOKEN_ORD_JSON = `{
	"inscriptions": [],
	"runestone": {
		"Runestone": {
			"edicts": [],
			"etching": {
				"divisibility": 18,
				"premine": 21000000000000000000000000000,
				"rune": "THERUNIXTOKEN",
				"spacers": 132,
				"symbol": "\\u16b1",
				"terms": null,
				"turbo": true
			},
			"mint": null,
			"pointer": 1
		}
	}
}`;

describe("decode.ts normalizers", () => {
	test("our decipher output normalizes to the same shape as a captured ord response", () => {
		const rune = runeFromString("THERUNIXTOKEN");
		const script = runestoneScript([
			BigInt(Tag.Flags),
			flagMask(Flag.Etching) | flagMask(Flag.Turbo),
			BigInt(Tag.Rune),
			rune.n,
			BigInt(Tag.Divisibility),
			18n,
			BigInt(Tag.Spacers),
			132n,
			BigInt(Tag.Symbol),
			BigInt("ᚱ".codePointAt(0) as number),
			BigInt(Tag.Premine),
			21000000000000000000000000000n,
			BigInt(Tag.Pointer),
			1n,
		]);

		const tx: TxLike & { txid: string } = {
			txid: "11b9c94843240d65cd91ed34402017316722d3500914e68bd825d39f5eace81f",
			outputs: [
				{ value: 0n, script: Uint8Array.from([0x51, 0x20]) },
				{ value: 0n, script },
			],
		};

		const artifact = runestoneDecipher(tx);
		expect(artifact).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted defined above
		const ours = normalizeOurArtifact(artifact!);

		const ordJson = parseJsonPreservingBigInts(THERUNIXTOKEN_ORD_JSON);
		const ord = normalizeOrdDecode(ordJson);

		expect(ours).toEqual(ord);
	});

	test("normalizeOrdDecode reads a Cenotaph-shaped response", () => {
		const json = parseJsonPreservingBigInts(
			JSON.stringify({
				inscriptions: [],
				runestone: {
					Cenotaph: {
						etching: null,
						flaw: "unrecognized-even-tag",
						mint: null,
					},
				},
			}),
		);
		expect(normalizeOrdDecode(json)).toEqual({
			kind: "cenotaph",
			etching: null,
			flaw: "unrecognized-even-tag",
			mint: null,
		});
	});
});

describe("txidsWithRunestoneMarker", () => {
	test("finds only outputs starting with OP_RETURN OP_13", () => {
		const block: ParsedBlock = {
			hash: "a".repeat(64),
			prevHash: "b".repeat(64),
			time: 0,
			txs: [
				{
					txid: "1".repeat(64),
					inputs: [],
					outputs: [
						{
							value: 0n,
							script: Uint8Array.from([OP_RETURN, MAGIC_NUMBER, 0]),
						},
					],
				},
				{
					txid: "2".repeat(64),
					inputs: [],
					outputs: [{ value: 0n, script: Uint8Array.from([OP_RETURN, 0x00]) }],
				},
			],
		};

		expect(txidsWithRunestoneMarker(block)).toEqual(["1".repeat(64)]);
	});
});
