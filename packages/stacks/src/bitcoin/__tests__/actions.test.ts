import { describe, expect, test } from "bun:test";
import { Cl, type ClarityValue } from "../../clarity/index.ts";
import { serializeCVBytes } from "../../clarity/serialize.ts";
import type { Client } from "../../clients/types.ts";
import { bytesToHex, hexToBytes, with0x } from "../../utils/encoding.ts";
import { verifyBitcoinPayment } from "../actions.ts";
import { formatBitcoinAddress } from "../address.ts";
import { parseOutputScript } from "../codec.ts";
import type { ProofSource } from "../proof.ts";
import { parseBlockHeader, reverseBytes } from "../serialize.ts";

const internal = (display: string): Uint8Array =>
	reverseBytes(hexToBytes(display));

const BLOCK_170 = {
	height: 170,
	header:
		"0100000055bd840a78798ad0da853f68974f3d183e2bd1db6a842c1feecf222a00000000ff104ccb05421ab93e63f8c3ce5c2c2e9dbb37de2764b3a3175c8166562cac7d51b96a49ffff001d283e9e70",
	coinbaseTxid:
		"b1fea52486ce0c62bb442b530a3f0132b826c74e473d1f2c220bfa78111c5082",
	coinbaseRawTx:
		"01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d0102ffffffff0100f2052a01000000434104d46c4968bde02899d2aa0963367c7a6ce34eec332b32e42e5f3407e052d64ac625da6f0718e7b302140434bd725706957c092db53805b821a85b23a7ac61725bac00000000",
	spendTxid: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
	coinbaseValueSats: 5_000_000_000n,
};

function block170Source(): ProofSource {
	return {
		async getRawTx() {
			return hexToBytes(BLOCK_170.coinbaseRawTx);
		},
		async getBlockForTx() {
			return {
				header: hexToBytes(BLOCK_170.header),
				height: BLOCK_170.height,
				txidsInternal: [
					internal(BLOCK_170.coinbaseTxid),
					internal(BLOCK_170.spendTxid),
				],
				txIndex: 0,
			};
		},
	};
}

const headerRoot = parseBlockHeader(hexToBytes(BLOCK_170.header)).merkleRoot;

/** Mock adapter: verify-merkle → bool, get-header-merkle-root → optional root. */
function adapterClient(opts: {
	verifyMerkle?: boolean;
	headerRoot?: Uint8Array | null;
}): Client {
	const cv = (fnName: string): ClarityValue => {
		if (fnName === "verify-merkle") return Cl.bool(opts.verifyMerkle ?? true);
		if (fnName === "get-header-merkle-root") {
			const r = opts.headerRoot === undefined ? headerRoot : opts.headerRoot;
			return r === null ? Cl.none() : Cl.some(Cl.buffer(r));
		}
		throw new Error(`unexpected fn ${fnName}`);
	};
	return {
		async request(path: string) {
			const fnName = path.split("/").pop() as string;
			return {
				okay: true,
				result: with0x(bytesToHex(serializeCVBytes(cv(fnName)))),
			};
		},
	} as unknown as Client;
}

describe("formatBitcoinAddress", () => {
	test("P2PKH mainnet (genesis recipient)", () => {
		const parsed = parseOutputScript(
			hexToBytes(`76a914${"62e907b15cbf27d5425399ebf6f0fb50ebb88f18"}88ac`),
		);
		expect(formatBitcoinAddress(parsed, "mainnet")).toBe(
			"1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
		);
	});

	test("P2WPKH mainnet (BIP173 vector)", () => {
		const parsed = parseOutputScript(
			hexToBytes("0014751e76e8199196d454941c45d1b3a323f1433bd6"),
		);
		expect(formatBitcoinAddress(parsed, "mainnet")).toBe(
			"bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
		);
	});

	test("P2PKH testnet uses a different version byte", () => {
		const parsed = parseOutputScript(
			hexToBytes(`76a914${"62e907b15cbf27d5425399ebf6f0fb50ebb88f18"}88ac`),
		);
		const addr = formatBitcoinAddress(parsed, "testnet");
		expect(addr?.startsWith("m") || addr?.startsWith("n")).toBe(true);
	});

	test("returns undefined for OP_RETURN", () => {
		const parsed = parseOutputScript(hexToBytes("6a0568656c6c6f"));
		expect(formatBitcoinAddress(parsed)).toBeUndefined();
	});
});

describe("verifyBitcoinPayment", () => {
	test("verifies a mined payment and matches the expected amount", async () => {
		const result = await verifyBitcoinPayment(adapterClient({}), {
			source: block170Source(),
			txid: BLOCK_170.coinbaseTxid,
			contract: "SP000.spv-adapter",
			vout: 0,
			expect: { amount: BLOCK_170.coinbaseValueSats },
		});

		expect(result.headerAuthentic).toBe(true);
		expect(result.included).toBe(true);
		expect(result.mined).toBe(true);
		expect(result.verified).toBe(true);
		expect(result.output.amount).toBe(BLOCK_170.coinbaseValueSats);
		expect(result.output.vout).toBe(0);
	});

	test("not verified when the expected amount differs", async () => {
		const result = await verifyBitcoinPayment(adapterClient({}), {
			source: block170Source(),
			txid: BLOCK_170.coinbaseTxid,
			contract: "SP000.spv-adapter",
			vout: 0,
			expect: { amount: 1n },
		});
		expect(result.mined).toBe(true);
		expect(result.verified).toBe(false);
	});

	test("not mined when the on-chain header root does not match", async () => {
		const result = await verifyBitcoinPayment(
			adapterClient({ headerRoot: new Uint8Array(32) }),
			{
				source: block170Source(),
				txid: BLOCK_170.coinbaseTxid,
				contract: "SP000.spv-adapter",
				vout: 0,
			},
		);
		expect(result.headerAuthentic).toBe(false);
		expect(result.mined).toBe(false);
		expect(result.verified).toBe(false);
	});

	test("not mined when the chain has no header at that height", async () => {
		const result = await verifyBitcoinPayment(
			adapterClient({ headerRoot: null }),
			{
				source: block170Source(),
				txid: BLOCK_170.coinbaseTxid,
				contract: "SP000.spv-adapter",
				vout: 0,
			},
		);
		expect(result.mined).toBe(false);
	});

	test("not mined when merkle inclusion fails", async () => {
		const result = await verifyBitcoinPayment(
			adapterClient({ verifyMerkle: false }),
			{
				source: block170Source(),
				txid: BLOCK_170.coinbaseTxid,
				contract: "SP000.spv-adapter",
				vout: 0,
			},
		);
		expect(result.included).toBe(false);
		expect(result.mined).toBe(false);
	});

	test("skips header authentication when disabled", async () => {
		// get-header-merkle-root would throw if called; authenticateHeader:false avoids it.
		const result = await verifyBitcoinPayment(
			adapterClient({ headerRoot: null }),
			{
				source: block170Source(),
				txid: BLOCK_170.coinbaseTxid,
				contract: "SP000.spv-adapter",
				vout: 0,
				authenticateHeader: false,
			},
		);
		expect(result.headerAuthentic).toBe(true);
		expect(result.mined).toBe(true);
	});
});
