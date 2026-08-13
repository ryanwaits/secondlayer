import { type Kysely, sql } from "kysely";
import type { Database } from "../db/schema.ts";
import {
	type PartitionSemanticDigest,
	SEMANTIC_DIGEST_SPEC_V1,
	SemanticDigestRollup,
	semanticDigest,
} from "./semantic-digest.ts";

/**
 * Compute per-partition semantic-v1 digests directly from a database — the same
 * bytes an exporter would produce, without writing Parquet. Callers: the CLI
 * verifier's `--semantic` pass, and (in future) the node replay auditor.
 *
 * SQL and ordering MUST match the archive exporter's stream (see
 * `packages/indexer/src/archive/export-snapshot.ts`). If either drifts, an
 * honest re-computation will disagree with the manifest even though both are
 * correct — and there is no way to tell which is wrong. Any change here needs
 * a matching change there.
 */

export type CanonicalDataset = "blocks" | "transactions" | "events";

const DEFAULT_BATCH_ROWS = 20_000;

interface StreamOptions {
	batchRows?: number;
}

async function* streamBlockDigests(
	db: Kysely<Database>,
	fromBlock: number,
	toBlock: number,
	batchRows: number,
): AsyncGenerator<string> {
	let last = fromBlock - 1;
	while (true) {
		const rows = await db
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
			yield semanticDigest.v1.block({
				height: Number(row.height),
				hash: row.hash,
				parent_hash: row.parent_hash,
				burn_block_height: Number(row.burn_block_height),
				burn_block_hash: row.burn_block_hash ?? null,
				index_block_hash: row.index_block_hash ?? null,
				timestamp: Number(row.timestamp),
			});
		}
		last = Number(rows[rows.length - 1]?.height);
	}
}

async function* streamTransactionDigests(
	db: Kysely<Database>,
	fromBlock: number,
	toBlock: number,
	batchRows: number,
): AsyncGenerator<string> {
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
	let cursor: { height: number; txIndex: number; txId: string } | null = null;
	while (true) {
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
		`.execute(db);
		const rows: TxRow[] = result.rows;
		if (rows.length === 0) return;
		for (const row of rows) {
			yield semanticDigest.v1.transaction({
				tx_id: row.tx_id,
				block_height: Number(row.block_height),
				tx_index: row.tx_index,
				type: row.type,
				sender: row.sender,
				status: row.status,
				contract_id: row.contract_id,
				function_name: row.function_name,
				function_args: row.function_args ?? null,
				raw_result: row.raw_result,
				raw_tx: row.raw_tx,
			});
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

async function* streamEventDigests(
	db: Kysely<Database>,
	fromBlock: number,
	toBlock: number,
	batchRows: number,
): AsyncGenerator<string> {
	type EventRow = {
		tx_id: string;
		block_height: string | number;
		event_index: number;
		type: string;
		data: unknown;
	};
	let cursor: { height: number; eventIndex: number; txId: string } | null =
		null;
	while (true) {
		const result = await sql<EventRow>`
			SELECT e.tx_id, e.block_height, e.event_index, e.type, e.data
			  FROM events e
			  JOIN blocks b ON b.height = e.block_height AND b.canonical = true
			 WHERE e.block_height >= ${fromBlock} AND e.block_height <= ${toBlock}
			   AND (${cursor === null} OR (e.block_height, e.event_index, e.tx_id) >
			        (${cursor?.height ?? 0}, ${cursor?.eventIndex ?? 0}, ${cursor?.txId ?? ""}))
			 ORDER BY e.block_height, e.event_index, e.tx_id
			 LIMIT ${batchRows}
		`.execute(db);
		const rows: EventRow[] = result.rows;
		if (rows.length === 0) return;
		for (const row of rows) {
			yield semanticDigest.v1.event({
				tx_id: row.tx_id,
				block_height: Number(row.block_height),
				event_index: row.event_index,
				type: row.type,
				data: row.data ?? null,
			});
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

function digestStream(
	db: Kysely<Database>,
	dataset: CanonicalDataset,
	fromBlock: number,
	toBlock: number,
	batchRows: number,
): AsyncGenerator<string> {
	if (dataset === "blocks") {
		return streamBlockDigests(db, fromBlock, toBlock, batchRows);
	}
	if (dataset === "transactions") {
		return streamTransactionDigests(db, fromBlock, toBlock, batchRows);
	}
	return streamEventDigests(db, fromBlock, toBlock, batchRows);
}

/**
 * Compute one partition's semantic-v1 digest. Empty ranges return `null` — an
 * empty range has no digest, distinct from "digest of zero rows" which would
 * compare equal across datasets.
 */
export async function computePartitionSemanticDigest(
	db: Kysely<Database>,
	dataset: CanonicalDataset,
	fromBlock: number,
	toBlock: number,
	options: StreamOptions = {},
): Promise<PartitionSemanticDigest> {
	const rollup = SemanticDigestRollup.forDataset(dataset);
	for await (const rowDigest of digestStream(
		db,
		dataset,
		fromBlock,
		toBlock,
		options.batchRows ?? DEFAULT_BATCH_ROWS,
	)) {
		rollup.appendRowDigest(rowDigest);
	}
	return {
		dataset,
		from_block: fromBlock,
		to_block: toBlock,
		row_count: rollup.rowCount(),
		digest: rollup.digest(),
		digest_spec: SEMANTIC_DIGEST_SPEC_V1,
	};
}

export type PartitionSemanticComparison = {
	dataset: CanonicalDataset;
	from_block: number;
	to_block: number;
	status: "match" | "digest-mismatch" | "count-mismatch" | "missing-locally";
	expected_digest: string | null;
	actual_digest: string | null;
	expected_rows: number;
	actual_rows: number;
};

export function comparePartitionSemanticDigests(
	local: readonly PartitionSemanticDigest[],
	reference: readonly PartitionSemanticDigest[],
): PartitionSemanticComparison[] {
	const localByKey = new Map(
		local.map((d) => [`${d.dataset}:${d.from_block}-${d.to_block}`, d]),
	);
	return reference.map((expected) => {
		const key = `${expected.dataset}:${expected.from_block}-${expected.to_block}`;
		const actual = localByKey.get(key);
		const base = {
			dataset: expected.dataset,
			from_block: expected.from_block,
			to_block: expected.to_block,
			expected_digest: expected.digest,
			expected_rows: expected.row_count,
		};
		if (!actual) {
			return {
				...base,
				status: "missing-locally" as const,
				actual_digest: null,
				actual_rows: 0,
			};
		}
		const status =
			actual.row_count !== expected.row_count
				? ("count-mismatch" as const)
				: actual.digest === expected.digest
					? ("match" as const)
					: ("digest-mismatch" as const);
		return {
			...base,
			status,
			actual_digest: actual.digest,
			actual_rows: actual.row_count,
		};
	});
}
