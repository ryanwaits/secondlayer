import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParquetReader } from "@dsnp/parquetjs";
import { getDb, sql } from "@secondlayer/shared/db";
import { exportSbtcEventsRange } from "./exporter.ts";
import { writeSbtcEventsParquet } from "./file.ts";
import type { SbtcEventRow } from "./query.ts";
import { createSbtcEventsSchemaDocument } from "./schema.ts";

describe("sBTC events schema document", () => {
	test("exposes the v0 column contract", () => {
		const doc = createSbtcEventsSchemaDocument("mainnet");
		expect(doc.dataset).toBe("sbtc/events");
		expect(doc.version).toBe("v0");
		expect(doc.schema_version).toBe(0);
		const names = doc.columns.map((c) => c.name);
		expect(names).toContain("cursor");
		expect(names).toContain("topic");
		expect(names).toContain("request_id");
		expect(names).toContain("recipient_btc_hashbytes");
		expect(names).toContain("signer_aggregate_pubkey");
		expect(names).toContain("partition_block_range");
	});
});

describe("writeSbtcEventsParquet", () => {
	let tempDir: string | null = null;

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	});

	test("round-trips deposit + withdrawal-create + key-rotation rows", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "sbtc-events-"));
		const outputPath = join(tempDir, "data.parquet");
		await writeSbtcEventsParquet({
			outputPath,
			rows: [
				fixtureRow({
					cursor: "1:0",
					topic: "completed-deposit",
					amount: "100000",
					bitcoin_txid: "0xabcd",
					output_index: 0,
				}),
				fixtureRow({
					cursor: "1:1",
					topic: "withdrawal-create",
					request_id: 42,
					sender: "SP1",
					amount: "5000",
					recipient_btc_version: 0,
					recipient_btc_hashbytes: `0x${"11".repeat(20)}`,
					max_fee: "1000",
					block_height_at_request: 1,
				}),
				fixtureRow({
					cursor: "1:2",
					topic: "key-rotation",
					signer_aggregate_pubkey: `0x${"ab".repeat(33)}`,
					signer_threshold: 11,
					signer_keys_count: 15,
					signer_address: "SP-SIGNER",
				}),
			],
		});

		const reader = await ParquetReader.openFile(outputPath);
		try {
			expect(Number(reader.getRowCount().toString())).toBe(3);
			const cursor = reader.getCursor();
			const first = (await cursor.next()) as Record<string, unknown>;
			expect(first.cursor).toBe("1:0");
			expect(first.topic).toBe("completed-deposit");
			expect(first.amount).toBe("100000");
			expect(first.request_id ?? null).toBeNull();
			const second = (await cursor.next()) as Record<string, unknown>;
			expect(second.topic).toBe("withdrawal-create");
			expect(Number(second.request_id)).toBe(42);
			expect(second.recipient_btc_hashbytes).toBe(`0x${"11".repeat(20)}`);
			const third = (await cursor.next()) as Record<string, unknown>;
			expect(third.topic).toBe("key-rotation");
			expect(third.signer_threshold).toBe(11);
			expect(third.amount ?? null).toBeNull();
		} finally {
			await reader.close();
		}
	});
});

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("exportSbtcEventsRange", () => {
	const db = HAS_DB ? getDb() : null;
	let tempDir: string | null = null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM sbtc_events`.execute(db);
		tempDir = await mkdtemp(join(tmpdir(), "sbtc-events-export-"));
	});

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	});

	test("filters non-canonical rows and respects block range", async () => {
		if (!db || !tempDir) throw new Error("missing test db");

		await db
			.insertInto("sbtc_events")
			.values([
				{
					cursor: "1:0",
					block_height: 1,
					block_time: new Date("2026-05-07T00:00:00.000Z"),
					tx_id: "tx-deposit",
					tx_index: 0,
					event_index: 0,
					topic: "completed-deposit",
					amount: "100000",
					bitcoin_txid: "0xabcd",
					output_index: 0,
					canonical: true,
					source_cursor: "1:0",
					request_id: null,
					sender: null,
					recipient_btc_version: null,
					recipient_btc_hashbytes: null,
					sweep_txid: null,
					burn_hash: null,
					burn_height: null,
					signer_bitmap: null,
					max_fee: null,
					fee: null,
					block_height_at_request: null,
					governance_contract_type: null,
					governance_new_contract: null,
					signer_aggregate_pubkey: null,
					signer_threshold: null,
					signer_address: null,
					signer_keys_count: null,
				},
				{
					cursor: "2:0",
					block_height: 2,
					block_time: new Date("2026-05-07T00:00:01.000Z"),
					tx_id: "tx-orphaned",
					tx_index: 0,
					event_index: 0,
					topic: "completed-deposit",
					amount: "9",
					canonical: false,
					source_cursor: "2:0",
					request_id: null,
					sender: null,
					recipient_btc_version: null,
					recipient_btc_hashbytes: null,
					bitcoin_txid: null,
					output_index: null,
					sweep_txid: null,
					burn_hash: null,
					burn_height: null,
					signer_bitmap: null,
					max_fee: null,
					fee: null,
					block_height_at_request: null,
					governance_contract_type: null,
					governance_new_contract: null,
					signer_aggregate_pubkey: null,
					signer_threshold: null,
					signer_address: null,
					signer_keys_count: null,
				},
			])
			.execute();

		const result = await exportSbtcEventsRange({
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
		expect(result.manifest.files[0]?.max_cursor).toBe("1:0");
		expect(result.manifest.dataset).toBe("sbtc/events");
		expect(result.manifest.version).toBe("v0");
	});
});

function fixtureRow(overrides: Partial<SbtcEventRow> = {}): SbtcEventRow {
	return {
		cursor: "1:0",
		block_height: 1,
		block_time: "1970-01-01T00:16:40.000Z",
		tx_id: "tx-1",
		tx_index: 0,
		event_index: 0,
		topic: "completed-deposit",
		request_id: null,
		amount: null,
		sender: null,
		recipient_btc_version: null,
		recipient_btc_hashbytes: null,
		bitcoin_txid: null,
		output_index: null,
		sweep_txid: null,
		burn_hash: null,
		burn_height: null,
		signer_bitmap: null,
		max_fee: null,
		fee: null,
		block_height_at_request: null,
		governance_contract_type: null,
		governance_new_contract: null,
		signer_aggregate_pubkey: null,
		signer_threshold: null,
		signer_address: null,
		signer_keys_count: null,
		partition_block_range: "0000000001-0000000001",
		...overrides,
	};
}
