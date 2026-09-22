// Ported test-for-test from ord 0.29.0 `crates/ordinals/src/runestone.rs`
// `#[cfg(test)] mod tests`, decode direction only (this package never
// enciphers a runestone — it only decodes chain data). NOT ported:
// `runestone_size`, `encipher`, `runestone_payloads_are_not_chunked` — all
// three exercise `Runestone::encipher()`, which this port doesn't implement
// (see NOTES in the executor report). Every other test in the file below is
// ported.
import { describe, expect, test } from "bun:test";
import {
	type Artifact,
	artifactCenotaph,
	artifactRunestone,
} from "./artifact.ts";
import { ETCHING_MAX_DIVISIBILITY, defaultEtching } from "./etching.ts";
import { Flag, flagMask } from "./flag.ts";
import { Flaw } from "./flaw.ts";
import { rune } from "./rune.ts";
import { type RuneId, runeIdNew } from "./rune_id.ts";
import {
	MAGIC_NUMBER,
	type TxLike,
	defaultRunestone,
	findPayload,
	runestoneDecipher,
} from "./runestone.ts";
import { Tag } from "./tag.ts";
import { encode } from "./varint.ts";

const OP_RETURN = 0x6a;

function ruleId(tx: number): RuneId {
	return { block: 1n, tx: BigInt(tx) };
}

function pushSlice(bytes: Uint8Array): number[] {
	const out: number[] = [];
	const len = bytes.length;
	if (len <= 0x4b) {
		out.push(len);
	} else if (len <= 0xff) {
		out.push(0x4c, len);
	} else if (len <= 0xffff) {
		out.push(0x4d, len & 0xff, (len >> 8) & 0xff);
	} else {
		out.push(
			0x4e,
			len & 0xff,
			(len >> 8) & 0xff,
			(len >> 16) & 0xff,
			(len >> 24) & 0xff,
		);
	}
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

function txOut(script: Uint8Array): { value: bigint; script: Uint8Array } {
	return { value: 0n, script };
}

function payloadBytes(integers: bigint[]): Uint8Array {
	const out: number[] = [];
	for (const n of integers) out.push(...encode(n));
	return Uint8Array.from(out);
}

function decipher(integers: bigint[]): Artifact {
	const script = scriptFromParts([
		OP_RETURN,
		MAGIC_NUMBER,
		payloadBytes(integers),
	]);
	const tx: TxLike = { outputs: [txOut(script)] };
	const result = runestoneDecipher(tx);
	if (result === undefined) throw new Error("expected a decipher result");
	return result;
}

describe("Runestone", () => {
	test("decipher_returns_none_if_first_opcode_is_malformed", () => {
		const tx: TxLike = {
			outputs: [txOut(Uint8Array.from([0x04]))], // OP_PUSHBYTES_4 with no data
		};
		expect(runestoneDecipher(tx)).toBeUndefined();
	});

	test("deciphering_transaction_with_no_outputs_returns_none", () => {
		expect(runestoneDecipher({ outputs: [] })).toBeUndefined();
	});

	test("deciphering_transaction_with_non_op_return_output_returns_none", () => {
		const tx: TxLike = {
			outputs: [txOut(scriptFromParts([Uint8Array.from([])]))],
		};
		expect(runestoneDecipher(tx)).toBeUndefined();
	});

	test("deciphering_transaction_with_bare_op_return_returns_none", () => {
		const tx: TxLike = { outputs: [txOut(Uint8Array.from([OP_RETURN]))] };
		expect(runestoneDecipher(tx)).toBeUndefined();
	});

	test("deciphering_transaction_with_non_matching_op_return_returns_none", () => {
		const tx: TxLike = {
			outputs: [
				txOut(
					scriptFromParts([OP_RETURN, Uint8Array.from(Buffer.from("FOOO"))]),
				),
			],
		};
		expect(runestoneDecipher(tx)).toBeUndefined();
	});

	test("deciphering_valid_runestone_with_invalid_script_postfix_returns_invalid_payload", () => {
		const script = Uint8Array.from([OP_RETURN, MAGIC_NUMBER, 0x04]); // trailing OP_PUSHBYTES_4, no data
		const tx: TxLike = { outputs: [txOut(script)] };
		expect(findPayload(tx)).toEqual({
			kind: "invalid",
			flaw: Flaw.InvalidScript,
		});
	});

	test("deciphering_runestone_with_truncated_varint_succeeds", () => {
		const tx: TxLike = {
			outputs: [
				txOut(
					scriptFromParts([OP_RETURN, MAGIC_NUMBER, Uint8Array.from([128])]),
				),
			],
		};
		expect(runestoneDecipher(tx)).toBeDefined();
	});

	test("outputs_with_non_pushdata_opcodes_are_cenotaph", () => {
		const OP_VERIFY = 0x69;
		const script1 = scriptFromParts([
			OP_RETURN,
			MAGIC_NUMBER,
			OP_VERIFY,
			Uint8Array.from([0]),
			encode(1n),
			encode(1n),
			Uint8Array.from([2, 0]),
		]);
		const script2 = scriptFromParts([
			OP_RETURN,
			MAGIC_NUMBER,
			Uint8Array.from([0]),
			encode(1n),
			encode(2n),
			Uint8Array.from([3, 0]),
		]);
		const tx: TxLike = { outputs: [txOut(script1), txOut(script2)] };
		expect(runestoneDecipher(tx)).toEqual(
			artifactCenotaph({ flaw: Flaw.Opcode }),
		);
	});

	test("pushnum_opcodes_in_runestone_produce_cenotaph", () => {
		const OP_PUSHNUM_1 = 0x51;
		const tx: TxLike = {
			outputs: [
				txOut(Uint8Array.from([OP_RETURN, MAGIC_NUMBER, OP_PUSHNUM_1])),
			],
		};
		expect(runestoneDecipher(tx)).toEqual(
			artifactCenotaph({ flaw: Flaw.Opcode }),
		);
	});

	test("deciphering_empty_runestone_is_successful", () => {
		const tx: TxLike = {
			outputs: [txOut(Uint8Array.from([OP_RETURN, MAGIC_NUMBER]))],
		};
		expect(runestoneDecipher(tx)).toEqual(
			artifactRunestone(defaultRunestone()),
		);
	});

	test("invalid_input_scripts_are_skipped_when_searching_for_runestone", () => {
		const payload = payloadBytes([BigInt(Tag.Mint), 1n, BigInt(Tag.Mint), 1n]);
		const script1 = Uint8Array.from([OP_RETURN, 0x09, MAGIC_NUMBER, 0x04]); // OP_PUSHBYTES_9 (wrong len), truncated
		const script2 = scriptFromParts([OP_RETURN, MAGIC_NUMBER, payload]);
		const tx: TxLike = { outputs: [txOut(script1), txOut(script2)] };
		expect(runestoneDecipher(tx)).toEqual(
			artifactRunestone({ ...defaultRunestone(), mint: runeIdNew(1n, 1n) }),
		);
	});

	test("deciphering_non_empty_runestone_is_successful", () => {
		expect(decipher([BigInt(Tag.Body), 1n, 1n, 2n, 0n])).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
			}),
		);
	});

	test("decipher_etching", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: defaultEtching(),
			}),
		);
	});

	test("decipher_etching_with_rune", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Rune),
				4n,
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: { ...defaultEtching(), rune: rune(4n) },
			}),
		);
	});

	test("terms_flag_without_etching_flag_produces_cenotaph", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Terms),
				BigInt(Tag.Body),
				0n,
				0n,
				0n,
				0n,
			]),
		).toEqual(artifactCenotaph({ flaw: Flaw.UnrecognizedFlag }));
	});

	test("recognized_fields_without_flag_produces_cenotaph", () => {
		function case_(integers: bigint[]) {
			expect(decipher(integers)).toEqual(
				artifactCenotaph({ flaw: Flaw.UnrecognizedEvenTag }),
			);
		}

		case_([BigInt(Tag.Premine), 0n]);
		case_([BigInt(Tag.Rune), 0n]);
		case_([BigInt(Tag.Cap), 0n]);
		case_([BigInt(Tag.Amount), 0n]);
		case_([BigInt(Tag.OffsetStart), 0n]);
		case_([BigInt(Tag.OffsetEnd), 0n]);
		case_([BigInt(Tag.HeightStart), 0n]);
		case_([BigInt(Tag.HeightEnd), 0n]);

		case_([BigInt(Tag.Flags), flagMask(Flag.Etching), BigInt(Tag.Cap), 0n]);
		case_([BigInt(Tag.Flags), flagMask(Flag.Etching), BigInt(Tag.Amount), 0n]);
		case_([
			BigInt(Tag.Flags),
			flagMask(Flag.Etching),
			BigInt(Tag.OffsetStart),
			0n,
		]);
		case_([
			BigInt(Tag.Flags),
			flagMask(Flag.Etching),
			BigInt(Tag.OffsetEnd),
			0n,
		]);
		case_([
			BigInt(Tag.Flags),
			flagMask(Flag.Etching),
			BigInt(Tag.HeightStart),
			0n,
		]);
		case_([
			BigInt(Tag.Flags),
			flagMask(Flag.Etching),
			BigInt(Tag.HeightEnd),
			0n,
		]);
	});

	test("decipher_etching_with_term", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching) | flagMask(Flag.Terms),
				BigInt(Tag.OffsetEnd),
				4n,
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: {
					...defaultEtching(),
					terms: {
						amount: undefined,
						cap: undefined,
						height: [undefined, undefined],
						offset: [undefined, 4n],
					},
				},
			}),
		);
	});

	test("decipher_etching_with_amount", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching) | flagMask(Flag.Terms),
				BigInt(Tag.Amount),
				4n,
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: {
					...defaultEtching(),
					terms: {
						amount: 4n,
						cap: undefined,
						height: [undefined, undefined],
						offset: [undefined, undefined],
					},
				},
			}),
		);
	});

	test("invalid_varint_produces_cenotaph", () => {
		const tx: TxLike = {
			outputs: [
				txOut(
					scriptFromParts([OP_RETURN, MAGIC_NUMBER, Uint8Array.from([128])]),
				),
			],
		};
		expect(runestoneDecipher(tx)).toEqual(
			artifactCenotaph({ flaw: Flaw.Varint }),
		);
	});

	test("duplicate_even_tags_produce_cenotaph", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Rune),
				4n,
				BigInt(Tag.Rune),
				5n,
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactCenotaph({ flaw: Flaw.UnrecognizedEvenTag, etching: rune(4n) }),
		);
	});

	test("duplicate_odd_tags_are_ignored", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Divisibility),
				4n,
				BigInt(Tag.Divisibility),
				5n,
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: { ...defaultEtching(), rune: undefined, divisibility: 4 },
			}),
		);
	});

	test("unrecognized_odd_tag_is_ignored", () => {
		expect(
			decipher([BigInt(Tag.Nop), 100n, BigInt(Tag.Body), 1n, 1n, 2n, 0n]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
			}),
		);
	});

	test("runestone_with_unrecognized_even_tag_is_cenotaph", () => {
		expect(
			decipher([BigInt(Tag.Cenotaph), 0n, BigInt(Tag.Body), 1n, 1n, 2n, 0n]),
		).toEqual(artifactCenotaph({ flaw: Flaw.UnrecognizedEvenTag }));
	});

	test("runestone_with_unrecognized_flag_is_cenotaph", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Cenotaph),
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(artifactCenotaph({ flaw: Flaw.UnrecognizedFlag }));
	});

	test("runestone_with_edict_id_with_zero_block_and_nonzero_tx_is_cenotaph", () => {
		expect(decipher([BigInt(Tag.Body), 0n, 1n, 2n, 0n])).toEqual(
			artifactCenotaph({ flaw: Flaw.EdictRuneId }),
		);
	});

	test("runestone_with_overflowing_edict_id_delta_is_cenotaph", () => {
		const U64_MAX = (1n << 64n) - 1n;
		expect(
			decipher([BigInt(Tag.Body), 1n, 0n, 0n, 0n, U64_MAX, 0n, 0n, 0n]),
		).toEqual(artifactCenotaph({ flaw: Flaw.EdictRuneId }));
		expect(
			decipher([BigInt(Tag.Body), 1n, 1n, 0n, 0n, 0n, U64_MAX, 0n, 0n]),
		).toEqual(artifactCenotaph({ flaw: Flaw.EdictRuneId }));
	});

	test("runestone_with_output_over_max_is_cenotaph", () => {
		expect(decipher([BigInt(Tag.Body), 1n, 1n, 2n, 2n])).toEqual(
			artifactCenotaph({ flaw: Flaw.EdictOutput }),
		);
	});

	test("tag_with_no_value_is_cenotaph", () => {
		expect(decipher([BigInt(Tag.Flags), 1n, BigInt(Tag.Flags)])).toEqual(
			artifactCenotaph({ flaw: Flaw.TruncatedField }),
		);
	});

	test("trailing_integers_in_body_is_cenotaph", () => {
		const integers = [BigInt(Tag.Body), 1n, 1n, 2n, 0n];
		for (let i = 0; i < 4; i++) {
			const expected =
				i === 0
					? artifactRunestone({
							...defaultRunestone(),
							edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
						})
					: artifactCenotaph({ flaw: Flaw.TrailingIntegers });
			expect(decipher(integers)).toEqual(expected);
			integers.push(0n);
		}
	});

	test("decipher_etching_with_divisibility", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Rune),
				4n,
				BigInt(Tag.Divisibility),
				5n,
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: { ...defaultEtching(), rune: rune(4n), divisibility: 5 },
			}),
		);
	});

	test("divisibility_above_max_is_ignored", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Rune),
				4n,
				BigInt(Tag.Divisibility),
				BigInt(ETCHING_MAX_DIVISIBILITY + 1),
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: { ...defaultEtching(), rune: rune(4n) },
			}),
		);
	});

	test("symbol_above_max_is_ignored", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Symbol),
				BigInt(0x10ffff + 1),
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: defaultEtching(),
			}),
		);
	});

	test("decipher_etching_with_symbol", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Rune),
				4n,
				BigInt(Tag.Symbol),
				BigInt("a".codePointAt(0) as number),
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: { ...defaultEtching(), rune: rune(4n), symbol: "a" },
			}),
		);
	});

	test("decipher_etching_with_all_etching_tags", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching) | flagMask(Flag.Terms) | flagMask(Flag.Turbo),
				BigInt(Tag.Rune),
				4n,
				BigInt(Tag.Divisibility),
				1n,
				BigInt(Tag.Spacers),
				5n,
				BigInt(Tag.Symbol),
				BigInt("a".codePointAt(0) as number),
				BigInt(Tag.OffsetEnd),
				2n,
				BigInt(Tag.Amount),
				3n,
				BigInt(Tag.Premine),
				8n,
				BigInt(Tag.Cap),
				9n,
				BigInt(Tag.Pointer),
				0n,
				BigInt(Tag.Mint),
				1n,
				BigInt(Tag.Mint),
				1n,
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactRunestone({
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: {
					divisibility: 1,
					premine: 8n,
					rune: rune(4n),
					spacers: 5,
					symbol: "a",
					terms: {
						cap: 9n,
						offset: [undefined, 2n],
						amount: 3n,
						height: [undefined, undefined],
					},
					turbo: true,
				},
				pointer: 0,
				mint: runeIdNew(1n, 1n),
			}),
		);
	});

	test("recognized_even_etching_fields_produce_cenotaph_if_etching_flag_is_not_set", () => {
		expect(decipher([BigInt(Tag.Rune), 4n])).toEqual(
			artifactCenotaph({ flaw: Flaw.UnrecognizedEvenTag }),
		);
	});

	test("decipher_etching_with_divisibility_and_symbol", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Rune),
				4n,
				BigInt(Tag.Divisibility),
				1n,
				BigInt(Tag.Symbol),
				BigInt("a".codePointAt(0) as number),
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: {
					...defaultEtching(),
					rune: rune(4n),
					divisibility: 1,
					symbol: "a",
				},
			}),
		);
	});

	test("tag_values_are_not_parsed_as_tags", () => {
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Divisibility),
				BigInt(Tag.Body),
				BigInt(Tag.Body),
				1n,
				1n,
				2n,
				0n,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: { ...defaultEtching(), divisibility: 0 },
			}),
		);
	});

	test("runestone_may_contain_multiple_edicts", () => {
		expect(
			decipher([BigInt(Tag.Body), 1n, 1n, 2n, 0n, 0n, 3n, 5n, 0n]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [
					{ id: ruleId(1), amount: 2n, output: 0 },
					{ id: ruleId(4), amount: 5n, output: 0 },
				],
			}),
		);
	});

	test("runestones_with_invalid_rune_id_blocks_are_cenotaph", () => {
		const U128_MAX = (1n << 128n) - 1n;
		expect(
			decipher([BigInt(Tag.Body), 1n, 1n, 2n, 0n, U128_MAX, 1n, 0n, 0n]),
		).toEqual(artifactCenotaph({ flaw: Flaw.EdictRuneId }));
	});

	test("runestones_with_invalid_rune_id_txs_are_cenotaph", () => {
		const U128_MAX = (1n << 128n) - 1n;
		expect(
			decipher([BigInt(Tag.Body), 1n, 1n, 2n, 0n, 1n, U128_MAX, 0n, 0n]),
		).toEqual(artifactCenotaph({ flaw: Flaw.EdictRuneId }));
	});

	test("payload_pushes_are_concatenated", () => {
		const script = scriptFromParts([
			OP_RETURN,
			MAGIC_NUMBER,
			encode(BigInt(Tag.Flags)),
			encode(flagMask(Flag.Etching)),
			encode(BigInt(Tag.Divisibility)),
			encode(5n),
			encode(BigInt(Tag.Body)),
			encode(1n),
			encode(1n),
			encode(2n),
			encode(0n),
		]);
		const tx: TxLike = { outputs: [txOut(script)] };
		expect(runestoneDecipher(tx)).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
				etching: { ...defaultEtching(), divisibility: 5 },
			}),
		);
	});

	test("runestone_may_be_in_second_output", () => {
		const payload = payloadBytes([0n, 1n, 1n, 2n, 0n]);
		const tx: TxLike = {
			outputs: [
				txOut(Uint8Array.from([])),
				txOut(scriptFromParts([OP_RETURN, MAGIC_NUMBER, payload])),
			],
		};
		expect(runestoneDecipher(tx)).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
			}),
		);
	});

	test("runestone_may_be_after_non_matching_op_return", () => {
		const payload = payloadBytes([0n, 1n, 1n, 2n, 0n]);
		const tx: TxLike = {
			outputs: [
				txOut(
					scriptFromParts([OP_RETURN, Uint8Array.from(Buffer.from("FOO"))]),
				),
				txOut(scriptFromParts([OP_RETURN, MAGIC_NUMBER, payload])),
			],
		};
		expect(runestoneDecipher(tx)).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				edicts: [{ id: ruleId(1), amount: 2n, output: 0 }],
			}),
		);
	});

	test("etching_with_term_greater_than_maximum_is_still_an_etching", () => {
		const U64_MAX = (1n << 64n) - 1n;
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.OffsetEnd),
				U64_MAX + 1n,
			]),
		).toEqual(artifactCenotaph({ flaw: Flaw.UnrecognizedEvenTag }));
	});

	test("edict_output_greater_than_32_max_produces_cenotaph", () => {
		expect(decipher([BigInt(Tag.Body), 1n, 1n, 1n, 0xffffffffn + 1n])).toEqual(
			artifactCenotaph({ flaw: Flaw.EdictOutput }),
		);
	});

	test("partial_mint_produces_cenotaph", () => {
		expect(decipher([BigInt(Tag.Mint), 1n])).toEqual(
			artifactCenotaph({ flaw: Flaw.UnrecognizedEvenTag }),
		);
	});

	test("invalid_mint_produces_cenotaph", () => {
		expect(decipher([BigInt(Tag.Mint), 0n, BigInt(Tag.Mint), 1n])).toEqual(
			artifactCenotaph({ flaw: Flaw.UnrecognizedEvenTag }),
		);
	});

	test("invalid_deadline_produces_cenotaph", () => {
		const U128_MAX = (1n << 128n) - 1n;
		expect(decipher([BigInt(Tag.OffsetEnd), U128_MAX])).toEqual(
			artifactCenotaph({ flaw: Flaw.UnrecognizedEvenTag }),
		);
	});

	test("invalid_default_output_produces_cenotaph", () => {
		const U128_MAX = (1n << 128n) - 1n;
		expect(decipher([BigInt(Tag.Pointer), 1n])).toEqual(
			artifactCenotaph({ flaw: Flaw.UnrecognizedEvenTag }),
		);
		expect(decipher([BigInt(Tag.Pointer), U128_MAX])).toEqual(
			artifactCenotaph({ flaw: Flaw.UnrecognizedEvenTag }),
		);
	});

	test("invalid_divisibility_does_not_produce_cenotaph", () => {
		const U128_MAX = (1n << 128n) - 1n;
		expect(decipher([BigInt(Tag.Divisibility), U128_MAX])).toEqual(
			artifactRunestone(defaultRunestone()),
		);
	});

	test("min_and_max_runes_are_not_cenotaphs", () => {
		const U128_MAX = (1n << 128n) - 1n;
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Rune),
				0n,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				etching: { ...defaultEtching(), rune: rune(0n) },
			}),
		);
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching),
				BigInt(Tag.Rune),
				U128_MAX,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				etching: { ...defaultEtching(), rune: rune(U128_MAX) },
			}),
		);
	});

	test("invalid_spacers_does_not_produce_cenotaph", () => {
		const U128_MAX = (1n << 128n) - 1n;
		expect(decipher([BigInt(Tag.Spacers), U128_MAX])).toEqual(
			artifactRunestone(defaultRunestone()),
		);
	});

	test("invalid_symbol_does_not_produce_cenotaph", () => {
		const U128_MAX = (1n << 128n) - 1n;
		expect(decipher([BigInt(Tag.Symbol), U128_MAX])).toEqual(
			artifactRunestone(defaultRunestone()),
		);
	});

	test("invalid_term_produces_cenotaph", () => {
		const U128_MAX = (1n << 128n) - 1n;
		expect(decipher([BigInt(Tag.OffsetEnd), U128_MAX])).toEqual(
			artifactCenotaph({ flaw: Flaw.UnrecognizedEvenTag }),
		);
	});

	test("invalid_supply_produces_cenotaph", () => {
		const U128_MAX = (1n << 128n) - 1n;
		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching) | flagMask(Flag.Terms),
				BigInt(Tag.Cap),
				1n,
				BigInt(Tag.Amount),
				U128_MAX,
			]),
		).toEqual(
			artifactRunestone({
				...defaultRunestone(),
				etching: {
					...defaultEtching(),
					terms: {
						cap: 1n,
						amount: U128_MAX,
						height: [undefined, undefined],
						offset: [undefined, undefined],
					},
				},
			}),
		);

		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching) | flagMask(Flag.Terms),
				BigInt(Tag.Cap),
				2n,
				BigInt(Tag.Amount),
				U128_MAX,
			]),
		).toEqual(artifactCenotaph({ flaw: Flaw.SupplyOverflow }));

		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching) | flagMask(Flag.Terms),
				BigInt(Tag.Cap),
				2n,
				BigInt(Tag.Amount),
				U128_MAX / 2n + 1n,
			]),
		).toEqual(artifactCenotaph({ flaw: Flaw.SupplyOverflow }));

		expect(
			decipher([
				BigInt(Tag.Flags),
				flagMask(Flag.Etching) | flagMask(Flag.Terms),
				BigInt(Tag.Premine),
				1n,
				BigInt(Tag.Cap),
				1n,
				BigInt(Tag.Amount),
				U128_MAX,
			]),
		).toEqual(artifactCenotaph({ flaw: Flaw.SupplyOverflow }));
	});

	test("invalid_scripts_in_op_returns_without_magic_number_are_ignored", () => {
		const tx1: TxLike = {
			outputs: [txOut(Uint8Array.from([OP_RETURN, 0x04]))],
		};
		expect(runestoneDecipher(tx1)).toBeUndefined();

		const tx2: TxLike = {
			outputs: [
				txOut(Uint8Array.from([OP_RETURN, 0x04])),
				// `Runestone::default().encipher()` — an empty payload produces
				// just OP_RETURN + MAGIC_NUMBER with no data pushes.
				txOut(Uint8Array.from([OP_RETURN, MAGIC_NUMBER])),
			],
		};
		expect(runestoneDecipher(tx2)).toEqual(
			artifactRunestone(defaultRunestone()),
		);
	});

	test("invalid_scripts_in_op_returns_with_magic_number_produce_cenotaph", () => {
		const tx: TxLike = {
			outputs: [txOut(Uint8Array.from([OP_RETURN, MAGIC_NUMBER, 0x04]))],
		};
		expect(runestoneDecipher(tx)).toEqual(
			artifactCenotaph({ flaw: Flaw.InvalidScript }),
		);
	});

	test("all_pushdata_opcodes_are_valid", () => {
		for (let i = 0; i < 79; i++) {
			const scriptPubkey: number[] = [OP_RETURN, MAGIC_NUMBER, i];

			if (i <= 75) {
				for (let j = 0; j < i; j++) {
					scriptPubkey.push(j % 2 === 0 ? 1 : 0);
				}
				if (i % 2 === 1) {
					scriptPubkey.push(1, 1);
				}
			} else if (i === 76) {
				scriptPubkey.push(0);
			} else if (i === 77) {
				scriptPubkey.push(0, 0);
			} else if (i === 78) {
				scriptPubkey.push(0, 0, 0, 0);
			}

			const tx: TxLike = { outputs: [txOut(Uint8Array.from(scriptPubkey))] };
			expect(runestoneDecipher(tx)).toEqual(
				artifactRunestone(defaultRunestone()),
			);
		}
	});

	test("all_non_pushdata_opcodes_are_invalid", () => {
		for (let i = 79; i <= 255; i++) {
			const tx: TxLike = {
				outputs: [txOut(Uint8Array.from([OP_RETURN, MAGIC_NUMBER, i]))],
			};
			expect(runestoneDecipher(tx)).toEqual(
				artifactCenotaph({ flaw: Flaw.Opcode }),
			);
		}
	});
});
