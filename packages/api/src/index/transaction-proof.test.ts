import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	parseNakamotoBlockHeader,
	stacksTxid,
	verifyTxMerkleProof,
} from "@secondlayer/shared/node/nakamoto";
import {
	IncompleteBlockTxSetError,
	ProofNodeUnavailableError,
	buildTransactionProof,
	getTransactionProof,
} from "./transaction-proof.ts";

// Verified mainnet fixture (shared) — assemble a real proof and confirm the
// path it produces verifies against the block's own tx_merkle_root.
const fx = JSON.parse(
	readFileSync(
		new URL(
			"../../../shared/src/node/__fixtures__/nakamoto-block.json",
			import.meta.url,
		),
		"utf8",
	),
);
const raw = Uint8Array.from(Buffer.from(fx.rawBlockHex, "hex"));
const header = parseNakamotoBlockHeader(raw);
const rawHeaderHex = Buffer.from(
	raw.subarray(0, header.headerByteLength),
).toString("hex");
const rawTxs = fx.rawTxs as string[];
const txids = rawTxs.map((h) =>
	stacksTxid(Uint8Array.from(Buffer.from(h, "hex"))),
);

describe("buildTransactionProof", () => {
	test("assembles a proof whose merkle path reaches tx_merkle_root", () => {
		const proof = buildTransactionProof({
			txId: txids[0],
			rawTxHex: rawTxs[0],
			txIndex: 0,
			orderedBlockTxids: txids,
			rawHeaderHex,
			indexBlockHash: fx.expect.indexBlockHash,
			blockHeight: fx.expect.chainLength,
		});
		expect(proof.txid).toBe(txids[0]);
		expect(
			verifyTxMerkleProof(txids[0], proof.tx_merkle_path, header.txMerkleRoot),
		).toBe(true);
	});
});

describe("getTransactionProof (gatherer with injected readers)", () => {
	test("wires DB + node pieces into a verifiable proof", async () => {
		const proof = await getTransactionProof({
			txId: txids[1],
			readTx: async () => ({
				block_height: fx.expect.chainLength,
				tx_index: 1,
				raw_tx: rawTxs[1],
				burn_block_height: fx.expect.burnBlockHeight,
			}),
			readBlockTxids: async () => txids,
			node: {
				getBlock: async () => ({ index_block_hash: fx.expect.indexBlockHash }),
				getNakamotoBlock: async () => ({ raw, header }),
				getRewardSet: async () => fx.rewardSet,
			},
		});
		expect(proof).not.toBeNull();
		if (!proof) throw new Error("unreachable");
		expect(proof.tx_index).toBe(1);
		expect(
			verifyTxMerkleProof(txids[1], proof.tx_merkle_path, header.txMerkleRoot),
		).toBe(true);
		// consensus layer attached when the reward set resolves
		expect(proof.consensus?.reward_cycle).toBe(fx.expect.rewardCycle);
		expect(proof.consensus?.reward_set.signers.length).toBeGreaterThan(0);
	});

	test("refuses to emit a proof when the stored tx set is incomplete", async () => {
		await expect(
			getTransactionProof({
				txId: txids[0],
				readTx: async () => ({
					block_height: fx.expect.chainLength,
					tx_index: 0,
					raw_tx: rawTxs[0],
					burn_block_height: fx.expect.burnBlockHeight,
				}),
				readBlockTxids: async () => [txids[0]], // missing the 2nd tx
				node: {
					getBlock: async () => ({
						index_block_hash: fx.expect.indexBlockHash,
					}),
					getNakamotoBlock: async () => ({ raw, header }),
					getRewardSet: async () => fx.rewardSet,
				},
			}),
		).rejects.toBeInstanceOf(IncompleteBlockTxSetError);
	});

	test("surfaces a node-connectivity failure as ProofNodeUnavailableError", async () => {
		await expect(
			getTransactionProof({
				txId: txids[1],
				readTx: async () => ({
					block_height: fx.expect.chainLength,
					tx_index: 1,
					raw_tx: rawTxs[1],
					burn_block_height: fx.expect.burnBlockHeight,
				}),
				readBlockTxids: async () => txids,
				node: {
					getBlock: async () => ({
						index_block_hash: fx.expect.indexBlockHash,
					}),
					getNakamotoBlock: async () => {
						throw new Error("fetch failed: ECONNREFUSED");
					},
					getRewardSet: async () => fx.rewardSet,
				},
			}),
		).rejects.toBeInstanceOf(ProofNodeUnavailableError);
	});

	test("returns null when the tx is unknown", async () => {
		const proof = await getTransactionProof({
			txId: "0xdead",
			readTx: async () => null,
			readBlockTxids: async () => [],
			node: {
				getBlock: async () => null,
				getNakamotoBlock: async () => null,
				getRewardSet: async () => null,
			},
		});
		expect(proof).toBeNull();
	});
});
