import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import {
	type CanonicalSnapshotManifest,
	exportCanonicalSnapshot,
} from "./export-snapshot.ts";
import { restoreCanonicalSnapshot } from "./restore-snapshot.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const WIPE_GUARD_MAX_BLOCKS = 100_000;

/**
 * The whole archive loop in one test: seeded chain → export → EMPTY database →
 * restore from the archive files → re-export → the regenerated partitions must
 * carry the archive's own digests. If any stage loses or reorders a row, the
 * digest comparison fails.
 */
describe.skipIf(!HAS_DB)("canonical snapshot restore proof", () => {
	const db = HAS_DB ? getSourceDb() : null;
	const tmpDirs: string[] = [];

	async function wipe() {
		if (!db) throw new Error("missing db");
		const { rows } = await sql<{ count: string | number }>`
			SELECT COUNT(*) AS count FROM blocks
		`.execute(db);
		if (Number(rows[0]?.count ?? 0) > WIPE_GUARD_MAX_BLOCKS) {
			throw new Error("refusing to wipe: not a scratch database");
		}
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
		await db
			.insertInto("transactions")
			.values([
				{
					tx_id: "0xt2a",
					block_height: 2,
					tx_index: 0,
					type: "contract_call",
					sender: "SP1",
					status: "success",
					contract_id: "SP1.c",
					function_name: "f",
					function_args: JSON.stringify(["u1"]),
					raw_tx: "0x00",
				},
				{
					tx_id: "0xt5",
					block_height: 5,
					tx_index: 0,
					type: "token_transfer",
					sender: "SP2",
					status: "success",
					contract_id: null,
					function_name: null,
					function_args: null,
					raw_tx: "0x01",
				},
			])
			.execute();
		await db
			.insertInto("events")
			.values([
				{
					tx_id: "0xt2a",
					block_height: 2,
					event_index: 0,
					type: "contract_event",
					data: { a: 1, nested: { b: "x" } },
				},
				{
					tx_id: "0xt5",
					block_height: 5,
					event_index: 0,
					type: "stx_transfer_event",
					data: { amount: "100" },
				},
			])
			.execute();
	}

	async function makeDir(label: string): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), `restore-${label}-`));
		tmpDirs.push(dir);
		return dir;
	}

	async function exportSeeded(): Promise<{
		dir: string;
		manifest: CanonicalSnapshotManifest;
	}> {
		const dir = await makeDir("archive");
		const { manifest } = await exportCanonicalSnapshot({
			network: "testnet",
			outDir: dir,
			toBlock: 9,
			partitionSizeBlocks: 5,
			db: db ?? undefined,
			generatedAt: "2026-01-01T00:00:00.000Z",
		});
		return { dir, manifest };
	}

	beforeEach(async () => {
		await wipe();
		await seedChain();
	});

	afterAll(async () => {
		if (db) await wipe();
		await Promise.all(
			tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("archive bytes round-trip through an empty database digest-identically", async () => {
		if (!db) throw new Error("missing db");
		const { dir, manifest } = await exportSeeded();

		await wipe(); // the restore target must be empty
		const result = await restoreCanonicalSnapshot({
			dir,
			manifest,
			db,
			range: { fromBlock: 0, toBlock: 9 },
			proofDir: await makeDir("proof"),
		});

		expect(result.restored).toEqual({
			blocks: 10,
			transactions: 2,
			events: 2,
		});
		expect(result.proof.auditComplete).toBe(true);
		expect(result.proof.digestMismatches).toEqual([]);
		expect(result.proof.digestMatches).toBe(result.partitionsRead);
		expect(result.proof.reExportedPartitions).toBe(result.partitionsRead);
	});

	test("COPY encoding survives commas, quotes, and nulls intact", async () => {
		if (!db) throw new Error("missing db");
		// Stress the CSV encoder directly, not just via the digest proof: a
		// contract_id containing CSV-special characters, a JSON payload with
		// embedded quotes/commas/backslashes, and an all-null transaction.
		await db
			.insertInto("transactions")
			.values([
				{
					tx_id: "0xtcsv",
					block_height: 8,
					tx_index: 0,
					type: "contract_call",
					sender: "SP1",
					status: "success",
					contract_id: 'SP1.c,"weird"',
					function_name: "f",
					// jsonb columns must receive the actual value, not a pre-serialized
					// string — postgres.js serializes whatever it's given, so a
					// pre-stringified value gets JSON-encoded a second time. See
					// packages/indexer/src/parser.ts:274 for the production bug this
					// mirrors: 100% of transactions.function_args in prod (14.4M rows)
					// are double-encoded because of exactly this mistake.
					function_args: ['a"b', "c,d", "e\\f"],
					raw_result: null,
					raw_tx: "0x02",
				},
				{
					tx_id: "0xtnull",
					block_height: 8,
					tx_index: 1,
					type: "token_transfer",
					sender: "SP3",
					status: "success",
					contract_id: null,
					function_name: null,
					function_args: null,
					raw_result: null,
					raw_tx: "0x03",
				},
			])
			.execute();
		await db
			.insertInto("events")
			.values({
				tx_id: "0xtcsv",
				block_height: 8,
				event_index: 0,
				type: "contract_event",
				data: { note: 'has "quotes", a comma, and a\nnewline' },
			})
			.execute();

		const { dir, manifest } = await exportSeeded();
		await wipe();
		await restoreCanonicalSnapshot({
			dir,
			manifest,
			db,
			range: { fromBlock: 0, toBlock: 9 },
			proofDir: await makeDir("proof"),
		});

		const csvTx = await db
			.selectFrom("transactions")
			.selectAll()
			.where("tx_id", "=", "0xtcsv")
			.executeTakeFirstOrThrow();
		expect(csvTx.contract_id).toBe('SP1.c,"weird"');
		expect(csvTx.function_args).toEqual(['a"b', "c,d", "e\\f"]);
		expect(csvTx.raw_result).toBeNull();

		const nullTx = await db
			.selectFrom("transactions")
			.selectAll()
			.where("tx_id", "=", "0xtnull")
			.executeTakeFirstOrThrow();
		expect(nullTx.contract_id).toBeNull();
		expect(nullTx.function_name).toBeNull();
		expect(nullTx.function_args).toBeNull();

		const csvEvent = await db
			.selectFrom("events")
			.selectAll()
			.where("tx_id", "=", "0xtcsv")
			.executeTakeFirstOrThrow();
		expect(csvEvent.data).toEqual({
			note: 'has "quotes", a comma, and a\nnewline',
		});
	});

	test("resume completes an interrupted restore and still proves digests", async () => {
		if (!db) throw new Error("missing db");
		const { dir, manifest } = await exportSeeded();

		await wipe();
		await restoreCanonicalSnapshot({
			dir,
			manifest,
			db,
			range: { fromBlock: 0, toBlock: 9 },
			proofDir: await makeDir("proof"),
		});
		// Simulate the interruption: one events partition loses a row (a torn
		// partition), another dataset is already complete.
		await sql`DELETE FROM events WHERE block_height = 2 AND event_index = 0`.execute(
			db,
		);

		const result = await restoreCanonicalSnapshot({
			dir,
			manifest,
			db,
			range: { fromBlock: 0, toBlock: 9 },
			proofDir: await makeDir("proof-resume"),
			resume: true,
		});
		expect(result.restored).toEqual({
			blocks: 10,
			transactions: 2,
			events: 2,
		});
		expect(result.proof.auditComplete).toBe(true);
		expect(result.proof.digestMismatches).toEqual([]);
	});

	test("refuses a non-empty restore target", async () => {
		if (!db) throw new Error("missing db");
		const { dir, manifest } = await exportSeeded();
		// DB still holds the seeded chain — restoring on top must refuse.
		expect(
			restoreCanonicalSnapshot({
				dir,
				manifest,
				db,
				range: { fromBlock: 0, toBlock: 9 },
				proofDir: await makeDir("proof"),
			}),
		).rejects.toThrow(/not empty/);
	});

	test("refuses a tampered archive object before inserting anything", async () => {
		if (!db) throw new Error("missing db");
		const { dir, manifest } = await exportSeeded();
		const blocksPartition = manifest.partitions.find(
			(p) => p.dataset === "blocks",
		);
		if (!blocksPartition) throw new Error("missing blocks partition");
		const path = join(dir, blocksPartition.path);
		const bytes = Buffer.from(await readFile(path));
		bytes[bytes.length - 10] = bytes[bytes.length - 10] === 0 ? 1 : 0;
		await writeFile(path, bytes);

		await wipe();
		expect(
			restoreCanonicalSnapshot({
				dir,
				manifest,
				db,
				range: { fromBlock: 0, toBlock: 9 },
				proofDir: await makeDir("proof"),
			}),
		).rejects.toThrow(/fails verification/);
		const { rows } = await sql<{ count: string | number }>`
			SELECT COUNT(*) AS count FROM blocks
		`.execute(db);
		expect(Number(rows[0]?.count ?? 0)).toBe(0);
	});

	test("refuses a range off the partition grid", async () => {
		if (!db) throw new Error("missing db");
		const { dir, manifest } = await exportSeeded();
		await wipe();
		expect(
			restoreCanonicalSnapshot({
				dir,
				manifest,
				db,
				range: { fromBlock: 3, toBlock: 9 },
				proofDir: await makeDir("proof"),
			}),
		).rejects.toThrow(/partition grid/);
	});
});
