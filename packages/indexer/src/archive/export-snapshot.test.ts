import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParquetReader } from "@dsnp/parquetjs";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { exportCanonicalSnapshot } from "./export-snapshot.ts";

const HAS_DB = !!process.env.DATABASE_URL;

/**
 * The exporter audits and exports the WHOLE canonical table set in one
 * snapshot, so these tests own the entire blocks/transactions/events contents
 * of the scratch database. The wipe refuses to run against anything holding
 * more than a token number of rows — a real database can never qualify.
 */
const WIPE_GUARD_MAX_BLOCKS = 100_000;

describe.skipIf(!HAS_DB)("canonical snapshot export", () => {
	const db = HAS_DB ? getSourceDb() : null;
	const outDirs: string[] = [];

	async function wipe() {
		if (!db) throw new Error("missing db");
		const { rows } = await sql<{ count: string | number }>`
			SELECT COUNT(*) AS count FROM blocks
		`.execute(db);
		if (Number(rows[0]?.count ?? 0) > WIPE_GUARD_MAX_BLOCKS) {
			throw new Error(
				"refusing to wipe: blocks table is too large to be a scratch database",
			);
		}
		await sql`DELETE FROM pending_fork_blocks`.execute(db);
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	}

	async function seedChain() {
		if (!db) throw new Error("missing db");
		for (let height = 0; height <= 9; height++) {
			await db
				.insertInto("blocks")
				.values({
					height,
					hash: `0xb${height}`,
					parent_hash: height === 0 ? "0xgenesis-parent" : `0xb${height - 1}`,
					burn_block_height: 100 + height,
					burn_block_hash: "0xburn",
					index_block_hash: height % 2 === 0 ? `0xi${height}` : null,
					timestamp: 1_700_000_000 + height,
					canonical: true,
				})
				.execute();
		}
		const txs = [
			{ tx_id: "0xt2a", block_height: 2, tx_index: 0 },
			{ tx_id: "0xt2b", block_height: 2, tx_index: 1 },
			{ tx_id: "0xt5", block_height: 5, tx_index: 0 },
			{ tx_id: "0xt8", block_height: 8, tx_index: 0 },
		];
		for (const t of txs) {
			await db
				.insertInto("transactions")
				.values({
					...t,
					type: "contract_call",
					sender: "SP1",
					status: "success",
					contract_id: "SP1.c",
					function_name: "f",
					function_args: ["u1"],
					raw_tx: "0x00",
				})
				.execute();
		}
		const events = [
			{ tx_id: "0xt2b", block_height: 2, event_index: 0 },
			{ tx_id: "0xt2b", block_height: 2, event_index: 1 },
			{ tx_id: "0xt5", block_height: 5, event_index: 0 },
		];
		for (const e of events) {
			await db
				.insertInto("events")
				.values({ ...e, type: "contract_event", data: { a: 1 } })
				.execute();
		}
	}

	async function makeOutDir(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "canonical-export-"));
		outDirs.push(dir);
		return dir;
	}

	beforeEach(async () => {
		await wipe();
		await seedChain();
	});

	afterAll(async () => {
		if (db) await wipe();
		await Promise.all(
			outDirs.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("exports a complete chain into partitioned datasets with a truthful manifest", async () => {
		if (!db) throw new Error("missing db");
		const outDir = await makeOutDir();
		const { manifest, snapshotDigest, manifestPath } =
			await exportCanonicalSnapshot({
				network: "testnet",
				outDir,
				toBlock: 9,
				partitionSizeBlocks: 4,
				db,
				generatedAt: "2026-01-01T00:00:00.000Z",
			});

		expect(manifest.coverage).toEqual({ from_block: 0, to_block: 9 });
		expect(manifest.counts).toEqual({ blocks: 10, transactions: 4, events: 3 });
		expect(manifest.audit.continuity.complete).toBe(true);
		expect(manifest.genesis).toEqual({ height: 0, hash: "0xb0" });
		expect(manifest.archive_tip).toEqual({ height: 9, hash: "0xb9" });

		// 3 block partitions + 3 transaction partitions + 2 event partitions;
		// the event-empty tail range is declared, not shipped.
		expect(manifest.partitions).toHaveLength(8);
		expect(manifest.zero_record_ranges).toEqual([
			{ dataset: "events", from_block: 8, to_block: 9 },
		]);

		for (const partition of manifest.partitions) {
			expect(partition.path).toContain(partition.sha256.slice(0, 16));
			const file = Bun.file(join(outDir, partition.path));
			expect(await file.exists()).toBe(true);
			expect(file.size).toBe(partition.byte_size);
		}
		expect(manifestPath).toContain(snapshotDigest);
	});

	test("re-exporting the same snapshot reproduces identical bytes and digests", async () => {
		if (!db) throw new Error("missing db");
		const [dirA, dirB] = [await makeOutDir(), await makeOutDir()];
		const generatedAt = "2026-01-01T00:00:00.000Z";
		const a = await exportCanonicalSnapshot({
			network: "testnet",
			outDir: dirA,
			toBlock: 9,
			partitionSizeBlocks: 4,
			db,
			generatedAt,
		});
		const b = await exportCanonicalSnapshot({
			network: "testnet",
			outDir: dirB,
			toBlock: 9,
			partitionSizeBlocks: 4,
			db,
			generatedAt,
		});
		expect(a.snapshotDigest).toBe(b.snapshotDigest);
		expect(a.manifest.partitions.map((p) => p.sha256)).toEqual(
			b.manifest.partitions.map((p) => p.sha256),
		);
	});

	test("refuses to export when the bounded audit is not complete", async () => {
		if (!db) throw new Error("missing db");
		await sql`DELETE FROM events WHERE block_height = 5`.execute(db);
		await sql`DELETE FROM transactions WHERE block_height = 5`.execute(db);
		await sql`DELETE FROM blocks WHERE height = 5`.execute(db);
		expect(
			exportCanonicalSnapshot({
				network: "testnet",
				outDir: await makeOutDir(),
				toBlock: 9,
				partitionSizeBlocks: 4,
				db,
			}),
		).rejects.toThrow(/refusing to export/);
	});

	test("refuses a bound beyond the canonical tip", async () => {
		if (!db) throw new Error("missing db");
		expect(
			exportCanonicalSnapshot({
				network: "testnet",
				outDir: await makeOutDir(),
				toBlock: 15,
				partitionSizeBlocks: 4,
				db,
			}),
		).rejects.toThrow(/refusing to export/);
	});

	test("partition rows are complete, ordered, and round-trip their payloads", async () => {
		if (!db) throw new Error("missing db");
		const outDir = await makeOutDir();
		const { manifest } = await exportCanonicalSnapshot({
			network: "testnet",
			outDir,
			toBlock: 9,
			partitionSizeBlocks: 4,
			db,
		});

		const eventsPartition = manifest.partitions.find(
			(p) => p.dataset === "events" && p.from_block === 0,
		);
		if (!eventsPartition) throw new Error("missing events partition");
		const reader = await ParquetReader.openFile(
			join(outDir, eventsPartition.path),
		);
		try {
			const cursor = reader.getCursor();
			const rows: Array<Record<string, unknown>> = [];
			for (let row = await cursor.next(); row; row = await cursor.next()) {
				rows.push(row as Record<string, unknown>);
			}
			expect(rows).toHaveLength(2);
			expect(rows.map((r) => Number(r.event_index))).toEqual([0, 1]);
			expect(rows.map((r) => r.tx_id)).toEqual(["0xt2b", "0xt2b"]);
			expect(JSON.parse(String(rows[0]?.data_json))).toEqual({ a: 1 });
		} finally {
			await reader.close();
		}
	});
});
