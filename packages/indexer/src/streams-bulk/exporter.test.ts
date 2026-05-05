import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { ParquetReader } from "@dsnp/parquetjs";
import { exportStreamsBulkRange } from "./exporter.ts";
import { readJsonFile, writeStreamsBulkParquet } from "./file.ts";
import { stableJsonStringify } from "./json.ts";
import type { StreamsBulkManifest } from "./manifest.ts";
import {
	manifestTimestampSlug,
	streamsBulkParquetObjectPath,
} from "./paths.ts";
import {
	formatBlockRangeLabel,
	latestCompleteFinalizedRange,
} from "./range.ts";
import type { StreamsBulkEventRow } from "./query.ts";
import {
	STREAMS_BULK_SCHEMA_COLUMNS,
	createStreamsBulkSchemaDocument,
} from "./schema.ts";

describe("Streams bulk dump contract helpers", () => {
	test("selects the latest complete finalized range", () => {
		expect(
			latestCompleteFinalizedRange({
				tipBlockHeight: 185_123,
				rangeSizeBlocks: 10_000,
				finalityLagBlocks: 144,
			}),
		).toEqual({ fromBlock: 170_000, toBlock: 179_999 });

		expect(
			latestCompleteFinalizedRange({
				tipBlockHeight: 10_143,
				rangeSizeBlocks: 10_000,
				finalityLagBlocks: 144,
			}),
		).toEqual({ fromBlock: 0, toBlock: 9_999 });

		expect(
			latestCompleteFinalizedRange({
				tipBlockHeight: 10_142,
				rangeSizeBlocks: 10_000,
				finalityLagBlocks: 144,
			}),
		).toBeNull();
	});

	test("formats stable object paths and manifest slugs", () => {
		expect(formatBlockRangeLabel({ fromBlock: 180_000, toBlock: 189_999 }))
			.toBe("0000180000-0000189999");
		expect(
			streamsBulkParquetObjectPath("stacks-streams/mainnet/v0", {
				fromBlock: 180_000,
				toBlock: 189_999,
			}),
		).toBe(
			"stacks-streams/mainnet/v0/events/block_height/0000180000-0000189999/events.parquet",
		);
		expect(manifestTimestampSlug("2026-05-05T12:34:56.789Z")).toBe(
			"20260505T123456Z",
		);
	});

	test("publishes schema document with required v0 columns", () => {
		const schema = createStreamsBulkSchemaDocument("mainnet");
		expect(schema.schema_version).toBe(0);
		expect(schema.columns.map((column) => column.name)).toEqual(
			STREAMS_BULK_SCHEMA_COLUMNS.map((column) => column.name),
		);
		expect(
			schema.columns.find((column) => column.name === "burn_block_hash")
				?.nullable,
		).toBe(true);
		expect(
			schema.columns.find((column) => column.name === "payload_json")?.type,
		).toBe("string");
	});

	test("serializes payload JSON deterministically", () => {
		expect(
			stableJsonStringify({
				z: 1,
				a: { d: true, c: "value" },
				list: [{ b: 2, a: 1 }],
			}),
		).toBe('{"a":{"c":"value","d":true},"list":[{"a":1,"b":2}],"z":1}');
	});
});

describe("writeStreamsBulkParquet", () => {
	let tempDir: string | null = null;

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	});

	test("writes nullable public Streams columns into parquet", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "streams-bulk-"));
		const outputPath = join(tempDir, "events.parquet");
		await writeStreamsBulkParquet({
			outputPath,
			rows: [
				fixtureBulkRow({
					cursor: "1:0",
					burn_block_hash: null,
					payload_json: '{"amount":"1"}',
				}),
			],
		});

		const reader = await ParquetReader.openFile(outputPath);
		try {
			expect(Number(reader.getRowCount().toString())).toBe(1);
			const cursor = reader.getCursor();
			const row = (await cursor.next()) as Record<string, unknown>;
			expect(row.cursor).toBe("1:0");
			expect(row.burn_block_hash ?? null).toBeNull();
			expect(row.payload_json).toBe('{"amount":"1"}');
		} finally {
			await reader.close();
		}
	});
});

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("exportStreamsBulkRange", () => {
	const db = HAS_DB ? getDb() : null;
	let tempDir: string | null = null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
		tempDir = await mkdtemp(join(tmpdir(), "streams-bulk-export-"));
	});

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	});

	test("exports canonical events with manifest checksum and nullable burn block hash", async () => {
		if (!db || !tempDir) throw new Error("missing test db");

		await db
			.insertInto("blocks")
			.values([
				{
					height: 1,
					hash: "0x01",
					parent_hash: "0x00",
					burn_block_height: 101,
					burn_block_hash: null,
					timestamp: 1_000,
					canonical: true,
				},
				{
					height: 2,
					hash: "0x02",
					parent_hash: "0x01",
					burn_block_height: 102,
					burn_block_hash: "0xburn02",
					timestamp: 1_001,
					canonical: true,
				},
				{
					height: 3,
					hash: "0x03",
					parent_hash: "0x02",
					burn_block_height: 103,
					burn_block_hash: "0xburn03",
					timestamp: 1_002,
					canonical: false,
				},
			])
			.execute();

		await db
			.insertInto("transactions")
			.values([
				tx("tx-1", 1, 1),
				tx("tx-0", 1, 0),
				tx("tx-2", 2, 0),
				tx("tx-orphaned", 3, 0),
			])
			.execute();

		await db
			.insertInto("events")
			.values([
				{
					tx_id: "tx-1",
					block_height: 1,
					event_index: 0,
					type: "ft_transfer_event",
					data: {
						amount: "7",
						asset_identifier: "SP1.token::coin",
						recipient: "SP2",
						sender: "SP1",
					},
				},
				{
					tx_id: "tx-0",
					block_height: 1,
					event_index: 0,
					type: "stx_mint_event",
					data: { amount: "10", recipient: "SP0" },
				},
				{
					tx_id: "tx-2",
					block_height: 2,
					event_index: 0,
					type: "smart_contract_event",
					data: {
						contract_identifier: "SP3.print",
						topic: "print",
						value: { repr: "u3" },
					},
				},
				{
					tx_id: "tx-orphaned",
					block_height: 3,
					event_index: 0,
					type: "stx_transfer_event",
					data: { amount: "1", recipient: "SP2", sender: "SP1" },
				},
			])
			.execute();

		const result = await exportStreamsBulkRange({
			range: { fromBlock: 1, toBlock: 2 },
			network: "mainnet",
			prefix: "stacks-streams/mainnet/v0",
			outputDir: tempDir,
			finalityLagBlocks: 144,
			generatedAt: "2026-05-05T12:34:56.789Z",
			producerVersion: "@secondlayer/indexer@test",
			db,
		});

		expect(result.rowCount).toBe(3);
		expect(result.manifest.latest_finalized_cursor).toBe("2:0");
		expect(result.manifest.files[0]?.min_cursor).toBe("1:0");
		expect(result.manifest.files[0]?.max_cursor).toBe("2:0");

		const manifest = await readJsonFile<StreamsBulkManifest>(
			result.localLatestManifestPath,
		);
		expect(manifest.files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);

		const reader = await ParquetReader.openFile(result.localParquetPath);
		try {
			expect(Number(reader.getRowCount().toString())).toBe(3);
			const cursor = reader.getCursor();
			const rows: Record<string, unknown>[] = [];
			for (;;) {
				const row = (await cursor.next()) as Record<string, unknown> | null;
				if (!row) break;
				rows.push(row);
			}
			expect(rows.map((row) => row.cursor)).toEqual(["1:0", "1:1", "2:0"]);
			expect(rows[0]?.burn_block_hash ?? null).toBeNull();
			expect(rows[1]?.event_type).toBe("ft_transfer");
			expect(rows[1]?.contract_id).toBe("SP1.token");
			expect(rows[2]?.payload_json).toBe(
				'{"contract_id":"SP3.print","topic":"print","value":{"repr":"u3"}}',
			);
		} finally {
			await reader.close();
		}
	});
});

function fixtureBulkRow(
	overrides: Partial<StreamsBulkEventRow> = {},
): StreamsBulkEventRow {
	return {
		cursor: "1:0",
		block_height: 1,
		index_block_hash: "0x01",
		burn_block_height: 101,
		burn_block_hash: "0xburn01",
		tx_id: "tx-1",
		tx_index: 0,
		event_index: 0,
		event_type: "stx_transfer",
		contract_id: null,
		ts: "1970-01-01T00:16:40.000Z",
		payload_json: "{}",
		partition_block_range: "0000000001-0000000001",
		...overrides,
	};
}

function tx(txId: string, blockHeight: number, txIndex: number) {
	return {
		tx_id: txId,
		block_height: blockHeight,
		tx_index: txIndex,
		type: "token_transfer",
		sender: "SP1",
		status: "success",
		contract_id: null,
		raw_tx: "0x01",
	};
}
