import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { txMerkleRoot } from "@secondlayer/shared/node/nakamoto";
import { persistBlock } from "./persist.ts";
import {
	diffHeightAgainstJournal,
	loadCanonicalJournalPayload,
	repairHeightFromJournal,
	verifyHeightAgainstNode,
} from "./repair-from-journal.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
// Below reorg.test.ts's 990050: handleReorg takes MAX(canonical height)
// >= its fork point, so leftover seeds above it would corrupt that test.
const H = 989301;
const NETWORK = "repair-from-journal-test";

function nodePayload(
	hash: string,
	txIds: string[],
	height: number = H,
): NewBlockPayload {
	return {
		block_hash: hash,
		block_height: height,
		index_block_hash: `${hash}-ibh`,
		parent_block_hash: "0xparent",
		parent_index_block_hash: "0xparent-ibh",
		burn_block_hash: "0xburn",
		burn_block_height: 1,
		timestamp: 1_700_000_000,
		miner_txid: "0xminer",
		transactions: txIds.map((txid, i) => ({
			txid,
			raw_tx: "0x00",
			status: "success" as const,
			tx_index: i,
		})),
		events: txIds.map((txid, i) => ({
			txid,
			event_index: i,
			type: "stx_transfer_event" as const,
			stx_transfer_event: { sender: "SP1", recipient: "SP2", amount: "1" },
		})),
	};
}

async function seedJournal(
	db: NonNullable<ReturnType<typeof getDb>>,
	block: NewBlockPayload,
): Promise<void> {
	await db
		.insertInto("observer_journal")
		.values({
			network: NETWORK,
			path: "/new_block",
			source: "test",
			raw_body: Buffer.from(JSON.stringify(block)),
			raw_body_sha256: "test",
			status: "processed",
			semantic_sha256: null,
			block_height: block.block_height,
			block_hash: block.block_hash,
			burn_block_height: block.burn_block_height,
			burn_block_hash: block.burn_block_hash ?? null,
			result: null,
			error: null,
			processed_at: new Date(),
		})
		.execute();
}

/** A minimal raw Nakamoto header (version 0, no signers, empty pox_treatment)
 *  whose `tx_merkle_root` field is exactly the given hex root. Every other
 *  field is zeroed — `verifyHeightAgainstNode`/`checkTxMerkleRoot` reads only
 *  the merkle root out of the parsed header. */
function rawHeaderWithTxMerkleRoot(txMerkleRootHex: string): Uint8Array {
	const HEADER_LEN = 216; // 206 prefix + 4 (signer count=0) + 6 (pox header, 0 bytes data)
	const buf = new Uint8Array(HEADER_LEN);
	const view = new DataView(buf.buffer);
	const root = Buffer.from(
		txMerkleRootHex.startsWith("0x")
			? txMerkleRootHex.slice(2)
			: txMerkleRootHex,
		"hex",
	);
	buf.set(root, 69); // TX_MERKLE_ROOT_OFF
	view.setUint32(206, 0); // signer_signature vector count
	view.setUint16(210, 0); // pox_treatment num_bits
	view.setUint32(212, 0); // pox_treatment data_len
	return buf;
}

function stubFetch(raw: Uint8Array): typeof fetch {
	return (async () =>
		({
			ok: true,
			arrayBuffer: async () => raw.buffer,
		}) as unknown as Response) as unknown as typeof fetch;
}

describe.skipIf(!HAS_DB)("repair-from-journal", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
		await db
			.deleteFrom("index_progress")
			.where("network", "=", NETWORK)
			.execute();
		await db
			.deleteFrom("observer_journal")
			.where("network", "=", NETWORK)
			.execute();
	});
	afterAll(async () => {
		if (!db) return;
		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
		await db
			.deleteFrom("index_progress")
			.where("network", "=", NETWORK)
			.execute();
		await db
			.deleteFrom("observer_journal")
			.where("network", "=", NETWORK)
			.execute();
	});

	test("dry-run reports exactly the txs missing from a height, and changes nothing", async () => {
		if (!db) throw new Error("missing db");
		const payload = nodePayload("0xblockH", [
			"0xrfjtxa",
			"0xrfjtxb",
			"0xrfjtxc",
		]);
		await seedJournal(db, payload);
		await persistBlock(db, {
			block: {
				height: H,
				hash: "0xblockH",
				parent_hash: "0xparent",
				burn_block_height: 1,
				burn_block_hash: null,
				timestamp: 1_700_000_000,
				canonical: true,
			},
			txs: payload.transactions.map((t) => ({
				tx_id: t.txid,
				block_height: H,
				tx_index: t.tx_index,
				type: "contract_call",
				sender: "SP1",
				status: "success",
				raw_tx: "0x00",
			})),
			evts: [],
			blockHeight: H,
			network: NETWORK,
		});

		// Simulate the loss: two of the three txs vanish.
		await db
			.deleteFrom("transactions")
			.where("block_height", "=", H)
			.where("tx_id", "in", ["0xrfjtxa", "0xrfjtxb"])
			.execute();

		const diff = await diffHeightAgainstJournal(db, H);
		expect(diff.status).toBe("diverged");
		expect(diff.journalTxCount).toBe(3);
		expect(diff.dbTxCount).toBe(1);
		expect(diff.missingTxIds.sort()).toEqual(["0xrfjtxa", "0xrfjtxb"]);
		expect(diff.extraTxIds).toEqual([]);

		// Dry-run (diff alone) touches nothing.
		const stillMissing = await db
			.selectFrom("transactions")
			.select("tx_id")
			.where("block_height", "=", H)
			.execute();
		expect(stillMissing.map((r) => r.tx_id)).toEqual(["0xrfjtxc"]);

		// --apply restores them.
		await repairHeightFromJournal(db, H);
		const restored = await db
			.selectFrom("transactions")
			.select("tx_id")
			.where("block_height", "=", H)
			.execute();
		expect(restored.map((r) => r.tx_id).sort()).toEqual([
			"0xrfjtxa",
			"0xrfjtxb",
			"0xrfjtxc",
		]);

		// A re-run reports 0 missing.
		const rerun = await diffHeightAgainstJournal(db, H);
		expect(rerun.status).toBe("match");
		expect(rerun.missingTxIds).toEqual([]);
		expect(rerun.extraTxIds).toEqual([]);
	});

	test("repairing a height with no journal payload throws instead of guessing", async () => {
		if (!db) throw new Error("missing db");
		await persistBlock(db, {
			block: {
				height: H,
				hash: "0xblockNoJournal",
				parent_hash: "0xparent",
				burn_block_height: 1,
				burn_block_hash: null,
				timestamp: 1_700_000_000,
				canonical: true,
			},
			txs: [],
			evts: [],
			blockHeight: H,
			network: NETWORK,
		});
		await expect(repairHeightFromJournal(db, H)).rejects.toThrow(
			/no journal payload/,
		);
		const diff = await diffHeightAgainstJournal(db, H);
		expect(diff.status).toBe("missing_journal");
	});

	test("loadCanonicalJournalPayload returns null for a non-canonical height", async () => {
		if (!db) throw new Error("missing db");
		const missing = await loadCanonicalJournalPayload(db, H);
		expect(missing).toBeNull();
	});

	test("verify-node matches a complete block and mismatches a short one, against a stubbed node", async () => {
		if (!db) throw new Error("missing db");
		const txIds = ["0xrfjtxa", "0xrfjtxb"];
		await persistBlock(db, {
			block: {
				height: H,
				hash: "0xblockH",
				parent_hash: "0xparent",
				burn_block_height: 1,
				burn_block_hash: null,
				index_block_hash: "0xibh",
				timestamp: 1_700_000_000,
				canonical: true,
			},
			txs: txIds.map((id, i) => ({
				tx_id: id,
				block_height: H,
				tx_index: i,
				type: "contract_call",
				sender: "SP1",
				status: "success",
				raw_tx: "0x00",
			})),
			evts: [],
			blockHeight: H,
			network: NETWORK,
		});

		const nodeRoot = txMerkleRoot(txIds);
		const raw = rawHeaderWithTxMerkleRoot(nodeRoot);
		const complete = await verifyHeightAgainstNode(
			db,
			H,
			"http://stub-node",
			stubFetch(raw),
		);
		expect(complete).toEqual({ status: "match" });

		// Now the height is short one tx — the node's header still says both.
		await db
			.deleteFrom("transactions")
			.where("block_height", "=", H)
			.where("tx_id", "=", "0xrfjtxb")
			.execute();
		const short = await verifyHeightAgainstNode(
			db,
			H,
			"http://stub-node",
			stubFetch(raw),
		);
		expect(short).toEqual({ status: "mismatch" });
	});
});
