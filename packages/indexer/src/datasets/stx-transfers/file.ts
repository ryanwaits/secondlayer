import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ParquetWriter } from "@dsnp/parquetjs";
import type { StxTransferRow } from "./query.ts";
import { createStxTransfersParquetSchema } from "./schema.ts";

export async function writeStxTransfersParquet(params: {
	outputPath: string;
	rows: readonly StxTransferRow[];
	metadata?: Record<string, string>;
}): Promise<void> {
	await mkdir(dirname(params.outputPath), { recursive: true });
	const writer = await ParquetWriter.openFile(
		createStxTransfersParquetSchema(),
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
				block_time: row.block_time,
				tx_id: row.tx_id,
				tx_index: row.tx_index,
				event_index: row.event_index,
				sender: row.sender,
				recipient: row.recipient,
				amount: row.amount,
				memo: row.memo,
				partition_block_range: row.partition_block_range,
			});
		}
	} finally {
		await writer.close();
	}
}
