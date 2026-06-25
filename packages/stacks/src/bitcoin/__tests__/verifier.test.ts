import { describe, expect, test } from "bun:test";
import { deserializeCVBytes } from "../../clarity/deserialize.ts";
import { Cl, type ClarityValue } from "../../clarity/index.ts";
import { serializeCVBytes } from "../../clarity/serialize.ts";
import type { Client } from "../../clients/types.ts";
import {
	bytesToHex,
	hexToBytes,
	with0x,
	without0x,
} from "../../utils/encoding.ts";
import { isClarity6Active } from "../activation.ts";
import { buildMerkleProof, merkleRoot } from "../merkle.ts";
import { reverseBytes } from "../serialize.ts";
import { bitcoinVerifier } from "../verifier.ts";

const internal = (display: string): Uint8Array =>
	reverseBytes(hexToBytes(display));

const CB = "b1fea52486ce0c62bb442b530a3f0132b826c74e473d1f2c220bfa78111c5082";
const SPEND =
	"f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16";

/**
 * A mock client that records read-only calls and returns a canned, serialized
 * Clarity value. `request` mirrors the real `/v2/contracts/call-read` shape.
 */
function mockReadClient(
	respond: (fnName: string, args: ClarityValue[]) => ClarityValue,
	calls: { fnName: string; args: ClarityValue[] }[] = [],
): Client {
	return {
		async request(path: string, opts?: { body?: { arguments?: string[] } }) {
			const fnName = path.split("/").pop() as string;
			const args = (opts?.body?.arguments ?? []).map((hex) =>
				deserializeCVBytes(hexToBytes(without0x(hex))),
			);
			calls.push({ fnName, args });
			const cv = respond(fnName, args);
			return { okay: true, result: with0x(bytesToHex(serializeCVBytes(cv))) };
		},
	} as unknown as Client;
}

describe("bitcoinVerifier.verifyMerkleProof", () => {
	const txids = [internal(CB), internal(SPEND)];
	const root = merkleRoot(txids);
	const proof = buildMerkleProof(txids, 1);

	test("sends the native flat 5-arg vector in internal order, returns the bool", async () => {
		const calls: { fnName: string; args: ClarityValue[] }[] = [];
		const client = mockReadClient(() => Cl.bool(true), calls);
		const verifier = bitcoinVerifier(client, { contract: "SP000.spv-adapter" });

		const ok = await verifier.verifyMerkleProof({
			leaf: txids[1] as Uint8Array,
			root,
			proof,
		});

		expect(ok).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.fnName).toBe("verify-merkle");

		const args = calls[0]?.args ?? [];
		expect(args.map((a) => a.type)).toEqual([
			"buffer",
			"buffer",
			"uint",
			"uint",
			"list",
		]);
		// leaf is the internal-order txid (not the displayed form).
		expect((args[0] as { value: string }).value).toBe(
			bytesToHex(txids[1] as Uint8Array),
		);
		expect((args[2] as { value: bigint }).value).toBe(1n);
		expect((args[3] as { value: bigint }).value).toBe(2n);
	});

	test("returns false when the contract says false", async () => {
		const client = mockReadClient(() => Cl.bool(false));
		const verifier = bitcoinVerifier(client, { contract: "SP000.spv-adapter" });
		expect(
			await verifier.verifyMerkleProof({
				leaf: txids[1] as Uint8Array,
				root,
				proof,
			}),
		).toBe(false);
	});
});

describe("bitcoinVerifier.getTxOutput", () => {
	test("decodes the {script, amount, txid} response", async () => {
		const scriptHex = `0014${"11".repeat(20)}`;
		const client = mockReadClient(() =>
			Cl.ok(
				Cl.tuple({
					script: Cl.bufferFromHex(scriptHex),
					amount: Cl.uint(1234n),
					txid: Cl.bufferFromHex(CB),
				}),
			),
		);
		const verifier = bitcoinVerifier(client, { contract: "SP000.spv-adapter" });
		const out = await verifier.getTxOutput(hexToBytes("00".repeat(10)), 0);
		expect(bytesToHex(out.script)).toBe(scriptHex);
		expect(out.amount).toBe(1234n);
		expect(bytesToHex(out.txid)).toBe(CB);
	});

	test("throws when the built-in returns an err", async () => {
		const client = mockReadClient(() => Cl.error(Cl.uint(2)));
		const verifier = bitcoinVerifier(client, { contract: "SP000.spv-adapter" });
		await expect(verifier.getTxOutput(hexToBytes("00"), 9)).rejects.toThrow();
	});
});

describe("isClarity6Active", () => {
	function infoClient(burnHeight: number): Client {
		return {
			async request() {
				return { burn_block_height: burnHeight };
			},
		} as unknown as Client;
	}

	test("true once the burn height reaches the activation height", async () => {
		expect(
			await isClarity6Active(infoClient(900_100), {
				activationBurnHeight: 900_000,
			}),
		).toBe(true);
	});

	test("false before activation", async () => {
		expect(
			await isClarity6Active(infoClient(899_000), {
				activationBurnHeight: 900_000,
			}),
		).toBe(false);
	});

	test("throws when the activation height is unknown", async () => {
		await expect(isClarity6Active(infoClient(900_000))).rejects.toThrow();
	});
});
