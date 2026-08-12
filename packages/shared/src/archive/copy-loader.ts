import { once } from "node:events";
import type { Writable } from "node:stream";

/**
 * Streaming `COPY ... FROM STDIN` loader for canonical archive rows.
 *
 * Restoring history row-by-row is not viable at chain scale: batched INSERTs
 * measured ~2k rows/s on this schema, which is days for a full genesis restore.
 * COPY moves the same data at ~64k rows/s because it is one statement per
 * partition with no per-row round-trip.
 *
 * This module deliberately knows nothing about Parquet or about where rows come
 * from — it accepts the archive's row shape as an async iterable. That keeps the
 * heavy file-format dependency out of every consumer that only needs to write
 * rows, and lets the CLI and the indexer share one loader rather than growing
 * two subtly different CSV encoders.
 */

export type ArchiveDataset = "blocks" | "transactions" | "events";

/** Row shapes exactly as the archive's Parquet columns are named. */
export type ArchiveRow = Record<string, unknown>;

/**
 * CSV encoding for `WITH (FORMAT csv, NULL '\N')`: every present value is
 * quoted with embedded quotes doubled, so a value that happens to equal the
 * NULL marker cannot be misread as SQL NULL. Only a genuinely absent value is
 * written unquoted as `\N`.
 */
export function csvField(value: string | number | null | undefined): string {
	if (value === null || value === undefined) return "\\N";
	const text = typeof value === "number" ? String(value) : value;
	return `"${text.replace(/"/g, '""')}"`;
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

export function toCsvLine(dataset: ArchiveDataset, row: ArchiveRow): string {
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
 * `canonical` is omitted from the blocks column list: every archived block is
 * canonical by definition, and the schema defaults it to true, so carrying it
 * through every row would be dead weight.
 */
export function copyStatement(dataset: ArchiveDataset): string {
	if (dataset === "blocks") {
		return "COPY blocks (height, hash, parent_hash, burn_block_height, burn_block_hash, index_block_hash, timestamp) FROM STDIN WITH (FORMAT csv, NULL '\\N')";
	}
	if (dataset === "transactions") {
		return "COPY transactions (tx_id, block_height, tx_index, type, sender, status, contract_id, function_name, function_args, raw_result, raw_tx) FROM STDIN WITH (FORMAT csv, NULL '\\N')";
	}
	return "COPY events (tx_id, block_height, event_index, type, data) FROM STDIN WITH (FORMAT csv, NULL '\\N')";
}

/**
 * Stream rows onto an open COPY writable. The caller owns opening it (drivers
 * differ in how a COPY stream is obtained) and this owns the wire format,
 * backpressure, and failure semantics.
 *
 * On error the stream is destroyed rather than ended, so Postgres aborts the
 * COPY instead of committing a partial one — an interrupted load must leave
 * nothing behind, not half a partition.
 */
export async function writeRowsToCopyStream(params: {
	writable: Writable;
	dataset: ArchiveDataset;
	rows: AsyncIterable<ArchiveRow>;
	onProgress?: (rowsWritten: number) => void;
	progressEvery?: number;
}): Promise<number> {
	const { writable, dataset, rows } = params;
	const progressEvery = params.progressEvery ?? 500_000;
	let count = 0;
	try {
		for await (const row of rows) {
			const line = `${toCsvLine(dataset, row)}\n`;
			if (!writable.write(line)) {
				await once(writable, "drain");
			}
			count++;
			if (params.onProgress && count % progressEvery === 0) {
				params.onProgress(count);
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
	return count;
}
