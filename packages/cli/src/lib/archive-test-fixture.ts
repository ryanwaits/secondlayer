import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import type {
	RangeDigest,
	RangeDigestDataset,
} from "@secondlayer/shared/archive/range-digest";
import { computeRangeDigest } from "@secondlayer/shared/archive/range-digest";
import type { getDb } from "@secondlayer/shared/db";
import { sql } from "@secondlayer/shared/db";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";

/**
 * A tiny signed archive on disk plus the rows it was cut from, for the
 * database-gated bootstrap and repair suites. One block, one transaction, and
 * one event per height; partition boundaries are shared across datasets the
 * way the publisher cuts them.
 */

export type FixtureBlock = {
	height: number;
	hash: string;
	parent_hash: string;
	burn_block_height: number;
	burn_block_hash: string | null;
	index_block_hash: string | null;
	timestamp: number;
};

export type FixtureTx = {
	tx_id: string;
	block_height: number;
	tx_index: number;
	type: string;
	sender: string;
	status: string;
	contract_id: string | null;
	function_name: string | null;
	function_args_json: string | null;
	raw_result: string | null;
	raw_tx: string;
};

export type FixtureEvent = {
	tx_id: string;
	block_height: number;
	event_index: number;
	event_type: string;
	data_json: string;
};

export type FixtureChain = {
	blocks: FixtureBlock[];
	transactions: FixtureTx[];
	events: FixtureEvent[];
};

export function fixtureChain(
	fromHeight: number,
	toHeight: number,
): FixtureChain {
	const chain: FixtureChain = { blocks: [], transactions: [], events: [] };
	for (let h = fromHeight; h <= toHeight; h++) {
		chain.blocks.push({
			height: h,
			hash: `hash-${h}`,
			parent_hash: h === 0 ? "genesis" : `hash-${h - 1}`,
			burn_block_height: 100_000 + h,
			burn_block_hash: null,
			index_block_hash: null,
			timestamp: 1_700_000_000 + h,
		});
		chain.transactions.push({
			tx_id: `tx-${h}`,
			block_height: h,
			tx_index: 0,
			type: "coinbase",
			sender: "SP000",
			status: "success",
			contract_id: null,
			function_name: null,
			function_args_json: null,
			raw_result: null,
			raw_tx: "00",
		});
		chain.events.push({
			tx_id: `tx-${h}`,
			block_height: h,
			event_index: 0,
			event_type: "stx_transfer",
			data_json: JSON.stringify({ amount: String(h) }),
		});
	}
	return chain;
}

const STRING = { type: "UTF8" } as const;
const INT32 = { type: "INT32" } as const;
const INT64 = { type: "INT64" } as const;

function schemaFor(dataset: RangeDigestDataset): ParquetSchema {
	if (dataset === "blocks") {
		return new ParquetSchema({
			height: INT64,
			hash: STRING,
			parent_hash: STRING,
			burn_block_height: INT64,
			burn_block_hash: { ...STRING, optional: true },
			index_block_hash: { ...STRING, optional: true },
			timestamp: INT64,
		});
	}
	if (dataset === "transactions") {
		return new ParquetSchema({
			tx_id: STRING,
			block_height: INT64,
			tx_index: INT32,
			type: STRING,
			sender: STRING,
			status: STRING,
			contract_id: { ...STRING, optional: true },
			function_name: { ...STRING, optional: true },
			function_args_json: { ...STRING, optional: true },
			raw_result: { ...STRING, optional: true },
			raw_tx: STRING,
		});
	}
	return new ParquetSchema({
		tx_id: STRING,
		block_height: INT64,
		event_index: INT32,
		event_type: STRING,
		data_json: STRING,
	});
}

export async function seedChain(
	db: ReturnType<typeof getDb>,
	chain: FixtureChain,
): Promise<void> {
	for (const b of chain.blocks) {
		await sql`INSERT INTO blocks (height, hash, parent_hash, burn_block_height, burn_block_hash, index_block_hash, timestamp, canonical)
			VALUES (${b.height}, ${b.hash}, ${b.parent_hash}, ${b.burn_block_height}, ${b.burn_block_hash}, ${b.index_block_hash}, ${b.timestamp}, true)`.execute(
			db,
		);
	}
	for (const t of chain.transactions) {
		await sql`INSERT INTO transactions (tx_id, block_height, tx_index, type, sender, status, contract_id, function_name, raw_tx)
			VALUES (${t.tx_id}, ${t.block_height}, ${t.tx_index}, ${t.type}, ${t.sender}, ${t.status}, ${t.contract_id}, ${t.function_name}, ${t.raw_tx})`.execute(
			db,
		);
	}
	for (const e of chain.events) {
		await sql`INSERT INTO events (tx_id, block_height, event_index, type, data)
			VALUES (${e.tx_id}, ${e.block_height}, ${e.event_index}, ${e.event_type}, ${e.data_json}::jsonb)`.execute(
			db,
		);
	}
}

export async function clearChain(db: ReturnType<typeof getDb>): Promise<void> {
	await sql`TRUNCATE events, transactions, blocks, index_progress, sync_scopes CASCADE`.execute(
		db,
	);
}

export type WrittenArchive = {
	manifestPath: string;
	publicPem: string;
	root: string;
};

/**
 * Write the archive the way the publisher lays it out: `<root>/<dataset>/…`
 * partitions and a signed `<root>/snapshots/<digest>.json`. `digests` are
 * the range digests the manifest publishes; compute them from a database
 * that holds the fixture rows so they describe exactly this chain.
 */
export async function writeArchive(
	root: string,
	chain: FixtureChain,
	ranges: readonly { from_block: number; to_block: number }[],
	digests: readonly RangeDigest[],
	options: { datasets?: readonly RangeDigestDataset[] } = {},
): Promise<WrittenArchive> {
	const datasets = options.datasets ?? ["blocks", "transactions", "events"];
	const partitions: Array<Record<string, unknown>> = [];
	for (const dataset of datasets) {
		await mkdir(join(root, dataset), { recursive: true });
		for (const range of ranges) {
			const rows = (chain[dataset] as Array<Record<string, unknown>>).filter(
				(r) => {
					const h = Number(dataset === "blocks" ? r.height : r.block_height);
					return h >= range.from_block && h <= range.to_block;
				},
			);
			const relative = `${dataset}/${range.from_block}-${range.to_block}.parquet`;
			const path = join(root, relative);
			const writer = await ParquetWriter.openFile(schemaFor(dataset), path);
			for (const row of rows) await writer.appendRow(row);
			await writer.close();
			const bytes = await readFile(path);
			partitions.push({
				dataset,
				from_block: range.from_block,
				to_block: range.to_block,
				path: relative,
				row_count: rows.length,
				byte_size: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			});
		}
	}

	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const privatePem = privateKey
		.export({ type: "pkcs8", format: "pem" })
		.toString();
	const publicPem = publicKey
		.export({ type: "spki", format: "pem" })
		.toString();
	const manifest = signStreamsBulkManifest(
		{
			network: "mainnet",
			coverage: {
				from_block: Math.min(...ranges.map((r) => r.from_block)),
				to_block: Math.max(...ranges.map((r) => r.to_block)),
			},
			partitions,
			range_digests: digests,
		},
		privatePem,
	);
	await mkdir(join(root, "snapshots"), { recursive: true });
	const digest = createHash("sha256")
		.update(JSON.stringify(manifest))
		.digest("hex");
	const manifestPath = join(root, "snapshots", `${digest}.json`);
	await writeFile(manifestPath, JSON.stringify(manifest));
	return { manifestPath, publicPem, root };
}

export async function digestsFor(
	db: ReturnType<typeof getDb>,
	ranges: readonly { from_block: number; to_block: number }[],
	datasets: readonly RangeDigestDataset[] = [
		"blocks",
		"transactions",
		"events",
	],
): Promise<RangeDigest[]> {
	const out: RangeDigest[] = [];
	for (const dataset of datasets) {
		for (const range of ranges) {
			out.push(
				await computeRangeDigest(db, dataset, range.from_block, range.to_block),
			);
		}
	}
	return out;
}
