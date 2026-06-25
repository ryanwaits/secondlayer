import { describe, expect, test } from "bun:test";
import { Cl, responseOkCV } from "../../clarity/index.ts";
import { bytesToHex, concatBytes, hexToBytes } from "../../utils/encoding.ts";
import {
	decodeTxOutput,
	encodeMerkleProofArgs,
	parseOutputScript,
} from "../codec.ts";
import { type MerkleProof, buildMerkleProof, merkleRoot } from "../merkle.ts";
import { reverseBytes } from "../serialize.ts";

const internal = (display: string): Uint8Array =>
	reverseBytes(hexToBytes(display));

// Block 170 — a real 2-tx tree for a non-trivial proof.
const CB = "b1fea52486ce0c62bb442b530a3f0132b826c74e473d1f2c220bfa78111c5082";
const SPEND =
	"f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16";

describe("encodeMerkleProofArgs", () => {
	const txids = [internal(CB), internal(SPEND)];
	const root = merkleRoot(txids);
	const proof = buildMerkleProof(txids, 1);
	const args = encodeMerkleProofArgs({
		leaf: txids[1] as Uint8Array,
		root,
		proof,
	});

	test("is a flat 5-arg vector, not a tuple", () => {
		expect(args).toHaveLength(5);
		expect(args.some((a) => a.type === "tuple")).toBe(false);
	});

	test("leaf + root are buffers in internal order (no reversal)", () => {
		expect(args[0]).toEqual({
			type: "buffer",
			value: bytesToHex(txids[1] as Uint8Array),
		});
		expect(args[1]).toEqual({ type: "buffer", value: bytesToHex(root) });
		// Sanity: internal order is the reverse of the displayed txid.
		expect(args[0].value).not.toBe(SPEND);
	});

	test("tx-index + tx-count are uints", () => {
		expect(args[2]).toEqual({ type: "uint", value: 1n });
		expect(args[3]).toEqual({ type: "uint", value: 2n });
	});

	test("siblings are a list of buffers in internal order", () => {
		expect(args[4].type).toBe("list");
		const list = args[4].value;
		expect(list).toHaveLength(1);
		expect(list[0]).toEqual({
			type: "buffer",
			value: bytesToHex(txids[0] as Uint8Array),
		});
	});

	test("rejects a non-32-byte leaf", () => {
		expect(() =>
			encodeMerkleProofArgs({
				leaf: new Uint8Array(31),
				root,
				proof,
			}),
		).toThrow();
	});

	test("rejects a sibling count that disagrees with tx-count", () => {
		const bad: MerkleProof = { siblings: [], txIndex: 1, txCount: 2 };
		expect(() =>
			encodeMerkleProofArgs({ leaf: txids[1] as Uint8Array, root, proof: bad }),
		).toThrow();
	});

	test("rejects more than 24 siblings (native list cap)", () => {
		const bad: MerkleProof = {
			siblings: Array.from({ length: 25 }, () => new Uint8Array(32)),
			txIndex: 0,
			txCount: 2 ** 25,
		};
		expect(() =>
			encodeMerkleProofArgs({ leaf: txids[0] as Uint8Array, root, proof: bad }),
		).toThrow();
	});

	test("rejects tx-index out of range", () => {
		const bad: MerkleProof = { siblings: [], txIndex: 5, txCount: 1 };
		expect(() =>
			encodeMerkleProofArgs({ leaf: txids[0] as Uint8Array, root, proof: bad }),
		).toThrow();
	});
});

describe("decodeTxOutput", () => {
	const scriptHex = `76a914${"00".repeat(20)}88ac`;
	const tuple = Cl.tuple({
		script: Cl.bufferFromHex(scriptHex),
		amount: Cl.uint(5_000_000_000n),
		txid: Cl.bufferFromHex(CB),
	});

	test("decodes the {script, amount, txid} tuple", () => {
		const out = decodeTxOutput(tuple);
		expect(bytesToHex(out.script)).toBe(scriptHex);
		expect(out.amount).toBe(5_000_000_000n);
		expect(bytesToHex(out.txid)).toBe(CB);
	});

	test("unwraps a (response ok ...) wrapper", () => {
		const out = decodeTxOutput(responseOkCV(tuple));
		expect(out.amount).toBe(5_000_000_000n);
	});

	test("throws on a non-tuple value", () => {
		expect(() => decodeTxOutput(Cl.uint(1))).toThrow();
	});
});

describe("parseOutputScript", () => {
	const hash20 = hexToBytes("62e907b15cbf27d5425399ebf6f0fb50ebb88f18");
	const prog32 = hexToBytes("00".repeat(32));

	test("P2PKH", () => {
		const script = concatBytes(
			hexToBytes("76a914"),
			hash20,
			hexToBytes("88ac"),
		);
		const r = parseOutputScript(script);
		expect(r.type).toBe("p2pkh");
		expect(bytesToHex(r.hash as Uint8Array)).toBe(bytesToHex(hash20));
	});

	test("P2SH", () => {
		const script = concatBytes(hexToBytes("a914"), hash20, hexToBytes("87"));
		expect(parseOutputScript(script).type).toBe("p2sh");
	});

	test("P2WPKH", () => {
		const script = concatBytes(hexToBytes("0014"), hash20);
		const r = parseOutputScript(script);
		expect(r.type).toBe("p2wpkh");
		expect(bytesToHex(r.hash as Uint8Array)).toBe(bytesToHex(hash20));
	});

	test("P2WSH", () => {
		const script = concatBytes(hexToBytes("0020"), prog32);
		expect(parseOutputScript(script).type).toBe("p2wsh");
	});

	test("P2TR", () => {
		const script = concatBytes(hexToBytes("5120"), prog32);
		const r = parseOutputScript(script);
		expect(r.type).toBe("p2tr");
		expect(bytesToHex(r.hash as Uint8Array)).toBe(bytesToHex(prog32));
	});

	test("OP_RETURN carries its data", () => {
		const payload = hexToBytes("48656c6c6f");
		const r = parseOutputScript(concatBytes(hexToBytes("6a"), payload));
		expect(r.type).toBe("op_return");
		expect(bytesToHex(r.data as Uint8Array)).toBe("48656c6c6f");
	});

	test("genesis P2PK output is unknown (we don't template P2PK)", () => {
		const p2pk = concatBytes(
			hexToBytes("41"),
			hexToBytes(`04${"ab".repeat(64)}`),
			hexToBytes("ac"),
		);
		expect(parseOutputScript(p2pk).type).toBe("unknown");
	});
});
