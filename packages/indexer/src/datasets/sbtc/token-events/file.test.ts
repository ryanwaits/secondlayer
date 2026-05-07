import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParquetReader } from "@dsnp/parquetjs";
import { getDb, sql } from "@secondlayer/shared/db";
import { exportSbtcTokenEventsRange } from "./exporter.ts";
import { writeSbtcTokenEventsParquet } from "./file.ts";
import type { SbtcTokenEventRow } from "./query.ts";
import { createSbtcTokenEventsSchemaDocument } from "./schema.ts";

describe("sBTC token-events schema document", () => {
	test("exposes the v0 column contract", () => {
		const doc = createSbtcTokenEventsSchemaDocument("mainnet");
		expect(doc.dataset).toBe("sbtc/token-events");
		expect(doc.version).toBe("v0");
		expect(doc.schema_version).toBe(0);
		expect(doc.columns.map((c) => c.name)).toEqual([
			"cursor",
			"block_height",
			"block_time",
			"tx_id",
			"tx_index",
			"event_index",
			"event_type",
			"sender",
			"recipient",
			"amount",
			"memo",
			"partition_block_range",
		]);
	});
});

describe("writeSbtcTokenEventsParquet", () => {
	let tempDir: string | null = null;

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	});

	test("round-trips mint, transfer, and burn rows", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "sbtc-token-events-"));
		const outputPath = join(tempDir, "data.parquet");
		await writeSbtcTokenEventsParquet({
			outputPath,
			rows: [
				fixtureRow({
					cursor: "1:0",
					event_type: "mint",
					sender: null,
					recipient: "SP1",
					amount: "100000",
				}),
				fixtureRow({
					cursor: "1:1",
					event_type: "transfer",
					sender: "SP1",
					recipient: "SP2",
					amount: "5000",
					memo: "0xfeed",
				}),
				fixtureRow({
					cursor: "1:2",
					event_type: "burn",
					sender: "SP2",
					recipient: null,
					amount: "1000",
				}),
			],
		});

		const reader = await ParquetReader.openFile(outputPath);
		try {
			expect(Number(reader.getRowCount().toString())).toBe(3);
			const cursor = reader.getCursor();
			const first = (await cursor.next()) as Record<string, unknown>;
			expect(first.event_type).toBe("mint");
			expect(first.sender ?? null).toBeNull();
			const second = (await cursor.next()) as Record<string, unknown>;
			expect(second.event_type).toBe("transfer");
			expect(second.memo).toBe("0xfeed");
			const third = (await cursor.next()) as Record<string, unknown>;
			expect(third.event_type).toBe("burn");
			expect(third.recipient ?? null).toBeNull();
		} finally {
			await reader.close();
		}
	});
});

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("exportSbtcTokenEventsRange", () => {
	const db = HAS_DB ? getDb() : null;
	let tempDir: string | null = null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM sbtc_token_events`.execute(db);
		tempDir = await mkdtemp(join(tmpdir(), "sbtc-token-events-export-"));
	});

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	});

	test("filters non-canonical rows and respects block range", async () => {
		if (!db || !tempDir) throw new Error("missing test db");

		await db
			.insertInto("sbtc_token_events")
			.values([
				{
					cursor: "1:0",
					block_height: 1,
					block_time: new Date("2026-05-07T00:00:00.000Z"),
					tx_id: "tx-mint",
					tx_index: 0,
					event_index: 0,
					event_type: "mint",
					sender: null,
					recipient: "SP1",
					amount: "100000",
					memo: null,
					canonical: true,
					source_cursor: "1:0",
				},
				{
					cursor: "2:0",
					block_height: 2,
					block_time: new Date("2026-05-07T00:00:01.000Z"),
					tx_id: "tx-orphaned",
					tx_index: 0,
					event_index: 0,
					event_type: "transfer",
					sender: "SP1",
					recipient: "SP2",
					amount: "9",
					memo: null,
					canonical: false,
					source_cursor: "2:0",
				},
			])
			.execute();

		const result = await exportSbtcTokenEventsRange({
			range: { fromBlock: 1, toBlock: 2 },
			network: "mainnet",
			prefix: "stacks-datasets/mainnet/v0",
			outputDir: tempDir,
			finalityLagBlocks: 144,
			generatedAt: "2026-05-07T12:34:56.789Z",
			producerVersion: "@secondlayer/indexer@test",
			db,
		});

		expect(result.rowCount).toBe(1);
		expect(result.manifest.files[0]?.row_count).toBe(1);
		expect(result.manifest.files[0]?.min_cursor).toBe("1:0");
		expect(result.manifest.dataset).toBe("sbtc/token-events");
		expect(result.manifest.version).toBe("v0");
	});
});

function fixtureRow(
	overrides: Partial<SbtcTokenEventRow> = {},
): SbtcTokenEventRow {
	return {
		cursor: "1:0",
		block_height: 1,
		block_time: "1970-01-01T00:16:40.000Z",
		tx_id: "tx-1",
		tx_index: 0,
		event_index: 0,
		event_type: "transfer",
		sender: "SP1",
		recipient: "SP2",
		amount: "100",
		memo: null,
		partition_block_range: "0000000001-0000000001",
		...overrides,
	};
}
