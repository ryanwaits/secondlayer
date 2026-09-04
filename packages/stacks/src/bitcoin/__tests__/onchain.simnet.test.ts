import { beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Simnet, initSimnet } from "@stacks/clarinet-sdk";
import {
	ContractResponseError,
	getContract,
} from "../../actions/getContract.ts";
import type { AbiContract } from "../../clarity/abi/contract.ts";
import { deserializeCV } from "../../clarity/index.ts";
import { createPublicClient } from "../../clients/createPublicClient.ts";
import { simnet, simnetChain } from "../../simnet/index.ts";
import { bytesToHex, hexToBytes } from "../../utils/encoding.ts";
import { SPV_ADAPTER_ABI } from "../abi/spvAdapter.ts";
import { buildMerkleProof, merkleRoot, reverseBytes } from "../index.ts";

const MANIFEST = resolve(
	import.meta.dir,
	"../../../../../contracts/Clarinet.toml",
);

const internal = (display: string): Uint8Array =>
	reverseBytes(hexToBytes(display));

const GENESIS_COINBASE =
	"01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000";
const GENESIS_TXID_DISPLAY =
	"4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";

const BLOCK_170 = {
	coinbase: "b1fea52486ce0c62bb442b530a3f0132b826c74e473d1f2c220bfa78111c5082",
	spend: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
};

type Adapter = {
	read: {
		getTxOutput: (a: {
			tx: Uint8Array;
			vout: bigint;
		}) => Promise<{ amount: bigint; txid: Uint8Array; script: Uint8Array }>;
		verifyMerkle: (a: {
			leaf: Uint8Array;
			root: Uint8Array;
			txIndex: bigint;
			txCount: bigint;
			siblings: Uint8Array[];
		}) => Promise<boolean>;
		headerMerkleRoot: (a: { header: Uint8Array }) => Promise<Uint8Array | null>;
		wasTxMined: (a: {
			header: Uint8Array;
			height: bigint;
			leaf: Uint8Array;
			txIndex: bigint;
			txCount: bigint;
			siblings: Uint8Array[];
		}) => Promise<boolean>;
	};
};

let session: Simnet;
let adapter: Adapter;

beforeAll(async () => {
	session = await initSimnet(MANIFEST);
	const deployer = session.getAccounts().get("deployer") as string;
	const client = createPublicClient({
		chain: simnetChain,
		transport: simnet(session),
	});
	adapter = getContract({
		client,
		address: deployer,
		name: "spv-adapter",
		abi: SPV_ADAPTER_ABI as AbiContract,
	}) as unknown as Adapter;
});

describe("spv-adapter on simnet (Epoch 4.0 built-ins)", () => {
	test("simnet boots at Epoch 4.0", () => {
		expect(session.currentEpoch).toBe("4.0");
	});

	test("get-bitcoin-tx-output? decodes the genesis coinbase output", async () => {
		const out = await adapter.read.getTxOutput({
			tx: hexToBytes(GENESIS_COINBASE),
			vout: 0n,
		});
		expect(out.amount).toBe(5_000_000_000n);
		expect(bytesToHex(reverseBytes(out.txid))).toBe(GENESIS_TXID_DISPLAY);
	});

	test("verify-merkle-proof: SDK-built block-170 proof verifies on-chain", async () => {
		const txids = [internal(BLOCK_170.coinbase), internal(BLOCK_170.spend)];
		const root = merkleRoot(txids);

		for (let index = 0; index < txids.length; index++) {
			const proof = buildMerkleProof(txids, index);
			const leaf = txids[index] as Uint8Array;
			expect(
				await adapter.read.verifyMerkle({
					leaf,
					root,
					txIndex: BigInt(proof.txIndex),
					txCount: BigInt(proof.txCount),
					siblings: proof.siblings,
				}),
			).toBe(true);
		}
	});

	test("verify-merkle-proof: wrong leaf for the proof returns false", async () => {
		const txids = [internal(BLOCK_170.coinbase), internal(BLOCK_170.spend)];
		const root = merkleRoot(txids);
		const proof = buildMerkleProof(txids, 1);
		expect(
			await adapter.read.verifyMerkle({
				leaf: txids[0] as Uint8Array,
				root,
				txIndex: BigInt(proof.txIndex),
				txCount: BigInt(proof.txCount),
				siblings: proof.siblings,
			}),
		).toBe(false);
	});

	test("header-merkle-root extracts bytes [36,68) of an 80-byte header", async () => {
		const root = merkleRoot([
			internal(BLOCK_170.coinbase),
			internal(BLOCK_170.spend),
		]);
		const header = new Uint8Array(80);
		header.set(root, 36);
		const result = await adapter.read.headerMerkleRoot({ header });
		expect(result).not.toBeNull();
		expect(bytesToHex(result as Uint8Array)).toBe(bytesToHex(root));
	});

	test("get-burn-block-info? header-hash is seeded in simnet (some, not none)", () => {
		const seeded = deserializeCV(
			session.runSnippet("(get-burn-block-info? header-hash u0)"),
		);
		expect(seeded.type).toBe("some");
	});

	test("was-tx-mined: a non-canonical header fails authentication (err u1)", async () => {
		const txids = [internal(BLOCK_170.coinbase), internal(BLOCK_170.spend)];
		const proof = buildMerkleProof(txids, 0);
		try {
			await adapter.read.wasTxMined({
				header: new Uint8Array(80),
				height: 0n,
				leaf: txids[0] as Uint8Array,
				txIndex: BigInt(proof.txIndex),
				txCount: BigInt(proof.txCount),
				siblings: proof.siblings,
			});
			expect.unreachable("was-tx-mined should err");
		} catch (error) {
			expect(error).toBeInstanceOf(ContractResponseError);
			expect((error as ContractResponseError).errorValue).toBe(1n);
		}
	});
});
