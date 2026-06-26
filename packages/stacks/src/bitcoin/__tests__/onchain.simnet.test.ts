import { beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Simnet, initSimnet } from "@stacks/clarinet-sdk";
import { Cl, type ClarityValue as StacksCV } from "@stacks/transactions";
import {
	type ClarityValue,
	bufferCV,
	deserializeCV,
	falseCV,
	responseErrorCV,
	serializeCV,
	someCV,
	trueCV,
	uintCV,
} from "../../clarity/index.ts";
import { bytesToHex, hexToBytes } from "../../utils/encoding.ts";
import {
	buildMerkleProof,
	decodeTxOutput,
	encodeMerkleProofArgs,
	merkleRoot,
	reverseBytes,
} from "../index.ts";

// Exercises the SIP-044 (Clarity 6 / Epoch 4.0) Bitcoin SPV built-ins through
// the `spv-adapter` reference contract in Clarinet's simnet — proving the bytes
// the SDK encodes are exactly what the native built-ins accept. Clarinet 3.21+
// boots simnet at Epoch 4.0, so this runs in plain `bun test`, no node/devnet.

const MANIFEST = resolve(
	import.meta.dir,
	"../../../../../contracts/Clarinet.toml",
);
const CONTRACT = "spv-adapter";

// The SDK owns its Clarity codec; bridge its wire bytes into the @stacks/transactions
// ClarityValue that clarinet-sdk expects (and back, for results). Round-tripping
// through `serializeCV` is the point: it asserts the SDK's serialization is what
// reaches the chain — not a parallel re-encoding.
const toChain = (cv: ClarityValue): StacksCV => Cl.deserialize(serializeCV(cv));
const fromChain = (cv: StacksCV): ClarityValue =>
	deserializeCV(Cl.serialize(cv));

// Compare Clarity values by their wire bytes — codec-agnostic and exact.
const wire = (cv: ClarityValue): string => serializeCV(cv);

const internal = (display: string): Uint8Array =>
	reverseBytes(hexToBytes(display));

// The Bitcoin genesis coinbase: a single output paying 50 BTC. vout 0 decodes to
// the well-known genesis tx hash and a 65-byte P2PK script.
const GENESIS_COINBASE =
	"01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000";
const GENESIS_TXID_DISPLAY =
	"4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";

// Block 170 — the first multi-tx block (Satoshi → Hal Finney). Two txs: a clean
// 1-sibling merkle proof against the real header merkle root. Display order.
const BLOCK_170 = {
	coinbase: "b1fea52486ce0c62bb442b530a3f0132b826c74e473d1f2c220bfa78111c5082",
	spend: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
};

let simnet: Simnet;
let deployer: string;

const callRO = (method: string, args: ClarityValue[]): ClarityValue =>
	fromChain(
		simnet.callReadOnlyFn(CONTRACT, method, args.map(toChain), deployer).result,
	);

beforeAll(async () => {
	simnet = await initSimnet(MANIFEST);
	deployer = simnet.getAccounts().get("deployer") as string;
});

describe("spv-adapter on simnet (Epoch 4.0 built-ins)", () => {
	test("simnet boots at Epoch 4.0", () => {
		expect(simnet.currentEpoch).toBe("4.0");
	});

	test("get-bitcoin-tx-output? decodes the genesis coinbase output", () => {
		const result = callRO("get-tx-output", [
			bufferCV(hexToBytes(GENESIS_COINBASE)),
			uintCV(0),
		]);
		// `decodeTxOutput` is the SDK's own decoder for the built-in's tuple.
		const out = decodeTxOutput(result);
		expect(out.amount).toBe(5_000_000_000n); // 50 BTC in sats
		expect(bytesToHex(reverseBytes(out.txid))).toBe(GENESIS_TXID_DISPLAY);
	});

	test("verify-merkle-proof: SDK-built block-170 proof verifies on-chain", () => {
		const txids = [internal(BLOCK_170.coinbase), internal(BLOCK_170.spend)];
		const root = merkleRoot(txids);

		for (let index = 0; index < txids.length; index++) {
			const proof = buildMerkleProof(txids, index);
			const args = encodeMerkleProofArgs({
				leaf: txids[index] as Uint8Array,
				root,
				proof,
			});
			expect(wire(callRO("verify-merkle", args))).toBe(wire(trueCV()));
		}
	});

	test("verify-merkle-proof: wrong leaf for the proof returns false", () => {
		const txids = [internal(BLOCK_170.coinbase), internal(BLOCK_170.spend)];
		const root = merkleRoot(txids);
		// The spend's proof (index 1, sibling = coinbase) paired with the coinbase
		// leaf — a valid-shaped proof that does not fold to the root.
		const proof = buildMerkleProof(txids, 1);
		const args = encodeMerkleProofArgs({
			leaf: txids[0] as Uint8Array,
			root,
			proof,
		});
		expect(wire(callRO("verify-merkle", args))).toBe(wire(falseCV()));
	});

	test("header-merkle-root extracts bytes [36,68) of an 80-byte header", () => {
		const root = merkleRoot([
			internal(BLOCK_170.coinbase),
			internal(BLOCK_170.spend),
		]);
		const header = new Uint8Array(80);
		header.set(root, 36); // place the root where a real header commits it
		const result = callRO("header-merkle-root", [bufferCV(header)]);
		expect(wire(result)).toBe(wire(someCV(bufferCV(root))));
	});

	test("get-burn-block-info? header-hash is seeded in simnet (some, not none)", () => {
		// `was-tx-mined`'s authenticated branch depends on this. simnet records a
		// header-hash per burn block; the authenticated (ok ...) path still needs a
		// real BTC header (devnet/mainnet), but the lookup itself resolves here.
		const seeded = deserializeCV(
			simnet.runSnippet("(get-burn-block-info? header-hash u0)"),
		);
		expect(seeded.type).toBe("some");
	});

	test("was-tx-mined: a non-canonical header fails authentication (err u1)", () => {
		const txids = [internal(BLOCK_170.coinbase), internal(BLOCK_170.spend)];
		const root = merkleRoot(txids);
		const proof = buildMerkleProof(txids, 0);
		const [leaf, , txIndex, txCount, siblings] = encodeMerkleProofArgs({
			leaf: txids[0] as Uint8Array,
			root,
			proof,
		});
		// 80 zero bytes is a well-formed but non-canonical header → ERR-BAD-HEADER.
		const result = callRO("was-tx-mined", [
			bufferCV(new Uint8Array(80)),
			uintCV(0),
			leaf,
			txIndex,
			txCount,
			siblings,
		]);
		expect(wire(result)).toBe(wire(responseErrorCV(uintCV(1))));
	});
});
