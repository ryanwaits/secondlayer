import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateEd25519KeyPair } from "@secondlayer/shared/crypto/ed25519";
import { getDb } from "@secondlayer/shared/db";
import postgres from "postgres";
import { exportJournalRange } from "./journal-cold.ts";
import { sha256Hex } from "./observer-journal.ts";
import { persistBlock } from "./persist.ts";
import { applyForkRepair, planForkRepair } from "./repair-fork-block.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
// Below reorg.test.ts's 990050 and clear of repair-from-journal.test.ts.
const H = 989321;
const LOW = 40_001;
const NETWORK = "repair-fork-block-test";
const SCRIPT = new URL("./repair-fork-block.ts", import.meta.url).pathname;

const WRONG_TX =
	"0xd0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0";
const CANON_TXS = [
	"0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0",
	"0xc1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1",
];
const CHILD_TX =
	"0xe0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0";

function nodePayload(
	hash: string,
	height: number,
	parentHash: string,
	txIds: string[],
): NewBlockPayload {
	return {
		block_hash: hash,
		block_height: height,
		index_block_hash: `${hash}-ibh`,
		parent_block_hash: parentHash,
		parent_index_block_hash: `${parentHash}-ibh`,
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

/** H holds the losing contender with Hiro-shaped rows (contract fields and
 *  raw_result null); H+1 names a different block as its parent. */
async function seedFork(db: NonNullable<ReturnType<typeof getDb>>) {
	await persistBlock(db, {
		block: {
			height: H,
			hash: "0xwrong",
			parent_hash: "0xparent",
			burn_block_height: 1,
			burn_block_hash: null,
			index_block_hash: "0xwrong-ibh",
			timestamp: 1_700_000_000,
			canonical: true,
		},
		txs: [
			{
				tx_id: WRONG_TX,
				block_height: H,
				tx_index: 0,
				type: "contract_call",
				sender: "SP1",
				status: "success",
				raw_tx: "0x00",
			},
		],
		evts: [],
		blockHeight: H,
		network: NETWORK,
	});
	await persistBlock(db, {
		block: {
			height: H + 1,
			hash: "0xchild",
			parent_hash: "0xcanon",
			burn_block_height: 1,
			burn_block_hash: null,
			timestamp: 1_700_000_001,
			canonical: true,
		},
		txs: [
			{
				tx_id: CHILD_TX,
				block_height: H + 1,
				tx_index: 0,
				type: "token_transfer",
				sender: "SP1",
				status: "success",
				raw_tx: "0x00",
			},
		],
		evts: [],
		blockHeight: H + 1,
		network: NETWORK,
	});
}

async function cleanup(db: NonNullable<ReturnType<typeof getDb>>) {
	for (const height of [H, H + 1, LOW, LOW + 1]) {
		await db.deleteFrom("events").where("block_height", "=", height).execute();
		await db
			.deleteFrom("transactions")
			.where("block_height", "=", height)
			.execute();
		await db.deleteFrom("blocks").where("height", "=", height).execute();
		await db
			.deleteFrom("events_archive")
			.where("block_height", "=", height)
			.execute();
		await db
			.deleteFrom("transactions_archive")
			.where("block_height", "=", height)
			.execute();
	}
	await db
		.deleteFrom("chain_reorgs")
		.where("fork_point_height", "=", H)
		.execute();
	await db
		.deleteFrom("index_progress")
		.where("network", "=", NETWORK)
		.execute();
	await db
		.deleteFrom("observer_journal")
		.where("network", "=", NETWORK)
		.execute();
}

describe.skipIf(!HAS_DB)("repair-fork-block", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (db) await cleanup(db);
	});
	afterAll(async () => {
		if (db) await cleanup(db);
	});

	test("replaces a wrong fork block with the journaled contender its child names, as node-shaped rows", async () => {
		if (!db) throw new Error("missing db");
		await seedFork(db);
		await seedJournal(db, nodePayload("0xwrong", H, "0xparent", [WRONG_TX]));
		const canonical = nodePayload("0xcanon", H, "0xparent", CANON_TXS);
		await seedJournal(db, canonical);

		const plan = await planForkRepair(db, H);
		expect(plan.stored.hash).toBe("0xwrong");
		expect(plan.canonicalHash).toBe("0xcanon");
		expect(plan.alreadyCorrect).toBe(false);

		await applyForkRepair(db, plan);

		const block = await db
			.selectFrom("blocks")
			.select(["hash", "canonical", "index_block_hash", "tx_count"])
			.where("height", "=", H)
			.executeTakeFirstOrThrow();
		expect(block.hash).toBe("0xcanon");
		expect(block.canonical).toBe(true);
		expect(block.index_block_hash).toBe(canonical.index_block_hash);
		expect(Number(block.tx_count)).toBe(CANON_TXS.length);

		const txs = await db
			.selectFrom("transactions")
			.select(["tx_id", "tx_index"])
			.where("block_height", "=", H)
			.orderBy("tx_index")
			.execute();
		expect(txs.map((t) => t.tx_id)).toEqual(CANON_TXS);

		// Events carry the node's own indexes, aligned to their txs.
		const events = await db
			.selectFrom("events")
			.select(["tx_id", "event_index", "type"])
			.where("block_height", "=", H)
			.orderBy("event_index")
			.execute();
		expect(events.map((e) => [e.tx_id, Number(e.event_index), e.type])).toEqual(
			CANON_TXS.map((id, i) => [id, i, "stx_transfer_event"]),
		);

		// The losing block's rows are archived as an orphan, not destroyed.
		const archived = await db
			.selectFrom("transactions_archive")
			.select(["tx_id", "orphaned_block_hash"])
			.where("block_height", "=", H)
			.execute();
		expect(archived).toEqual([
			{ tx_id: WRONG_TX, orphaned_block_hash: "0xwrong" },
		]);

		// H+1 is untouched and now links.
		const child = await db
			.selectFrom("blocks")
			.select(["hash", "parent_hash"])
			.where("height", "=", H + 1)
			.executeTakeFirstOrThrow();
		expect(child).toEqual({ hash: "0xchild", parent_hash: "0xcanon" });

		const rerun = await planForkRepair(db, H);
		expect(rerun.alreadyCorrect).toBe(true);
	});

	test("a repair runs the reorg cascade: subgraph_reorg notify and a chain_reorgs row", async () => {
		if (!db || !process.env.DATABASE_URL) throw new Error("missing db");
		await seedFork(db);
		await seedJournal(db, nodePayload("0xwrong", H, "0xparent", [WRONG_TX]));
		await seedJournal(db, nodePayload("0xcanon", H, "0xparent", CANON_TXS));
		const plan = await planForkRepair(db, H);

		const listener = postgres(process.env.DATABASE_URL, { max: 1 });
		const notified: Array<{
			blockHeight: number;
			oldHash: string;
			newHash: string;
		}> = [];
		await listener.listen("subgraph_reorg", (payload) => {
			const parsed = JSON.parse(payload);
			if (parsed.blockHeight === H) notified.push(parsed);
		});
		try {
			await applyForkRepair(db, plan);
			const deadline = Date.now() + 3_000;
			while (notified.length === 0 && Date.now() < deadline)
				await Bun.sleep(20);
		} finally {
			await listener.end();
		}

		expect(notified).toEqual([
			{ blockHeight: H, oldHash: "0xwrong", newHash: "0xcanon" },
		]);
		const reorgs = await db
			.selectFrom("chain_reorgs")
			.select(["old_index_block_hash", "new_index_block_hash"])
			.where("fork_point_height", "=", H)
			.execute();
		// Index hashes, not the block hashes the cascade is keyed by.
		expect(reorgs).toEqual([
			{
				old_index_block_hash: "0xwrong-ibh",
				new_index_block_hash: "0xcanon-ibh",
			},
		]);
		// The chain above the repaired height stays canonical.
		const child = await db
			.selectFrom("blocks")
			.select("canonical")
			.where("height", "=", H + 1)
			.executeTakeFirstOrThrow();
		expect(child.canonical).toBe(true);
	});

	test("with no journal row for the canonical block, --apply exits non-zero and writes nothing", async () => {
		if (!db) throw new Error("missing db");
		await seedFork(db);
		// Only the losing contender was journaled.
		await seedJournal(db, nodePayload("0xwrong", H, "0xparent", [WRONG_TX]));

		const proc = Bun.spawn(
			["bun", "run", SCRIPT, "--height", String(H), "--apply"],
			{ stdout: "pipe", stderr: "pipe", env: process.env },
		);
		const exitCode = await proc.exited;
		const stderr = await new Response(proc.stderr).text();
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain(`at ${H}`);
		expect(stderr).toContain("only an archive/feeder rebuild can fix");

		const block = await db
			.selectFrom("blocks")
			.select("hash")
			.where("height", "=", H)
			.executeTakeFirstOrThrow();
		expect(block.hash).toBe("0xwrong");
		const txs = await db
			.selectFrom("transactions")
			.select("tx_id")
			.where("block_height", "=", H)
			.execute();
		expect(txs.map((t) => t.tx_id)).toEqual([WRONG_TX]);
		const archived = await db
			.selectFrom("transactions_archive")
			.select("tx_id")
			.where("block_height", "=", H)
			.execute();
		expect(archived).toEqual([]);
	});
	describe("heights moved to cold files", () => {
		const coldNetwork = process.env.STACKS_NETWORK ?? "mainnet";
		let dir = "";

		beforeEach(async () => {
			dir = await mkdtemp(join(tmpdir(), "fork-block-cold-"));
		});
		afterEach(async () => {
			await rm(dir, { recursive: true, force: true });
			if (!db) return;
			await db
				.deleteFrom("observer_journal")
				.where("network", "=", coldNetwork)
				.where("block_height", "=", LOW)
				.execute();
		});

		async function seedColdFork(
			db: NonNullable<ReturnType<typeof getDb>>,
		): Promise<NewBlockPayload> {
			await persistBlock(db, {
				block: {
					height: H,
					hash: "0xanchor",
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
			await persistBlock(db, {
				block: {
					height: LOW,
					hash: "0xwrong",
					parent_hash: "0xparent",
					burn_block_height: 1,
					burn_block_hash: null,
					timestamp: 1_700_000_000,
					canonical: true,
				},
				txs: [],
				evts: [],
				blockHeight: LOW,
				network: NETWORK,
			});
			await persistBlock(db, {
				block: {
					height: LOW + 1,
					hash: "0xchild",
					parent_hash: "0xcanon",
					burn_block_height: 1,
					burn_block_hash: null,
					timestamp: 1_700_000_001,
					canonical: true,
				},
				txs: [],
				evts: [],
				blockHeight: LOW + 1,
				network: NETWORK,
			});
			const payload = nodePayload("0xcanon", LOW, "0xparent", CANON_TXS);
			const body = Buffer.from(JSON.stringify(payload));
			await db
				.insertInto("observer_journal")
				.values({
					network: coldNetwork,
					path: "/new_block",
					source: "test",
					raw_body: body,
					raw_body_sha256: sha256Hex(body),
					status: "processed",
					semantic_sha256: null,
					block_height: LOW,
					block_hash: "0xcanon",
					burn_block_height: 1,
					burn_block_hash: null,
					result: null,
					error: null,
					processed_at: new Date(),
				})
				.execute();
			await exportJournalRange({
				db,
				network: coldNetwork,
				kind: "new_block",
				from: 0,
				to: 49_999,
				outDir: dir,
				hotWindowHeights: 100,
				signingPrivateKeyPem: generateEd25519KeyPair().privateKeyPem,
			});
			await db
				.deleteFrom("observer_journal")
				.where("network", "=", coldNetwork)
				.where("block_height", "=", LOW)
				.execute();
			return payload;
		}

		test("plans the repair from the local cold file when the journal row is gone", async () => {
			if (!db) throw new Error("missing db");
			await seedColdFork(db);
			await db
				.insertInto("observer_journal_cold_ranges")
				.values({
					network: coldNetwork,
					kind: "new_block",
					from_height: 0,
					to_height: 49_999,
					rows: 1,
					min_sequence: 1,
					max_sequence: 1,
					object_key: "unused",
					file_sha256: "unused",
					manifest_key: "unused",
					verified_at: null,
				})
				.execute();
			try {
				const plan = await planForkRepair(db, LOW, {
					network: coldNetwork,
					coldDir: dir,
				});
				expect(plan.canonicalHash).toBe("0xcanon");
				expect(plan.payload.transactions).toHaveLength(CANON_TXS.length);
				expect(plan.alreadyCorrect).toBe(false);
			} finally {
				await db
					.deleteFrom("observer_journal_cold_ranges")
					.where("network", "=", coldNetwork)
					.execute();
			}
		});

		test("without a hot row or a ledger range the plan is refused", async () => {
			if (!db) throw new Error("missing db");
			await seedColdFork(db);
			await expect(
				planForkRepair(db, LOW, { network: coldNetwork, coldDir: dir }),
			).rejects.toThrow(/only an archive\/feeder rebuild can fix/);
		});
	});
});
