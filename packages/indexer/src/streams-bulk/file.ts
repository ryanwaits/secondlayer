import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ParquetWriter } from "@dsnp/parquetjs";
import { createStreamsBulkParquetSchema } from "./schema.ts";
import type { StreamsBulkEventRow } from "./query.ts";

export type StreamsBulkFileStats = {
	byteSize: number;
	sha256: string;
};

export async function writeStreamsBulkParquet(params: {
	outputPath: string;
	rows: readonly StreamsBulkEventRow[];
	metadata?: Record<string, string>;
}): Promise<void> {
	await mkdir(dirname(params.outputPath), { recursive: true });
	const writer = await ParquetWriter.openFile(
		createStreamsBulkParquetSchema(),
		params.outputPath,
		{ rowGroupSize: 5_000 },
	);
	for (const [key, value] of Object.entries(params.metadata ?? {})) {
		writer.setMetadata(key, value);
	}
	try {
		for (const row of params.rows) {
			await writer.appendRow({
				cursor: row.cursor,
				block_height: row.block_height,
				index_block_hash: row.index_block_hash,
				burn_block_height: row.burn_block_height,
				burn_block_hash: row.burn_block_hash,
				tx_id: row.tx_id,
				tx_index: row.tx_index,
				event_index: row.event_index,
				event_type: row.event_type,
				contract_id: row.contract_id,
				ts: row.ts,
				payload_json: row.payload_json,
				partition_block_range: row.partition_block_range,
			});
		}
	} finally {
		await writer.close();
	}
}

export async function writeJsonFile(
	outputPath: string,
	value: unknown,
): Promise<void> {
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJsonFile<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function measureFile(path: string): Promise<StreamsBulkFileStats> {
	const [fileStat, sha256] = await Promise.all([stat(path), sha256File(path)]);
	return { byteSize: fileStat.size, sha256 };
}

export async function sha256File(path: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = createReadStream(path);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("error", reject);
		stream.on("end", () => resolve(hash.digest("hex")));
	});
}

export function sha256Buffer(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}
