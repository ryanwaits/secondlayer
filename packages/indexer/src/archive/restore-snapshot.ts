import { once } from "node:events";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { ParquetReader } from "@dsnp/parquetjs";
import { closeDb, getRawClient, getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import { readJsonFile, sha256File } from "../streams-bulk/file.ts";
import {
	type CanonicalDataset,
	type CanonicalPartition,
	type CanonicalSnapshotManifest,
	exportCanonicalSnapshot,
} from "./export-snapshot.ts";

/**
 * Restore a v1 canonical snapshot into an EMPTY database and prove it.
 *
 * The proof is stronger than row counts: after importing a contiguous height
 * range, the restored database is re-exported through the exact same writer,
 * and every regenerated partition must carry the SAME sha256 as the archive
 * object it was restored from. Archive bytes → empty Postgres → archive bytes,
 * digest-identical — that is `db-reconstructive` demonstrated, not asserted.
 *
 * Safety: the target must be empty (zero canonical blocks) unless the restore
 * is resuming, and every partition file is re-hashed against the manifest
 * before a single row is inserted. A tampered object can never enter the
 * restore target.
 *
 * Loading uses `COPY ... FROM STDIN`, not row-by-row INSERTs: the 2026-08-12
 * proof run measured ~2k rows/s on batched inserts, which would take days for
 * a full-genesis restore. COPY streams the Parquet reader straight onto the
 * wire — one statement per partition, one row conversion, no per-row
 * round-trip.
 */

export type RestoreRange = { fromBlock: number; toBlock: number };

export type RestoreResult = {
	restored: { blocks: number; transactions: number; events: number };
	partitionsRead: number;
	proof: {
		auditComplete: boolean;
		reExportedPartitions: number;
		digestMatches: number;
		digestMismatches: Array<{ path: string; expected: string; actual: string }>;
	};
};

type ParquetRecord = Record<string, unknown>;

async function* readPartitionRows(path: string): AsyncGenerator<ParquetRecord> {
	const reader = await ParquetReader.openFile(path);
	try {
		const cursor = reader.getCursor();
		for (
			let row = (await cursor.next()) as ParquetRecord | null;
			row;
			row = (await cursor.next()) as ParquetRecord | null
		) {
			yield row;
		}
	} finally {
		await reader.close();
	}
}

function asNumber(value: unknown): number {
	return typeof value === "bigint" ? Number(value) : Number(value as number);
}

function asText(value: unknown): string {
	return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

function asOptionalText(value: unknown): string | null {
	return value === null || value === undefined ? null : asText(value);
}

/**
 * CSV field encoding for `COPY ... WITH (FORMAT csv, NULL '\N')`: every
 * present value is quoted (embedded quotes doubled), so a value that happens
 * to equal the literal NULL marker can never be misread as SQL NULL — only an
 * actually-absent value is written unquoted as `\N`.
 */
function csvField(value: string | number | null | undefined): string {
	if (value === null || value === undefined) return "\\N";
	const text = typeof value === "number" ? String(value) : value;
	return `"${text.replace(/"/g, '""')}"`;
}

function toCsvLine(dataset: CanonicalDataset, row: ParquetRecord): string {
	if (dataset === "blocks") {
		return [
			csvField(asNumber(row.height)),
			csvField(asText(row.hash)),
			csvField(asText(row.parent_hash)),
			csvField(asNumber(row.burn_block_height)),
			csvField(asOptionalText(row.burn_block_hash)),
			csvField(asOptionalText(row.index_block_hash)),
			csvField(asNumber(row.timestamp)),
		].join(",");
	}
	if (dataset === "transactions") {
		return [
			csvField(asText(row.tx_id)),
			csvField(asNumber(row.block_height)),
			csvField(asNumber(row.tx_index)),
			csvField(asText(row.type)),
			csvField(asText(row.sender)),
			csvField(asText(row.status)),
			csvField(asOptionalText(row.contract_id)),
			csvField(asOptionalText(row.function_name)),
			csvField(asOptionalText(row.function_args_json)),
			csvField(asOptionalText(row.raw_result)),
			csvField(asText(row.raw_tx)),
		].join(",");
	}
	return [
		csvField(asText(row.tx_id)),
		csvField(asNumber(row.block_height)),
		csvField(asNumber(row.event_index)),
		csvField(asText(row.event_type)),
		csvField(asText(row.data_json)),
	].join(",");
}

/**
 * `canonical` is not archived (every exported block is canonical by
 * definition) and defaults to `true` in the schema, so it's omitted from the
 * COPY column list rather than carried as dead weight through every row.
 */
async function openCopyWritable(
	rawClient: ReturnType<typeof getRawClient>,
	dataset: CanonicalDataset,
): Promise<Writable> {
	if (dataset === "blocks") {
		return rawClient`COPY blocks (height, hash, parent_hash, burn_block_height, burn_block_hash, index_block_hash, timestamp) FROM STDIN WITH (FORMAT csv, NULL '\\N')`.writable();
	}
	if (dataset === "transactions") {
		return rawClient`COPY transactions (tx_id, block_height, tx_index, type, sender, status, contract_id, function_name, function_args, raw_result, raw_tx) FROM STDIN WITH (FORMAT csv, NULL '\\N')`.writable();
	}
	return rawClient`COPY events (tx_id, block_height, event_index, type, data) FROM STDIN WITH (FORMAT csv, NULL '\\N')`.writable();
}

const PROGRESS_LOG_ROWS = 500_000;

/** Stream one partition file straight onto a COPY connection. Returns the row
 *  count written, so the caller can cross-check it against the manifest. */
async function copyPartitionFile(params: {
	rawClient: ReturnType<typeof getRawClient>;
	dataset: CanonicalDataset;
	partition: CanonicalPartition;
	path: string;
	log: (message: string) => void;
}): Promise<number> {
	const writable = await openCopyWritable(params.rawClient, params.dataset);
	let count = 0;
	try {
		for await (const row of readPartitionRows(params.path)) {
			const line = `${toCsvLine(params.dataset, row)}\n`;
			if (!writable.write(line)) {
				await once(writable, "drain");
			}
			count++;
			if (count % PROGRESS_LOG_ROWS === 0) {
				params.log(
					`  ${params.dataset} ${params.partition.from_block}-${params.partition.to_block}: ${count}/${params.partition.row_count} rows`,
				);
			}
		}
		await new Promise<void>((resolve, reject) => {
			writable.end((error?: Error | null) =>
				error ? reject(error) : resolve(),
			);
		});
	} catch (error) {
		writable.destroy(error instanceof Error ? error : new Error(String(error)));
		throw error;
	}
	if (count !== params.partition.row_count) {
		throw new Error(
			`COPY wrote ${count} rows for ${params.partition.path}, manifest declares ${params.partition.row_count}`,
		);
	}
	return count;
}

async function partitionRowCount(
	db: Kysely<Database>,
	dataset: CanonicalDataset,
	partition: CanonicalPartition,
): Promise<number> {
	const table = dataset === "blocks" ? "blocks" : dataset;
	const column = dataset === "blocks" ? "height" : "block_height";
	const row = await db
		.selectFrom(table)
		.select(({ fn }) => fn.countAll<string>().as("count"))
		.where(column, ">=", partition.from_block)
		.where(column, "<=", partition.to_block)
		.executeTakeFirst();
	return Number(row?.count ?? 0);
}

async function deletePartitionRows(
	db: Kysely<Database>,
	dataset: CanonicalDataset,
	partition: CanonicalPartition,
): Promise<void> {
	const table = dataset === "blocks" ? "blocks" : dataset;
	const column = dataset === "blocks" ? "height" : "block_height";
	await db
		.deleteFrom(table)
		.where(column, ">=", partition.from_block)
		.where(column, "<=", partition.to_block)
		.execute();
}

function partitionsInRange(
	manifest: CanonicalSnapshotManifest,
	dataset: CanonicalDataset,
	range: RestoreRange,
): CanonicalPartition[] {
	return manifest.partitions
		.filter(
			(p) =>
				p.dataset === dataset &&
				p.from_block >= range.fromBlock &&
				p.to_block <= range.toBlock,
		)
		.sort((a, b) => a.from_block - b.from_block);
}

export async function restoreCanonicalSnapshot(params: {
	dir: string;
	manifest: CanonicalSnapshotManifest;
	db: Kysely<Database>;
	range: RestoreRange;
	/** Where the proof re-export writes its regenerated partitions. */
	proofDir: string;
	/** Continue an interrupted restore of the SAME snapshot: complete
	 *  partitions are skipped, a partial one is deleted and reloaded. */
	resume?: boolean;
	/** Raw postgres.js client used for `COPY ... FROM STDIN`. Defaults to the
	 *  same source-role connection `db` normally resolves to; only override
	 *  when `db` was NOT built from `getSourceDb()` (e.g. a custom test pool). */
	rawClient?: ReturnType<typeof getRawClient>;
	log?: (message: string) => void;
}): Promise<RestoreResult> {
	const { dir, manifest, db, range } = params;
	const log = params.log ?? (() => {});
	const rawClient = params.rawClient ?? getRawClient("source");

	if (
		range.fromBlock % manifest.partition_size_blocks !== 0 ||
		(range.toBlock !== manifest.coverage.to_block &&
			(range.toBlock + 1) % manifest.partition_size_blocks !== 0)
	) {
		throw new Error(
			`range [${range.fromBlock}, ${range.toBlock}] does not align to the ` +
				`${manifest.partition_size_blocks}-block partition grid`,
		);
	}

	if (!params.resume) {
		const existing = await db
			.selectFrom("blocks")
			.select(({ fn }) => fn.countAll<string>().as("count"))
			.executeTakeFirst();
		if (Number(existing?.count ?? 0) > 0) {
			throw new Error(
				"restore target is not empty — refusing to mix archive rows into an existing database (use resume to continue an interrupted restore of the same snapshot)",
			);
		}
	}

	// Verify every needed object BEFORE the first insert.
	const datasets: CanonicalDataset[] = ["blocks", "transactions", "events"];
	const selected = datasets.flatMap((dataset) =>
		partitionsInRange(manifest, dataset, range),
	);
	for (const partition of selected) {
		const digest = await sha256File(join(dir, partition.path));
		if (digest !== partition.sha256) {
			throw new Error(
				`archive object fails verification: ${partition.path} expected=${partition.sha256} actual=${digest}`,
			);
		}
	}
	log(`verified ${selected.length} archive objects`);

	// FK order: blocks, then transactions, then events.
	const restored = { blocks: 0, transactions: 0, events: 0 };
	for (const dataset of datasets) {
		for (const partition of partitionsInRange(manifest, dataset, range)) {
			if (params.resume) {
				const state = await partitionRowCount(db, dataset, partition);
				if (state === partition.row_count) {
					restored[dataset] += state;
					continue;
				}
				if (state > 0) {
					// A torn partition: batches are atomic but the partition isn't.
					// Reload it whole — deleting children-first is unnecessary within
					// one dataset because FKs only point across datasets.
					log(
						`resume: reloading partial ${dataset} partition ${partition.from_block}-${partition.to_block} (${state}/${partition.row_count} rows)`,
					);
					await deletePartitionRows(db, dataset, partition);
				}
			}
			const count = await copyPartitionFile({
				rawClient,
				dataset,
				partition,
				path: join(dir, partition.path),
				log,
			});
			restored[dataset] += count;
		}
		log(`restored ${restored[dataset]} ${dataset} rows`);
	}

	// The proof: re-export the restored range through the same writer and
	// demand the regenerated partitions carry the archive's own digests.
	const reExport = await exportCanonicalSnapshot({
		network: manifest.network,
		outDir: params.proofDir,
		fromBlock: range.fromBlock,
		toBlock: range.toBlock,
		partitionSizeBlocks: manifest.partition_size_blocks,
		db,
		generatedAt: manifest.generated_at,
	});

	const expectedByPath = new Map(
		selected.map((p) => [p.path, p.sha256] as const),
	);
	let digestMatches = 0;
	const digestMismatches: RestoreResult["proof"]["digestMismatches"] = [];
	for (const regenerated of reExport.manifest.partitions) {
		const expected = expectedByPath.get(regenerated.path);
		if (expected === undefined) {
			digestMismatches.push({
				path: regenerated.path,
				expected: "absent from archive manifest",
				actual: regenerated.sha256,
			});
		} else if (expected === regenerated.sha256) {
			digestMatches++;
		} else {
			digestMismatches.push({
				path: regenerated.path,
				expected,
				actual: regenerated.sha256,
			});
		}
	}
	// Every archive partition in range must be regenerated — a silently
	// missing one is a failure, not a pass.
	if (reExport.manifest.partitions.length !== selected.length) {
		for (const partition of selected) {
			if (
				!reExport.manifest.partitions.some((p) => p.path === partition.path)
			) {
				digestMismatches.push({
					path: partition.path,
					expected: partition.sha256,
					actual: "not regenerated",
				});
			}
		}
	}

	return {
		restored,
		partitionsRead: selected.length,
		proof: {
			auditComplete: reExport.manifest.audit.continuity.complete,
			reExportedPartitions: reExport.manifest.partitions.length,
			digestMatches,
			digestMismatches,
		},
	};
}

function parseCliArgs(argv: string[]): {
	manifestPath: string | undefined;
	from: number;
	to: number | undefined;
	proofDir: string;
	resume: boolean;
} {
	let manifestPath: string | undefined;
	let from = 0;
	let to: number | undefined;
	let proofDir = "./canonical-v1-restore-proof";
	let resume = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--manifest") manifestPath = argv[++i];
		else if (arg === "--from-block") from = Number(argv[++i]);
		else if (arg === "--to-block") to = Number(argv[++i]);
		else if (arg === "--proof-out") proofDir = argv[++i] ?? proofDir;
		else if (arg === "--resume") resume = true;
	}
	return { manifestPath, from, to, proofDir, resume };
}

async function main(): Promise<void> {
	const args = parseCliArgs(process.argv.slice(2));
	if (!args.manifestPath || args.to === undefined) {
		throw new Error("--manifest and --to-block are required");
	}
	const manifest = await readJsonFile<CanonicalSnapshotManifest>(
		args.manifestPath,
	);
	const dir = join(args.manifestPath, "..", "..");

	// The restore target comes from DATABASE_URL — point it at the EMPTY
	// database, never at the production source.
	const result = await restoreCanonicalSnapshot({
		dir,
		manifest,
		db: getSourceDb(),
		range: { fromBlock: args.from, toBlock: args.to },
		proofDir: args.proofDir,
		resume: args.resume,
		log: (message) => console.error(message),
	});
	console.log(JSON.stringify(result, null, 2));
	const passed =
		result.proof.auditComplete && result.proof.digestMismatches.length === 0;
	console.error(passed ? "RESTORE PROOF PASSED" : "RESTORE PROOF FAILED");
	if (!passed) process.exitCode = 2;
	await closeDb();
}

if (import.meta.main) {
	main().catch(async (error) => {
		console.error(
			"restore-snapshot failed:",
			error instanceof Error ? error.message : error,
		);
		await closeDb().catch(() => {});
		process.exit(1);
	});
}
