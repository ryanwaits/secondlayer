import { createHash } from "node:crypto";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import {
	type RangeDigest,
	computeRangeDigests,
} from "@secondlayer/shared/archive/range-digest";
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";
import type { Kysely } from "kysely";
import { sha256File, writeJsonFile } from "../streams-bulk/file.ts";
import {
	type CanonicalCoverageAudit,
	type FinalizedBound,
	auditCanonicalCoverageInSnapshot,
	resolveFinalizedBound,
} from "./canonical-audit.ts";

/**
 * v1 canonical archive exporter — the `db-reconstructive` staging slice.
 *
 * One repeatable-read snapshot produces everything: the audit verdict, three
 * Parquet datasets (blocks / transactions / events), and the immutable
 * snapshot manifest. The export REFUSES to run unless the audit inside that
 * same snapshot reports `continuity.complete` — a partial or broken chain can
 * never become an archive candidate.
 *
 * Determinism is a contract, not an aspiration: partitions carry no
 * generation-time metadata, rows are streamed in a total order, and the digest
 * is part of the object name, so re-exporting the same snapshot reproduces the
 * same bytes and the same names. `latest.json` is untouched by design — this
 * writes `snapshots/<digest>.json` and data objects only; promotion is a
 * separate, later step.
 */

export const CANONICAL_EXPORT_SCHEMA_VERSION = 1;
export const CANONICAL_ARCHIVE_VERSION = "v1";
export const CANONICAL_ARCHIVE_DATASET = "secondlayer-canonical";

const DEFAULT_PARTITION_SIZE_BLOCKS = 50_000;
const READ_BATCH_ROWS = 20_000;
/** Matches the streams-bulk writer; fixed forever for byte determinism. */
const PARQUET_ROW_GROUP_SIZE = 5_000;

const STRING_FIELD = { type: "UTF8", compression: "SNAPPY" } as const;
const INT32_FIELD = { type: "INT32", compression: "SNAPPY" } as const;
const INT64_FIELD = { type: "INT64", compression: "SNAPPY" } as const;

export type CanonicalDataset = "blocks" | "transactions" | "events";

export function createCanonicalParquetSchema(
	dataset: CanonicalDataset,
): ParquetSchema {
	switch (dataset) {
		case "blocks":
			return new ParquetSchema({
				height: INT64_FIELD,
				hash: STRING_FIELD,
				parent_hash: STRING_FIELD,
				burn_block_height: INT64_FIELD,
				burn_block_hash: { ...STRING_FIELD, optional: true },
				index_block_hash: { ...STRING_FIELD, optional: true },
				timestamp: INT64_FIELD,
			});
		case "transactions":
			return new ParquetSchema({
				tx_id: STRING_FIELD,
				block_height: INT64_FIELD,
				tx_index: INT32_FIELD,
				type: STRING_FIELD,
				sender: STRING_FIELD,
				status: STRING_FIELD,
				contract_id: { ...STRING_FIELD, optional: true },
				function_name: { ...STRING_FIELD, optional: true },
				function_args_json: { ...STRING_FIELD, optional: true },
				raw_result: { ...STRING_FIELD, optional: true },
				raw_tx: STRING_FIELD,
			});
		case "events":
			return new ParquetSchema({
				tx_id: STRING_FIELD,
				block_height: INT64_FIELD,
				event_index: INT32_FIELD,
				event_type: STRING_FIELD,
				data_json: STRING_FIELD,
			});
	}
}

export type CanonicalPartition = {
	dataset: CanonicalDataset;
	from_block: number;
	to_block: number;
	path: string;
	row_count: number;
	byte_size: number;
	sha256: string;
};

export type ZeroRecordRange = {
	dataset: CanonicalDataset;
	from_block: number;
	to_block: number;
};

export type CanonicalSnapshotManifest = {
	schema_version: typeof CANONICAL_EXPORT_SCHEMA_VERSION;
	dataset: typeof CANONICAL_ARCHIVE_DATASET;
	version: typeof CANONICAL_ARCHIVE_VERSION;
	network: string;
	generated_at: string;
	assurance: "db-reconstructive";
	source: "postgres-canonical-snapshot";
	finality_rule: {
		type: "bitcoin-confirmations";
		confirmations: number;
		source_burn_tip: number;
		finalized_burn_height: number;
	};
	coverage: { from_block: number; to_block: number };
	genesis: { height: number; hash: string };
	archive_tip: { height: number; hash: string };
	source_tip: { height: number; hash: string };
	counts: { blocks: number; transactions: number; events: number };
	partition_size_blocks: number;
	partitions: CanonicalPartition[];
	zero_record_ranges: ZeroRecordRange[];
	/**
	 * Cheap SQL-computed digests over the same partition grid. These let a
	 * consumer verify their database in seconds without regenerating Parquet —
	 * the per-object sha256s above can only be checked by a full local export,
	 * which is too slow to be anyone's first experience of verification.
	 */
	range_digests: RangeDigest[];
	assurance_ranges: Array<{
		dataset: CanonicalDataset;
		from_block: number;
		to_block: number;
		level: "db-reconstructive";
		source: "postgres-canonical-snapshot";
		digest_spec: "sha256:parquet-object";
	}>;
	audit: CanonicalCoverageAudit;
	signature?: string;
	key_id?: string;
};

export type ExportCanonicalSnapshotOptions = {
	network: string;
	outDir: string;
	/** Explicit finalized bound; omit to resolve from burn confirmations. */
	toBlock?: number;
	fromBlock?: number;
	partitionSizeBlocks?: number;
	db?: Kysely<Database>;
	generatedAt?: string;
	signingPrivateKeyPem?: string;
};

export type ExportCanonicalSnapshotResult = {
	manifest: CanonicalSnapshotManifest;
	manifestPath: string;
	snapshotDigest: string;
};

export async function exportCanonicalSnapshot(
	options: ExportCanonicalSnapshotOptions,
): Promise<ExportCanonicalSnapshotResult> {
	const db = options.db ?? getSourceDb();
	const fromBlock = options.fromBlock ?? 0;
	const partitionSize =
		options.partitionSizeBlocks ?? DEFAULT_PARTITION_SIZE_BLOCKS;
	if (!Number.isSafeInteger(partitionSize) || partitionSize <= 0) {
		throw new Error(`invalid partition size: ${partitionSize}`);
	}

	// Resolve finality OUTSIDE the snapshot only when unbounded; an explicit
	// bound is pinned as-is so a re-export reproduces the same snapshot scope.
	const bound: FinalizedBound =
		options.toBlock !== undefined
			? {
					toBlock: options.toBlock,
					// Filled from inside the snapshot below.
					burnTip: 0,
					finalizedBurnHeight: 0,
					confirmations: 0,
				}
			: await resolveFinalizedBound(db);

	return db.transaction().execute(async (tx) => {
		await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(
			tx,
		);

		// The audit and the export must describe ONE database state: same
		// snapshot, same bound. Fail closed on anything short of complete.
		const audit = await auditCanonicalCoverageInSnapshot(tx, {
			network: options.network,
			expectedFromBlock: fromBlock,
			expectedToBlock: bound.toBlock,
			generatedAt: options.generatedAt,
		});
		if (!audit.continuity.complete) {
			throw new Error(
				`refusing to export: audit is not complete for [${fromBlock}, ${bound.toBlock}] ` +
					`(gaps=${audit.continuity.gap_count}, broken_links=${audit.continuity.broken_link_count}, ` +
					`duplicates=${audit.continuity.duplicate_height_count})`,
			);
		}

		const genesis = await canonicalBlockAt(tx, fromBlock);
		const archiveTip = await canonicalBlockAt(tx, bound.toBlock);
		const sourceTip = await canonicalSourceTip(tx);
		if (options.toBlock !== undefined) {
			bound.burnTip = sourceTip.burn_block_height;
		}

		const partitions: CanonicalPartition[] = [];
		const zeroRecordRanges: ZeroRecordRange[] = [];
		const rangeDigests: RangeDigest[] = [];
		const counts = { blocks: 0, transactions: 0, events: 0 };

		for (
			let start = fromBlock;
			start <= bound.toBlock;
			start += partitionSize
		) {
			const end = Math.min(start + partitionSize - 1, bound.toBlock);
			for (const dataset of [
				"blocks",
				"transactions",
				"events",
			] as const satisfies readonly CanonicalDataset[]) {
				const written = await writeDatasetPartition({
					tx,
					dataset,
					fromBlock: start,
					toBlock: end,
					outDir: options.outDir,
				});
				if (written === null) {
					zeroRecordRanges.push({
						dataset,
						from_block: start,
						to_block: end,
					});
				} else {
					partitions.push(written);
					counts[dataset] += written.row_count;
				}
			}
			// Blocks ONLY, and deliberately so. Measured on production
			// 2026-08-12: a blocks digest costs ~0.5s per 50k-block partition
			// (~90s for all of history), while an events digest costs ~98s per
			// partition — roughly five hours added to every export, to verify the
			// dataset where identity drift matters least. `blocks` carries the
			// entire corruption class we have actually hit (gaps, broken parent
			// links, duplicate heights, wrong fork points), so it is what quick
			// verification checks. Transaction/event coverage is verifiable from
			// `partitions[].row_count` above at no extra cost, and byte-level
			// certainty remains available through the per-object sha256s.
			rangeDigests.push(
				...(await computeRangeDigests(tx, start, end, ["blocks"])),
			);
		}

		// Exported row totals must equal the audited totals — a mismatch means
		// the export itself dropped or duplicated rows, and nothing signed may
		// leave the building in that state.
		if (
			counts.blocks !== bound.toBlock - fromBlock + 1 ||
			(audit.coverage.to_block === bound.toBlock &&
				(counts.transactions !== audit.counts.transactions ||
					counts.events !== audit.counts.events))
		) {
			throw new Error(
				`export/audit row-count mismatch: exported ${JSON.stringify(counts)}, ` +
					`audited ${JSON.stringify(audit.counts)} to ${audit.coverage.to_block}`,
			);
		}

		let manifest: CanonicalSnapshotManifest = {
			schema_version: CANONICAL_EXPORT_SCHEMA_VERSION,
			dataset: CANONICAL_ARCHIVE_DATASET,
			version: CANONICAL_ARCHIVE_VERSION,
			network: options.network,
			generated_at: audit.generated_at,
			assurance: "db-reconstructive",
			source: "postgres-canonical-snapshot",
			finality_rule: {
				type: "bitcoin-confirmations",
				confirmations: bound.confirmations,
				source_burn_tip: bound.burnTip,
				finalized_burn_height: bound.finalizedBurnHeight,
			},
			coverage: { from_block: fromBlock, to_block: bound.toBlock },
			genesis: { height: genesis.height, hash: genesis.hash },
			archive_tip: { height: archiveTip.height, hash: archiveTip.hash },
			source_tip: { height: sourceTip.height, hash: sourceTip.hash },
			counts,
			partition_size_blocks: partitionSize,
			partitions,
			zero_record_ranges: zeroRecordRanges,
			range_digests: rangeDigests,
			assurance_ranges: (["blocks", "transactions", "events"] as const).map(
				(dataset) => ({
					dataset,
					from_block: fromBlock,
					to_block: bound.toBlock,
					level: "db-reconstructive" as const,
					source: "postgres-canonical-snapshot" as const,
					digest_spec: "sha256:parquet-object" as const,
				}),
			),
			audit,
		};

		if (options.signingPrivateKeyPem) {
			manifest = signStreamsBulkManifest(
				manifest as unknown as Record<string, unknown>,
				options.signingPrivateKeyPem,
			) as unknown as CanonicalSnapshotManifest;
		}

		const snapshotDigest = manifestDigest(manifest);
		const manifestPath = join(
			options.outDir,
			"snapshots",
			`${snapshotDigest}.json`,
		);
		await writeJsonFile(manifestPath, manifest);

		return { manifest, manifestPath, snapshotDigest };
	});
}

/** The snapshot's identity: sha256 over the manifest minus its signature
 *  envelope, so signed and unsigned manifests of the same content share it. */
export function manifestDigest(manifest: CanonicalSnapshotManifest): string {
	const { signature: _s, key_id: _k, ...payload } = manifest;
	return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function canonicalBlockAt(
	tx: Kysely<Database>,
	height: number,
): Promise<{ height: number; hash: string }> {
	const row = await tx
		.selectFrom("blocks")
		.select(["height", "hash"])
		.where("canonical", "=", true)
		.where("height", "=", height)
		.executeTakeFirst();
	if (!row) throw new Error(`no canonical block at ${height}`);
	return { height: Number(row.height), hash: row.hash };
}

async function canonicalSourceTip(
	tx: Kysely<Database>,
): Promise<{ height: number; hash: string; burn_block_height: number }> {
	const row = await tx
		.selectFrom("blocks")
		.select(["height", "hash", "burn_block_height"])
		.where("canonical", "=", true)
		.orderBy("height", "desc")
		.limit(1)
		.executeTakeFirst();
	if (!row) throw new Error("no canonical blocks");
	return {
		height: Number(row.height),
		hash: row.hash,
		burn_block_height: Number(row.burn_block_height),
	};
}

/**
 * Stream one dataset partition to Parquet. Returns null (and writes nothing)
 * for a zero-record range. Bounded memory: keyset-paginated batches feed the
 * writer row by row; nothing materializes the whole partition.
 *
 * The object is written to a temp name first and renamed to its digest name,
 * so a crashed export can never leave a well-named partial object behind.
 */
async function writeDatasetPartition(params: {
	tx: Kysely<Database>;
	dataset: CanonicalDataset;
	fromBlock: number;
	toBlock: number;
	outDir: string;
	batchRows?: number;
}): Promise<CanonicalPartition | null> {
	const { tx, dataset, fromBlock, toBlock } = params;
	const tmpPath = join(
		params.outDir,
		dataset,
		`.tmp-${fromBlock}-${toBlock}.parquet`,
	);
	await mkdir(dirname(tmpPath), { recursive: true });

	const writer = await ParquetWriter.openFile(
		createCanonicalParquetSchema(dataset),
		tmpPath,
		{ rowGroupSize: PARQUET_ROW_GROUP_SIZE },
	);
	let rowCount = 0;
	try {
		for await (const row of streamDatasetRows(
			tx,
			dataset,
			fromBlock,
			toBlock,
			params.batchRows ?? READ_BATCH_ROWS,
		)) {
			await writer.appendRow(row);
			rowCount++;
		}
	} finally {
		await writer.close();
	}

	if (rowCount === 0) {
		// parquetjs has already written an empty file; discard it — zero-record
		// ranges are declared in the manifest, not shipped as empty objects.
		await unlink(tmpPath).catch(() => {});
		return null;
	}

	const sha256 = await sha256File(tmpPath);
	const objectName = `${fromBlock}-${toBlock}-${sha256.slice(0, 16)}.parquet`;
	const finalPath = join(params.outDir, dataset, objectName);
	await rename(tmpPath, finalPath);
	const { size } = await stat(finalPath);

	return {
		dataset,
		from_block: fromBlock,
		to_block: toBlock,
		path: `${dataset}/${objectName}`,
		row_count: rowCount,
		byte_size: size,
		sha256,
	};
}

type ParquetRow = Record<string, string | number | null>;

/**
 * Total-order row stream for one dataset over a height range. Ordering is part
 * of the archive contract (byte determinism): blocks by height, transactions
 * by (height, tx_index, tx_id), events by (height, event_index, tx_id).
 * Transactions and events join canonical blocks so non-canonical residue at a
 * height can never leak into an archive object.
 */
async function* streamDatasetRows(
	tx: Kysely<Database>,
	dataset: CanonicalDataset,
	fromBlock: number,
	toBlock: number,
	batchRows: number,
): AsyncGenerator<ParquetRow> {
	if (dataset === "blocks") {
		let last = fromBlock - 1;
		while (true) {
			const rows = await tx
				.selectFrom("blocks")
				.select([
					"height",
					"hash",
					"parent_hash",
					"burn_block_height",
					"burn_block_hash",
					"index_block_hash",
					"timestamp",
				])
				.where("canonical", "=", true)
				.where("height", ">", last)
				.where("height", "<=", toBlock)
				.orderBy("height", "asc")
				.limit(batchRows)
				.execute();
			if (rows.length === 0) return;
			for (const row of rows) {
				yield {
					height: Number(row.height),
					hash: row.hash,
					parent_hash: row.parent_hash,
					burn_block_height: Number(row.burn_block_height),
					burn_block_hash: row.burn_block_hash ?? null,
					index_block_hash: row.index_block_hash ?? null,
					timestamp: Number(row.timestamp),
				};
			}
			last = Number(rows[rows.length - 1]?.height);
		}
	}

	if (dataset === "transactions") {
		let cursor: { height: number; txIndex: number; txId: string } | null = null;
		while (true) {
			type TxRow = {
				tx_id: string;
				block_height: string | number;
				tx_index: number;
				type: string;
				sender: string;
				status: string;
				contract_id: string | null;
				function_name: string | null;
				function_args: unknown;
				raw_result: string | null;
				raw_tx: string;
			};
			const result = await sql<TxRow>`
				SELECT t.tx_id, t.block_height, t.tx_index, t.type, t.sender, t.status,
				       t.contract_id, t.function_name, t.function_args, t.raw_result, t.raw_tx
				  FROM transactions t
				  JOIN blocks b ON b.height = t.block_height AND b.canonical = true
				 WHERE t.block_height >= ${fromBlock} AND t.block_height <= ${toBlock}
				   AND (${cursor === null} OR (t.block_height, t.tx_index, t.tx_id) >
				        (${cursor?.height ?? 0}, ${cursor?.txIndex ?? 0}, ${cursor?.txId ?? ""}))
				 ORDER BY t.block_height, t.tx_index, t.tx_id
				 LIMIT ${batchRows}
			`.execute(tx);
			const rows: TxRow[] = result.rows;
			if (rows.length === 0) return;
			for (const row of rows) {
				yield {
					tx_id: row.tx_id,
					block_height: Number(row.block_height),
					tx_index: row.tx_index,
					type: row.type,
					sender: row.sender,
					status: row.status,
					contract_id: row.contract_id,
					function_name: row.function_name,
					function_args_json:
						row.function_args === null || row.function_args === undefined
							? null
							: JSON.stringify(row.function_args),
					raw_result: row.raw_result,
					raw_tx: row.raw_tx,
				};
			}
			const tail = rows[rows.length - 1];
			if (tail) {
				cursor = {
					height: Number(tail.block_height),
					txIndex: tail.tx_index,
					txId: tail.tx_id,
				};
			}
		}
	}

	let cursor: { height: number; eventIndex: number; txId: string } | null =
		null;
	while (true) {
		type EventRow = {
			tx_id: string;
			block_height: string | number;
			event_index: number;
			type: string;
			data: unknown;
		};
		const result = await sql<EventRow>`
			SELECT e.tx_id, e.block_height, e.event_index, e.type, e.data
			  FROM events e
			  JOIN blocks b ON b.height = e.block_height AND b.canonical = true
			 WHERE e.block_height >= ${fromBlock} AND e.block_height <= ${toBlock}
			   AND (${cursor === null} OR (e.block_height, e.event_index, e.tx_id) >
			        (${cursor?.height ?? 0}, ${cursor?.eventIndex ?? 0}, ${cursor?.txId ?? ""}))
			 ORDER BY e.block_height, e.event_index, e.tx_id
			 LIMIT ${batchRows}
		`.execute(tx);
		const rows: EventRow[] = result.rows;
		if (rows.length === 0) return;
		for (const row of rows) {
			yield {
				tx_id: row.tx_id,
				block_height: Number(row.block_height),
				event_index: row.event_index,
				event_type: row.type,
				data_json: JSON.stringify(row.data ?? null),
			};
		}
		const tail = rows[rows.length - 1];
		if (tail) {
			cursor = {
				height: Number(tail.block_height),
				eventIndex: tail.event_index,
				txId: tail.tx_id,
			};
		}
	}
}

function parseCliArgs(argv: string[]): {
	toBlock: number | undefined;
	fromBlock: number;
	outDir: string;
	partitionSizeBlocks: number;
} {
	let toBlock: number | undefined;
	let fromBlock = 0;
	let outDir = "./canonical-v1-staging";
	let partitionSizeBlocks = DEFAULT_PARTITION_SIZE_BLOCKS;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--to-block") {
			const value = argv[++i];
			if (value !== "auto") toBlock = Number(value);
		} else if (arg === "--from-block") fromBlock = Number(argv[++i]);
		else if (arg === "--out") outDir = argv[++i] ?? outDir;
		else if (arg === "--partition-size")
			partitionSizeBlocks = Number(argv[++i]);
	}
	return { toBlock, fromBlock, outDir, partitionSizeBlocks };
}

async function main(): Promise<void> {
	const args = parseCliArgs(process.argv.slice(2));
	const result = await exportCanonicalSnapshot({
		network: process.env.STACKS_NETWORK ?? "mainnet",
		outDir: args.outDir,
		toBlock: args.toBlock,
		fromBlock: args.fromBlock,
		partitionSizeBlocks: args.partitionSizeBlocks,
		signingPrivateKeyPem: process.env.STREAMS_SIGNING_PRIVATE_KEY,
	});
	console.log(
		JSON.stringify(
			{
				snapshot_digest: result.snapshotDigest,
				manifest_path: result.manifestPath,
				coverage: result.manifest.coverage,
				counts: result.manifest.counts,
				partitions: result.manifest.partitions.length,
				zero_record_ranges: result.manifest.zero_record_ranges.length,
				signed: Boolean(result.manifest.signature),
			},
			null,
			2,
		),
	);
	await closeDb();
}

if (import.meta.main) {
	main().catch(async (error) => {
		console.error(
			"export-snapshot failed:",
			error instanceof Error ? error.message : error,
		);
		await closeDb().catch(() => {});
		process.exit(1);
	});
}
