import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ParquetWriter } from "@dsnp/parquetjs";
import type { SbtcTokenEventRow } from "./query.ts";
import { createSbtcTokenEventsParquetSchema } from "./schema.ts";

export async function writeSbtcTokenEventsParquet(params: {
	outputPath: string;
	rows: readonly SbtcTokenEventRow[];
	metadata?: Record<string, string>;
}): Promise<void> {
	await mkdir(dirname(params.outputPath), { recursive: true });
	const writer = await ParquetWriter.openFile(
		createSbtcTokenEventsParquetSchema(),
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
				event_type: row.event_type,
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
