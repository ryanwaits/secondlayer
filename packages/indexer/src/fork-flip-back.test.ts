import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { JournalApplier, receiveNewBlock } from "./catch-up.ts";
import { findSettledFork } from "./fork-choice.ts";
import { ingestNewBlock } from "./ingest.ts";
import { bodyFromText } from "./observer-journal.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_100;

/**
 * The five-fork-point corruption (Apr–Jul 2026), as a test.
 *
 * The node emits a losing contender at height H, a block briefly extends it,
 * and the chain then abandons that branch and keeps building on the block we
 * originally held. Before deposed incumbents were staged for flip-back, the
 * settle was one-way: the original block's payload was overwritten and could
 * never be restored, leaving the fork-point row on the losing branch while
 * every block above it linked through the winner — a canonical chain with a
 * broken parent link at the fork point, invisible until the archive audit.
 */

function payload(
	height: number,
	hash: string,
	parent: string,
): NewBlockPayload {
	return {
		block_hash: hash,
		block_height: height,
		index_block_hash: hash,
		parent_block_hash: parent,
		parent_index_block_hash: parent,
		burn_block_hash: "0xburn",
		burn_block_height: height,
		miner_txid: "0x00",
		timestamp: 1_700_000_000 + height,
		transactions: [],
		events: [],
	};
}

/** Journal network for the catch-up path, so its rows are this suite's alone. */
const JOURNAL_NETWORK = "fork-flip-back-test";

/**
 * Every scenario runs twice: straight through `ingestNewBlock`, and through
 * the catch-up path (journal, early reply, applier behind). Fork handling must
 * not depend on which one delivered the blocks.
 */
type IngestPath = {
	name: string;
	start(): void;
	stop(): Promise<void>;
	ingest(payload: NewBlockPayload): Promise<void>;
	/** Wait until everything delivered so far is applied. */
	settle(): Promise<void>;
};

function directPath(): IngestPath {
	return {
		name: "direct ingest",
		start() {},
		async stop() {},
		async ingest(payload) {
			await ingestNewBlock(payload);
		},
		async settle() {},
	};
}

function catchUpPath(): IngestPath {
	let applier: JournalApplier | null = null;
	return {
		name: "catch-up applier",
		start() {
			applier = new JournalApplier({ network: JOURNAL_NETWORK });
			applier.start();
		},
		async stop() {
			await applier?.stop();
		},
		async ingest(payload) {
			if (!applier) throw new Error("applier not started");
			const outcome = await receiveNewBlock(
				{
					network: JOURNAL_NETWORK,
					applier,
					forcedLive: false,
					// Far behind the node's burn tip: every block is acked early.
					nodeBurnTip: () => payload.burn_block_height + 1_000,
				},
				{
					body: bodyFromText(JSON.stringify(payload)),
					source: "stacks-node",
				},
			);
			if (outcome.mode !== "catch-up") throw new Error("expected catch-up");
		},
		async settle() {
			await applier?.whenIdle();
		},
	};
}

for (const path of HAS_DB ? [directPath(), catchUpPath()] : [directPath()])
	describe.skipIf(!HAS_DB)(`fork flip-back (${path.name})`, () => {
		const db = HAS_DB ? getSourceDb() : null;
		const ingest = (payload: NewBlockPayload) => path.ingest(payload);
		const settle = () => path.settle();

		beforeAll(() => path.start());

		async function cleanRange() {
			if (!db) return;
			await settle();
			await sql`DELETE FROM observer_journal WHERE network = ${JOURNAL_NETWORK}`.execute(
				db,
			);
			await sql`DELETE FROM pending_fork_blocks WHERE height BETWEEN ${H - 1} AND ${H + 3}`.execute(
				db,
			);
			await sql`DELETE FROM chain_reorgs WHERE fork_point_height BETWEEN ${H - 1} AND ${H + 3}`.execute(
				db,
			);
			await sql`DELETE FROM events WHERE block_height BETWEEN ${H - 1} AND ${H + 3}`.execute(
				db,
			);
			await sql`DELETE FROM vm_events WHERE block_height BETWEEN ${H - 1} AND ${H + 3}`.execute(
				db,
			);
			await sql`DELETE FROM vm_events_archive WHERE block_height BETWEEN ${H - 1} AND ${H + 3}`.execute(
				db,
			);
			await sql`DELETE FROM transactions WHERE block_height BETWEEN ${H - 1} AND ${H + 3}`.execute(
				db,
			);
			await sql`DELETE FROM blocks WHERE height BETWEEN ${H - 1} AND ${H + 3}`.execute(
				db,
			);
		}

		beforeEach(cleanRange);
		// This file's blocks sit above the other reorg suites' heights; a canonical
		// row left here would skew their MAX(height)-based orphaned-range assertions.
		afterAll(async () => {
			await cleanRange();
			await path.stop();
		});

		async function canonicalRow(height: number) {
			if (!db) throw new Error("missing db");
			await settle();
			return db
				.selectFrom("blocks")
				.select(["hash", "parent_hash"])
				.where("height", "=", height)
				.where("canonical", "=", true)
				.executeTakeFirst();
		}

		test("settling a fork stages the deposed incumbent as a contender", async () => {
			if (!db) throw new Error("missing db");
			await ingest(payload(H - 1, "0xbase", "0xancestor"));
			await ingest(payload(H, "0xoriginal", "0xbase"));
			await ingest(payload(H, "0xcontender", "0xbase")); // staged
			await ingest(payload(H + 1, "0xchild-of-contender", "0xcontender")); // settles

			expect((await canonicalRow(H))?.hash).toBe("0xcontender");
			// The block we just deposed must be recoverable if the chain flips back.
			// A sibling of the stored child cannot settle that flip on its own (that
			// is a rival at H+1); its descendant does, via the staged row here.
			const deposed = await db
				.selectFrom("pending_fork_blocks")
				.select(["block_hash", "incumbent_hash"])
				.where("height", "=", H)
				.where("block_hash", "=", "0xoriginal")
				.executeTakeFirst();
			expect(deposed?.incumbent_hash).toBe("0xcontender");
			await sql`DELETE FROM blocks WHERE height = ${H + 1}`.execute(db);
			const flipBack = await findSettledFork(db, H + 1, "0xoriginal");
			expect(flipBack?.blockHash).toBe("0xoriginal");
			expect(flipBack?.incumbentHash).toBe("0xcontender");
		});

		test("a settle-then-abandon fork restores the fork point instead of leaving a broken link", async () => {
			if (!db) throw new Error("missing db");
			await ingest(payload(H - 1, "0xbase", "0xancestor"));
			// The chain we originally held.
			await ingest(payload(H, "0xoriginal", "0xbase"));
			// A losing contender arrives and a block briefly extends it — we adopt it.
			await ingest(payload(H, "0xcontender", "0xbase"));
			await ingest(payload(H + 1, "0xchild-of-contender", "0xcontender"));
			// The network abandons the contender's branch and keeps building on the
			// original: first its child (staged against ours), then the block that
			// settles the battle for good.
			await ingest(payload(H + 1, "0xchild-of-original", "0xoriginal"));
			await ingest(payload(H + 2, "0xgrandchild", "0xchild-of-original"));

			// The recursion must have cascaded the flip all the way down: the fork
			// point is back on the original block, and every parent link holds.
			expect((await canonicalRow(H))?.hash).toBe("0xoriginal");
			expect((await canonicalRow(H + 1))?.hash).toBe("0xchild-of-original");
			expect((await canonicalRow(H + 1))?.parent_hash).toBe("0xoriginal");
			expect((await canonicalRow(H + 2))?.parent_hash).toBe(
				"0xchild-of-original",
			);

			// This is the exact shape the five corrupted fork points were left in:
			// a canonical child whose parent link names a block we no longer hold.
			const { rows: brokenLinks } = await sql<{ height: number }>`
			SELECT b.height
			  FROM blocks AS b
			  JOIN blocks AS p ON p.height = b.height - 1 AND p.canonical = true
			 WHERE b.height BETWEEN ${H} AND ${H + 2}
			   AND b.canonical = true
			   AND b.parent_hash <> p.hash
		`.execute(db);
			expect(brokenLinks).toHaveLength(0);

			// Both directions of the battle are in the ledger.
			const reorgs = await db
				.selectFrom("chain_reorgs")
				.select(["old_index_block_hash", "new_index_block_hash"])
				.where("fork_point_height", "=", H)
				.orderBy("created_at", "asc")
				.execute();
			expect(
				reorgs.map((r) => [r.old_index_block_hash, r.new_index_block_hash]),
			).toEqual([
				["0xoriginal", "0xcontender"],
				["0xcontender", "0xoriginal"],
			]);
		});

		test("a losing branch's own child does not depose an incumbent that already has a canonical child", async () => {
			if (!db) throw new Error("missing db");
			await ingest(payload(H - 1, "0xbase", "0xancestor"));
			// The winning chain arrives first and is already two blocks deep.
			await ingest(payload(H, "0xwinner", "0xbase"));
			await ingest(payload(H + 1, "0xwinner-child", "0xwinner"));
			// Then the losing branch: its fork point (staged), and a block built on
			// it. That child names the staged contender as parent, but it is a rival
			// of a block we already hold at H+1, not a verdict on H.
			await ingest(payload(H, "0xloser", "0xbase"));
			await ingest(payload(H + 1, "0xloser-child", "0xloser"));
			await ingest(payload(H + 2, "0xwinner-grandchild", "0xwinner-child"));

			expect((await canonicalRow(H))?.hash).toBe("0xwinner");
			expect((await canonicalRow(H + 1))?.hash).toBe("0xwinner-child");
			expect((await canonicalRow(H + 2))?.parent_hash).toBe("0xwinner-child");

			// Both losers stay staged, so a later flip can still be applied.
			const staged = await db
				.selectFrom("pending_fork_blocks")
				.select(["height", "block_hash"])
				.where("height", ">=", H)
				.where("height", "<=", H + 1)
				.orderBy("height")
				.execute();
			expect(staged.map((r) => [Number(r.height), r.block_hash])).toEqual([
				[H, "0xloser"],
				[H + 1, "0xloser-child"],
			]);
		});

		test("a losing branch that overtakes the incumbent's branch is adopted all the way down", async () => {
			if (!db) throw new Error("missing db");
			await ingest(payload(H - 1, "0xbase", "0xancestor"));
			await ingest(payload(H, "0xfirst", "0xbase"));
			await ingest(payload(H + 1, "0xfirst-child", "0xfirst"));
			await ingest(payload(H, "0xrival", "0xbase"));
			await ingest(payload(H + 1, "0xrival-child", "0xrival"));
			// The rival branch reaches a height the first branch never did: that is
			// the chain's verdict, and it must unwind both heights below it.
			await ingest(payload(H + 2, "0xrival-grandchild", "0xrival-child"));

			expect((await canonicalRow(H))?.hash).toBe("0xrival");
			expect((await canonicalRow(H + 1))?.hash).toBe("0xrival-child");
			expect((await canonicalRow(H + 1))?.parent_hash).toBe("0xrival");
			expect((await canonicalRow(H + 2))?.parent_hash).toBe("0xrival-child");
		});

		test("A → B → A restores original vm_events with original ordinals", async () => {
			if (!db) throw new Error("missing db");

			function withVm(
				height: number,
				hash: string,
				parent: string,
				txId: string,
				mapName: string,
			): NewBlockPayload {
				return {
					...payload(height, hash, parent),
					transactions: [
						{
							txid: txId,
							raw_tx: "0x00",
							status: "success",
							tx_index: 0,
						},
					],
					vm_events: [
						{
							txid: txId,
							committed: true,
							type: "map_set_event",
							map_set_event: {
								contract_identifier: "SP.store",
								map_name: mapName,
								raw_key: "0x0a",
								raw_value: "0x0b",
							},
						},
					],
				};
			}

			await ingest(payload(H - 1, "0xbase", "0xancestor"));
			await ingest(withVm(H, "0xoriginal", "0xbase", "0xtx-orig", "orig-map"));
			await ingest(withVm(H, "0xcontender", "0xbase", "0xtx-cont", "cont-map"));
			await ingest(payload(H + 1, "0xchild-of-contender", "0xcontender"));

			await settle();
			const duringB = await db
				.selectFrom("vm_events")
				.select(["ordinal", "type", "data"])
				.where("block_height", "=", H)
				.execute();
			expect(duringB.map((r) => Number(r.ordinal))).toEqual([0]);
			expect((duringB[0]?.data as { map_name: string }).map_name).toBe(
				"cont-map",
			);

			await ingest(payload(H + 1, "0xchild-of-original", "0xoriginal"));
			await ingest(payload(H + 2, "0xgrandchild", "0xchild-of-original"));

			expect((await canonicalRow(H))?.hash).toBe("0xoriginal");
			const restored = await db
				.selectFrom("vm_events")
				.select(["ordinal", "data"])
				.where("block_height", "=", H)
				.orderBy("ordinal", "asc")
				.execute();
			expect(restored.map((r) => Number(r.ordinal))).toEqual([0]);
			expect((restored[0]?.data as { map_name: string }).map_name).toBe(
				"orig-map",
			);
		});
	});
