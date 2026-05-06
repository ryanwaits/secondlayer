import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ParquetReader } from "@dsnp/parquetjs";
import { getDb, sql } from "@secondlayer/shared/db";
import { exportStxTransfersRange } from "./exporter.ts";
import { writeStxTransfersParquet } from "./file.ts";
import type { StxTransferRow } from "./query.ts";
import { createStxTransfersSchemaDocument } from "./schema.ts";

describe("STX transfers schema document", () => {
	test("exposes the v0 column contract", () => {
		const doc = createStxTransfersSchemaDocument("mainnet");
		expect(doc.dataset).toBe("stx-transfers");
		expect(doc.version).toBe("v0");
		expect(doc.schema_version).toBe(0);
		expect(doc.columns.map((c) => c.name)).toEqual([
			"cursor",
			"block_height",
			"block_time",
			"tx_id",
			"tx_index",
			"event_index",
			"sender",
			"recipient",
			"amount",
			"memo",
			"partition_block_range",
		]);
	});
});

describe("writeStxTransfersParquet", () => {
	let tempDir: string | null = null;

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	});

	test("round-trips rows with nullable memo", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "stx-transfers-"));
		const outputPath = join(tempDir, "data.parquet");
		await writeStxTransfersParquet({
			outputPath,
			rows: [
				fixtureRow({ cursor: "1:0", memo: null }),
				fixtureRow({
					cursor: "1:1",
					memo: "0xdeadbeef",
					sender: "SP1",
					recipient: "SP2",
				}),
			],
		});

		const reader = await ParquetReader.openFile(outputPath);
		try {
			expect(Number(reader.getRowCount().toString())).toBe(2);
			const cursor = reader.getCursor();
			const first = (await cursor.next()) as Record<string, unknown>;
			expect(first.cursor).toBe("1:0");
			expect(first.memo ?? null).toBeNull();
			const second = (await cursor.next()) as Record<string, unknown>;
			expect(second.memo).toBe("0xdeadbeef");
		} finally {
			await reader.close();
		}
	});
});

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("exportStxTransfersRange", () => {
	const db = HAS_DB ? getDb() : null;
	let tempDir: string | null = null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
		tempDir = await mkdtemp(join(tmpdir(), "stx-transfers-export-"));
	});

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	});

	test("filters out non-stx events and orphaned blocks", async () => {
		if (!db || !tempDir) throw new Error("missing test db");

		await db
			.insertInto("blocks")
			.values([
				{
					height: 1,
					hash: "0x01",
					parent_hash: "0x00",
					burn_block_height: 101,
					timestamp: 1_000,
					canonical: true,
				},
				{
					height: 2,
					hash: "0x02",
					parent_hash: "0x01",
					burn_block_height: 102,
					timestamp: 1_001,
					canonical: false,
				},
			])
			.execute();

		await db
			.insertInto("transactions")
			.values([
				tx("tx-stx", 1, 0),
				tx("tx-ft", 1, 1),
				tx("tx-orphaned", 2, 0),
			])
			.execute();

		await db
			.insertInto("events")
			.values([
				{
					tx_id: "tx-stx",
					block_height: 1,
					event_index: 0,
					type: "stx_transfer_event",
					data: {
						amount: "100",
						recipient: "SP2",
						sender: "SP1",
						memo: "0xfeed",
					},
				},
				{
					tx_id: "tx-ft",
					block_height: 1,
					event_index: 0,
					type: "ft_transfer_event",
					data: {
						amount: "1",
						asset_identifier: "SP3.token::coin",
						recipient: "SP2",
						sender: "SP1",
					},
				},
				{
					tx_id: "tx-orphaned",
					block_height: 2,
					event_index: 0,
					type: "stx_transfer_event",
					data: { amount: "9", recipient: "SP2", sender: "SP1" },
				},
			])
			.execute();

		const result = await exportStxTransfersRange({
			range: { fromBlock: 1, toBlock: 2 },
			network: "mainnet",
			prefix: "stacks-datasets/mainnet/v0",
			outputDir: tempDir,
			finalityLagBlocks: 144,
			generatedAt: "2026-05-05T12:34:56.789Z",
			producerVersion: "@secondlayer/indexer@test",
			db,
		});

		expect(result.rowCount).toBe(1);
		expect(result.manifest.files[0]?.row_count).toBe(1);
		expect(result.manifest.files[0]?.min_cursor).toBe("1:0");
		expect(result.manifest.files[0]?.max_cursor).toBe("1:0");
		expect(result.manifest.dataset).toBe("stx-transfers");
		expect(result.manifest.version).toBe("v0");
	});
});

function tx(txId: string, blockHeight: number, txIndex: number) {
	return {
		tx_id: txId,
		block_height: blockHeight,
		tx_index: txIndex,
		type: "token_transfer",
		sender: "SP1",
		status: "success",
		contract_id: null,
		function_name: null,
		raw_tx: "0x",
	};
}

function fixtureRow(overrides: Partial<StxTransferRow> = {}): StxTransferRow {
	return {
		cursor: "1:0",
		block_height: 1,
		block_time: "1970-01-01T00:16:40.000Z",
		tx_id: "tx-1",
		tx_index: 0,
		event_index: 0,
		sender: "SP1",
		recipient: "SP2",
		amount: "100",
		memo: null,
		partition_block_range: "0000000001-0000000001",
		...overrides,
	};
}
